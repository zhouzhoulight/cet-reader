/* 四六级朗读学习器：基础稳定版 app.js */
(() => {
  "use strict";

  // constants
  const APP_VERSION = "pwa-2026-06-03-2";
  const STORAGE_KEY = "cet-reader-basic-state-v1";
  const CACHE_PREFIX = "cet-reader-cache";
  const TYPE_LABEL = { word: "单词", phrase: "词组", sentence: "句子" };
  const DEFAULT_SETTINGS = {
    repeatEnglish: 2,
    speakChinese: true,
    speakMorph: false,
    speakExample: false,
    spellWords: true,
    autoPlay: true,
    rate: 0.9,
    pitch: 1,
    volume: 1,
    englishVoiceURI: "",
    chineseVoiceURI: "",
    random: false,
    recallMode: false
  };

  // state
  const state = {
    libraries: [],
    currentLibraryId: "",
    currentLibrary: null,
    entries: [],
    visibleEntries: [],
    currentIndex: 0,
    filterType: "all",
    searchKeyword: "",
    isPlaying: false,
    playerToken: 0,
    hiddenEntryIds: {},
    learnedEntryIds: {},
    difficultEntryIds: {},
    userOverrides: {},
    userLibraries: [],
    pendingImportEntries: [],
    pendingImportFileName: "",
    currentEditEntryId: "",
    availableVoices: [],
    settings: { ...DEFAULT_SETTINGS },
    listMode: "current",
    errors: []
  };

  let wakeLock = null;
  let voicesReady = null;
  let wakeLockNoticeShown = false;

  window.cetReaderState = state;

  // DOM helpers
  const $ = (id) => document.getElementById(id);
  const on = (id, event, handler) => {
    const el = $(id);
    if (el) el.addEventListener(event, handler);
  };

  function text(id, value) {
    const el = $(id);
    if (el) el.textContent = value == null ? "" : String(value);
  }

  function html(id, value) {
    const el = $(id);
    if (el) el.innerHTML = value == null ? "" : String(value);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function ensureBasicApp() {
    if ($("termText") && $("librarySelect")) return;
    const root = $("basicApp") || document.createElement("div");
    root.id = "basicApp";
    root.innerHTML = `
      <main style="max-width:760px;margin:0 auto;padding:16px;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif">
        <h1 id="libraryTitle">四六级朗读学习器</h1>
        <p id="librarySub"></p>
        <label>词库 <select id="librarySelect"></select></label>
        <button id="loadLibraryBtn">打开词库</button>
        <p><input id="searchInput" placeholder="搜索英文或中文" style="width:100%;min-height:40px"></p>
        <p>
          <select id="typeFilter"><option value="all">全部</option><option value="word">单词</option><option value="phrase">词组</option><option value="sentence">句子</option></select>
          <label><input id="randomToggle" type="checkbox"> 随机</label>
        </p>
        <article style="border:1px solid #ddd;border-radius:16px;padding:16px">
          <p><span id="entryType"></span> <span id="entryIndex"></span></p>
          <h2 id="termText" style="font-size:40px"></h2>
          <section id="answerBox">
            <h3>中文</h3><p id="meaningText"></p>
            <h3>构词法</h3><p id="morphText"></p>
            <h3>例句</h3><p id="exampleText"></p>
          </section>
          <pre id="speechPreview" style="white-space:pre-wrap;background:#f6f6f6;padding:10px"></pre>
        </article>
        <p>
          <button id="prevBtn">上一条</button>
          <button id="playPauseBtn">播放</button>
          <button id="replayBtn">重播</button>
          <button id="nextBtn">下一条</button>
        </p>
        <p>
          <button id="removeCurrentBtn">掌握了，移除</button>
          <button id="difficultCurrentBtn">标为不熟</button>
          <button id="editCurrentBtn">编辑</button>
          <button id="showHiddenBtn">查看已移除</button>
        </p>
        <p id="playerStatus"></p>
        <div id="entryList"></div>
      </main>
    `;
    if (!root.parentNode) document.body.appendChild(root);
  }

  // storage
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== "object") return;
      state.currentLibraryId = saved.currentLibraryId || "";
      state.currentIndex = Number(saved.currentIndex) || 0;
      state.filterType = saved.filterType || "all";
      state.searchKeyword = saved.searchKeyword || "";
      state.hiddenEntryIds = validMap(saved.hiddenEntryIds);
      state.learnedEntryIds = validMap(saved.learnedEntryIds);
      state.difficultEntryIds = validMap(saved.difficultEntryIds);
      state.userOverrides = validMap(saved.userOverrides);
      state.userLibraries = normalizeSavedUserLibraries(saved.userLibraries);
      state.settings = { ...DEFAULT_SETTINGS, ...(saved.settings || {}) };
    } catch (error) {
      logError("loadState", error, "localStorage 数据损坏，已回退默认状态");
      showStatus("本地状态损坏，已自动重置本次运行状态");
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        appVersion: APP_VERSION,
        currentLibraryId: state.currentLibraryId,
        currentIndex: state.currentIndex,
        filterType: state.filterType,
        searchKeyword: state.searchKeyword,
        hiddenEntryIds: state.hiddenEntryIds,
        learnedEntryIds: state.learnedEntryIds,
        difficultEntryIds: state.difficultEntryIds,
        userOverrides: state.userOverrides,
        userLibraries: state.userLibraries,
        settings: state.settings
      }));
    } catch (error) {
      logError("saveState", error, "localStorage 写入失败");
      showToast("保存失败：浏览器本地空间可能不足");
    }
  }

  function validMap(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function normalizeSavedUserLibraries(value) {
    if (!Array.isArray(value)) return [];
    return value.map((library, index) => {
      try {
        return normalizeUserLibrary(library, index);
      } catch (error) {
        logError("normalizeSavedUserLibraries", error, library?.name || `user-library-${index + 1}`);
        return null;
      }
    }).filter(Boolean);
  }

  function getLibraryUserState(libraryId = state.currentLibraryId) {
    return {
      hidden: new Set(state.hiddenEntryIds[libraryId] || []),
      learned: new Set(state.learnedEntryIds[libraryId] || []),
      difficult: new Set(state.difficultEntryIds[libraryId] || []),
      overrides: state.userOverrides[libraryId] || {}
    };
  }

  function listFor(map, libraryId = state.currentLibraryId) {
    if (!map[libraryId]) map[libraryId] = [];
    return map[libraryId];
  }

  function addToList(map, entryId) {
    const list = listFor(map);
    if (!list.includes(entryId)) list.push(entryId);
  }

  function removeFromList(map, entryId) {
    const list = listFor(map);
    const index = list.indexOf(entryId);
    if (index >= 0) list.splice(index, 1);
  }

  function markHidden(entryId) {
    addToList(state.hiddenEntryIds, entryId);
    addToList(state.learnedEntryIds, entryId);
    saveState();
  }

  function restoreHidden(entryId) {
    removeFromList(state.hiddenEntryIds, entryId);
    saveState();
  }

  function markDifficult(entryId) {
    addToList(state.difficultEntryIds, entryId);
    saveState();
  }

  function toggleDifficult(entryId) {
    const list = listFor(state.difficultEntryIds);
    if (list.includes(entryId)) removeFromList(state.difficultEntryIds, entryId);
    else markDifficult(entryId);
    saveState();
  }

  function saveOverride(entryId, patch) {
    if (!state.userOverrides[state.currentLibraryId]) state.userOverrides[state.currentLibraryId] = {};
    state.userOverrides[state.currentLibraryId][entryId] = {
      ...(state.userOverrides[state.currentLibraryId][entryId] || {}),
      ...patch
    };
    saveState();
  }

  function removeOverride(entryId) {
    if (state.userOverrides[state.currentLibraryId]) {
      delete state.userOverrides[state.currentLibraryId][entryId];
    }
    saveState();
  }

  // library loading
  async function initLibraries() {
    try {
      let builtinLibraries;
      if (Array.isArray(window.BUILTIN_FILES) && window.BUILTIN_FILES.length) {
        builtinLibraries = window.BUILTIN_FILES;
      } else {
        const data = await fetchJsonWithFallback(["./data/builtin-index.json", "./builtin-index.json"], "加载词库索引");
        builtinLibraries = data.libraries || [];
      }
      const builtinMetas = builtinLibraries.map((lib, index) => normalizeLibraryMeta(lib, index, false));
      const userMetas = state.userLibraries.map((lib, index) => normalizeLibraryMeta(lib, index, true));
      state.libraries = [...builtinMetas, ...userMetas];
      if (!state.libraries.length) throw new Error("没有可用词库");
      renderLibraryOptions();
    } catch (error) {
      logError("initLibraries", error, "尝试 ./data/builtin-index.json, ./builtin-index.json 或 BUILTIN_FILES");
      showStatus(`词库索引加载失败：${error.message || error}`);
    }
  }

  async function fetchJsonWithFallback(paths, actionName) {
    const errors = [];
    for (const path of paths) {
      const requestPath = withCacheVersion(path);
      try {
        const response = await fetch(requestPath, { cache: "no-store" });
        if (!response.ok) throw new Error(`${requestPath} HTTP ${response.status}`);
        try {
          return await response.json();
        } catch (parseError) {
          throw new Error(`${requestPath} JSON 解析错误：${parseError.message || parseError}`);
        }
      } catch (error) {
        errors.push(`${requestPath}: ${error.message || error}`);
      }
    }
    throw new Error(`${actionName}失败，已尝试：${errors.join("；")}`);
  }

  function withCacheVersion(path) {
    const separator = path.includes("?") ? "&" : "?";
    return `${path}${separator}v=${encodeURIComponent(APP_VERSION)}`;
  }

  function normalizeLibraryMeta(raw, index, isUser = false) {
    return {
      id: raw.id || `library-${index + 1}`,
      name: raw.name || raw.filename || `词库 ${index + 1}`,
      file: raw.file || "",
      group: raw.group || "",
      count: Number(raw.count) || (Array.isArray(raw.entries) ? raw.entries.length : 0),
      isUser,
      raw
    };
  }

  async function loadLibrary(libraryId) {
    const meta = state.libraries.find((lib) => lib.id === libraryId) || state.libraries[0];
    if (!meta) {
      showStatus("没有找到可加载词库");
      return;
    }
    try {
      showStatus(`正在加载：${meta.name}`);
      let rawLibrary;
      if (meta.isUser) {
        rawLibrary = state.userLibraries.find((library) => library.id === meta.id);
        if (!rawLibrary) throw new Error(`用户词库不存在：${meta.id}`);
      } else if (meta.raw && Array.isArray(meta.raw.entries)) {
        rawLibrary = meta.raw;
      } else {
        const fileName = meta.file || `${meta.id.replace(/^builtin-/, "")}.json`;
        rawLibrary = await fetchJsonWithFallback([`./data/${fileName}`, `./${fileName}`], `加载${meta.name}`);
      }
      const library = normalizeLibrary(rawLibrary, meta);
      validateLibrary(library);
      state.currentLibraryId = library.id;
      state.currentLibrary = library;
      state.entries = library.entries;
      state.currentIndex = 0;
      rebuildVisibleEntries();
      saveState();
      render();
      showStatus(`已加载：${library.name}，${library.entries.length} 条`);
    } catch (error) {
      const detail = meta.file ? `尝试 ./data/${meta.file}, ./${meta.file}` : `尝试加载 ${meta.name}`;
      logError("loadLibrary", error, detail);
      showStatus(`${meta.name || libraryId} 加载失败：${error.message || error}。可能是缓存或路径问题，请用本地服务器打开并刷新。`);
    }
  }

  function normalizeLibrary(raw, meta = {}) {
    const library = {
      id: raw.id || meta.id,
      name: raw.name || meta.name || "未命名词库",
      source: raw.source || meta.file || "",
      entries: []
    };
    library.entries = (raw.entries || [])
      .map((entry, index) => normalizeEntry(entry, index, library))
      .filter(Boolean);
    return library;
  }

  function validateLibrary(library) {
    if (!library || typeof library !== "object") throw new Error("JSON 结构错误：词库不是对象");
    if (!library.id) throw new Error("JSON 结构错误：library.id 缺失");
    if (!library.name) throw new Error(`JSON 结构错误：${library.id} 缺少 name`);
    if (!Array.isArray(library.entries)) throw new Error(`${library.name} entries 必须是数组`);
    if (!library.entries.length) throw new Error(library.id === "builtin-0530" ? "0530 词库为空或加载失败" : `${library.name} 词库为空或加载失败`);
    if (library.id === "builtin-0530" && library.entries.length < 100) {
      throw new Error(`0530 词库条目异常，请刷新缓存或检查 data/0530.json。当前 entries 数量：${library.entries.length}`);
    }
    return library;
  }

  function normalizeUserLibrary(raw, index = 0) {
    const id = raw.id && String(raw.id).startsWith("user-") ? raw.id : `user-${Date.now()}-${index + 1}`;
    const library = normalizeLibrary({
      ...raw,
      id,
      name: cleanDisplayText(raw.name || raw.source || `导入词库 ${index + 1}`),
      source: raw.source || raw.name || "用户导入"
    }, { id, name: raw.name || `导入词库 ${index + 1}`, isUser: true });
    validateLibrary(library);
    return {
      id: library.id,
      name: library.name,
      source: library.source,
      entries: library.entries
    };
  }

  function normalizeEntry(raw, index, library = state.currentLibrary) {
    const entry = {
      id: String(raw.id || `${library?.id || "entry"}-${index + 1}`),
      term: cleanDisplayText(raw.term || raw.word || raw.english || ""),
      meaning: cleanDisplayText(raw.meaning || raw.translation || raw.chinese || ""),
      morph: cleanDisplayText(raw.morph || raw.structure || ""),
      example: cleanDisplayText(raw.example || raw.examples || ""),
      type: ["word", "phrase", "sentence"].includes(raw.type) ? raw.type : inferEntryType(raw.term || ""),
      source: raw.source || library?.source || "",
      warnings: Array.isArray(raw.warnings) ? raw.warnings : [],
      suspectedError: Boolean(raw.suspectedError)
    };
    validateEntry(entry);
    return entry.term ? entry : null;
  }

  function cleanDisplayText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function validateEntry(entry) {
    entry.warnings = entry.warnings || [];
    if (!entry.id) entry.warnings.push("missing-id");
    if (!entry.term) entry.warnings.push("missing-term");
    if (!entry.meaning) entry.warnings.push("missing-meaning");
    if (!["word", "phrase", "sentence"].includes(entry.type)) entry.type = inferEntryType(entry.term);
    if (chineseCharRatio(entry.term) > 0.35) {
      entry.suspectedError = true;
      entry.warnings.push("term-has-too-much-chinese");
    }
    if (entry.meaning && englishCharRatio(entry.meaning) > 0.65 && !containsChinese(entry.meaning)) {
      entry.suspectedError = true;
      entry.warnings.push("meaning-looks-english");
    }
    return entry;
  }

  function applyOverride(entry) {
    const override = state.userOverrides[state.currentLibraryId]?.[entry.id];
    return override ? validateEntry({ ...entry, ...override, id: entry.id }) : entry;
  }

  function isEntryHidden(entryId) {
    return (state.hiddenEntryIds[state.currentLibraryId] || []).includes(entryId);
  }

  function rebuildVisibleEntries() {
    const keyword = state.searchKeyword.trim().toLowerCase();
    const hidden = new Set(state.hiddenEntryIds[state.currentLibraryId] || []);
    const difficult = new Set(state.difficultEntryIds[state.currentLibraryId] || []);
    const learned = new Set(state.learnedEntryIds[state.currentLibraryId] || []);
    const range = $("rangeFilter")?.value || (state.listMode === "hidden" ? "hidden" : "active");
    let entries = (state.currentLibrary?.entries || []).map(applyOverride);

    if (range === "active") {
      entries = entries.filter((entry) => !hidden.has(entry.id));
    }
    if (range === "difficult") {
      entries = entries.filter((entry) => !hidden.has(entry.id) && difficult.has(entry.id));
    } else if (range === "unlearned") {
      entries = entries.filter((entry) => !hidden.has(entry.id) && !learned.has(entry.id));
    } else if (range === "hidden") {
      entries = entries.filter((entry) => hidden.has(entry.id));
    }

    if (state.filterType !== "all") {
      entries = entries.filter((entry) => entry.type === state.filterType);
    }

    if (keyword) {
      entries = entries.filter((entry) => {
        const haystack = [entry.term, entry.meaning, entry.morph, entry.example].join(" ").toLowerCase();
        return haystack.includes(keyword);
      });
    }

    state.visibleEntries = entries;
    if (state.currentIndex >= entries.length) state.currentIndex = Math.max(0, entries.length - 1);
    if (state.currentIndex < 0) state.currentIndex = 0;
  }

  function currentEntry() {
    return state.visibleEntries[state.currentIndex] || null;
  }

  // render
  function render() {
    rebuildVisibleEntries();
    syncControls();
    renderLibraryOptions();
    renderLibraryActions();
    renderCard();
    renderStats();
    renderList();
    renderPlayer();
    renderErrorLog();
  }

  function syncControls() {
    const search = $("searchInput");
    if (search && search.value !== state.searchKeyword) search.value = state.searchKeyword;
    const type = $("typeFilter");
    if (type) type.value = state.filterType;
    const random = $("randomToggle");
    if (random) random.checked = Boolean(state.settings.random);
    const recall = $("recallToggle");
    if (recall) recall.checked = Boolean(state.settings.recallMode);
    const speakMeaning = $("speakMeaningToggle");
    if (speakMeaning) speakMeaning.checked = Boolean(state.settings.speakChinese);
    const speakMorph = $("speakMorphToggle");
    if (speakMorph) speakMorph.checked = Boolean(state.settings.speakMorph);
    const speakExample = $("speakExampleToggle");
    if (speakExample) speakExample.checked = Boolean(state.settings.speakExample);
    const spell = $("spellToggle");
    if (spell) spell.checked = Boolean(state.settings.spellWords);
    const autoPlay = $("autoPlayToggle");
    if (autoPlay) autoPlay.checked = Boolean(state.settings.autoPlay);
    const repeat = $("repeatInput");
    if (repeat) repeat.value = state.settings.repeatEnglish;
    const rate = $("rateInput");
    if (rate) rate.value = state.settings.rate;
    const pitch = $("pitchInput");
    if (pitch) pitch.value = state.settings.pitch;
    const volume = $("volumeInput");
    if (volume) volume.value = state.settings.volume;
    renderVoiceOptions();
  }

  function renderVoiceOptions() {
    renderVoiceSelect("englishVoiceSelect", "en", state.settings.englishVoiceURI, "自动选择英文声音");
    renderVoiceSelect("chineseVoiceSelect", "zh", state.settings.chineseVoiceURI, "自动选择中文声音");
  }

  function renderVoiceSelect(id, langPrefix, selectedURI, autoLabel) {
    const select = $(id);
    if (!select) return;
    const currentValue = select.value || selectedURI || "";
    const voices = state.availableVoices.filter((voice) => voice.lang?.toLowerCase().startsWith(langPrefix));
    select.innerHTML = `<option value="">${escapeHtml(autoLabel)}</option>` + voices.map((voice) => (
      `<option value="${escapeHtml(voice.voiceURI)}">${escapeHtml(voice.name)} · ${escapeHtml(voice.lang)}</option>`
    )).join("");
    select.value = voices.some((voice) => voice.voiceURI === currentValue) ? currentValue : "";
  }

  function renderLibraryOptions() {
    const select = $("librarySelect");
    if (!select) return;
    const currentValue = select.value || state.currentLibraryId;
    select.innerHTML = state.libraries.map((lib) => {
      const count = lib.count ? ` · ${lib.count}` : "";
      return `<option value="${escapeHtml(lib.id)}">${escapeHtml(lib.name)}${count}</option>`;
    }).join("");
    select.value = state.currentLibraryId || currentValue || state.libraries[0]?.id || "";
  }

  function renderLibraryActions() {
    const meta = state.libraries.find((lib) => lib.id === state.currentLibraryId);
    const deleteButton = $("deleteLibraryBtn");
    if (deleteButton) {
      deleteButton.hidden = !(meta && meta.isUser);
      deleteButton.disabled = !(meta && meta.isUser);
    }
    const restoreAllButton = $("restoreAllBtn");
    if (restoreAllButton) {
      const range = $("rangeFilter")?.value || (state.listMode === "hidden" ? "hidden" : "active");
      restoreAllButton.hidden = range !== "hidden";
    }
  }

  function renderCard() {
    const entry = currentEntry();
    const libraryName = state.currentLibrary?.name || "未加载词库";
    text("libraryTitle", libraryName);
    text("librarySub", `${state.visibleEntries.length} 条可学 · 当前 ${state.visibleEntries.length ? state.currentIndex + 1 : 0}/${state.visibleEntries.length}`);

    if (!entry) {
      text("termText", state.currentLibrary ? "当前筛选没有条目" : "请选择词库");
      text("meaningText", "");
      text("morphText", "");
      text("exampleText", "");
      text("entryType", "条目");
      text("entryIndex", "0 / 0");
      text("speechPreview", "");
      return;
    }

    text("termText", entry.term);
    text("meaningText", state.settings.recallMode ? "（背诵模式：点击显示答案）" : entry.meaning);
    text("morphText", state.settings.recallMode ? "" : entry.morph);
    text("exampleText", state.settings.recallMode ? "" : entry.example);
    text("entryType", TYPE_LABEL[entry.type] || entry.type);
    text("entryIndex", `${state.currentIndex + 1} / ${state.visibleEntries.length}`);

    const answerBox = $("answerBox");
    if (answerBox) answerBox.hidden = false;
    const morphBlock = $("morphBlock");
    if (morphBlock) morphBlock.hidden = !entry.morph || state.settings.recallMode;
    const exampleBlock = $("exampleBlock");
    if (exampleBlock) exampleBlock.hidden = !entry.example || state.settings.recallMode;
    text("showAnswerBtn", state.settings.recallMode ? "显示答案" : "隐藏答案");
    text("difficultCurrentBtn", isDifficult(entry.id) ? "取消不熟" : "标为不熟");
    text("speechPreview", buildPlayPlan(entry).map((item) => `${item.kind} [${item.lang}]: ${item.text}`).join("\n"));
    setupMediaSession(entry);
  }

  function renderStats() {
    const hiddenCount = (state.hiddenEntryIds[state.currentLibraryId] || []).length;
    const difficultCount = (state.difficultEntryIds[state.currentLibraryId] || []).length;
    const learnedCount = (state.learnedEntryIds[state.currentLibraryId] || []).length;
    text("visibleCount", state.visibleEntries.length);
    text("hiddenCount", hiddenCount);
    text("difficultCount", difficultCount);
    text("learnedCount", learnedCount);
    renderHiddenCount();
    const fill = $("progressFill");
    if (fill) {
      const pct = state.visibleEntries.length ? ((state.currentIndex + 1) / state.visibleEntries.length) * 100 : 0;
      fill.style.width = `${pct}%`;
    }
  }

  function renderHiddenCount() {
    const count = (state.hiddenEntryIds[state.currentLibraryId] || []).length;
    const el = $("hiddenCount");
    if (el) el.textContent = String(count);
  }

  function renderList() {
    const list = $("entryList");
    if (!list) return;
    const entries = state.visibleEntries.slice(0, 120);
    list.innerHTML = entries.map((entry, index) => `
      <div class="entry-item ${index === state.currentIndex ? "active" : ""} ${entry.suspectedError ? "suspected" : ""}" data-index="${index}">
        <div>
          <p class="entry-title">${escapeHtml(entry.term)}</p>
          <p class="entry-meaning">${escapeHtml(entry.meaning || entry.morph || "")}</p>
        </div>
        <div class="mini-actions">
          <button type="button" data-action="edit" data-id="${escapeHtml(entry.id)}" title="编辑">编辑</button>
          ${state.listMode === "hidden" || ($("rangeFilter")?.value === "hidden")
            ? `<button type="button" data-action="restore" data-id="${escapeHtml(entry.id)}" title="恢复">恢复</button>`
            : `<button type="button" data-action="hide" data-id="${escapeHtml(entry.id)}" title="移除">移除</button>`}
        </div>
      </div>
    `).join("");
  }

  function renderPlayer() {
    text("playPauseBtn", state.isPlaying ? "暂停" : "播放");
    text("playerStatus", state.isPlaying ? "正在播放" : "空闲");
    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.playbackState = state.isPlaying ? "playing" : "paused";
      } catch (error) {
        logInfo("mediaSession.playbackState", error.message || String(error));
      }
    }
  }

  // speech sanitize
  function sanitizeForSpeech(textValue, lang, fieldType = "term") {
    if (!textValue) return "";
    if (fieldType === "morph") return morphToSpeakableText(textValue);
    return lang.startsWith("zh") ? sanitizeChineseForSpeech(textValue) : sanitizeEnglishForSpeech(textValue);
  }

  function sanitizeEnglishForSpeech(value) {
    return String(value || "")
      .replace(/\bC\+\+/g, "C plus plus")
      .replace(/\[[^\]]*]/g, " ")
      .replace(/\([^)]*\)/g, " ")
      .replace(/\{[^}]*}/g, " ")
      .replace(/\/[^/\n]{1,60}\//g, " ")
      .replace(/\b(v|vt|vi|n|adj|adv|prep|conj|pron|pl|abbr)\./gi, " ")
      .replace(/[\/\\]/g, ", ")
      .replace(/[+=→←]/g, " ")
      .replace(/[()[\]{}]/g, " ")
      .replace(/[“”"‘’]/g, " ")
      .replace(/-/g, " ")
      .replace(/[;；]/g, ", ")
      .replace(/[,，、]/g, ", ")
      .replace(/[^\w\s.',]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function sanitizeChineseForSpeech(value) {
    return String(value || "")
      .replace(/[（(][^）)]*[）)]/g, " ")
      .replace(/[【\[][^\]】]*[\]】]/g, " ")
      .replace(/[\/\\+=→←]/g, " ")
      .replace(/[;；,，、]/g, "，")
      .replace(/[“”"‘’]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function morphToSpeakableText(value) {
    return String(value || "")
      .replace(/[（(][^）)]*[）)]/g, " ")
      .replace(/[+＊*]/g, "，")
      .replace(/[\/\\]/g, " 和 ")
      .replace(/=/g, " 表示 ")
      .replace(/→/g, " 变成 ")
      .replace(/←/g, " 来自 ")
      .replace(/-/g, " ")
      .replace(/……/g, "什么")
      .replace(/[;；]/g, "，")
      .replace(/\s+/g, " ")
      .trim();
  }

  function buildPlayPlan(entry) {
    if (!entry) return [];
    const plan = [];
    const repeats = Math.max(1, Math.min(5, Number(state.settings.repeatEnglish) || 1));
    const term = sanitizeForSpeech(entry.term, "en-US", "term");
    for (let i = 0; i < repeats; i++) {
      if (term) plan.push({ kind: "term", lang: "en-US", text: term });
    }
    if (state.settings.spellWords && entry.type === "word") {
      const spelling = spellingForSpeech(entry.term);
      if (spelling) plan.push({ kind: "spelling", lang: "en-US", text: spelling });
    }
    if (state.settings.speakChinese && entry.meaning) {
      const meaning = sanitizeForSpeech(entry.meaning, "zh-CN", "meaning");
      if (meaning) plan.push({ kind: "meaning", lang: "zh-CN", text: meaning });
    }
    if (state.settings.speakMorph && entry.morph) {
      const morph = sanitizeForSpeech(entry.morph, "zh-CN", "morph");
      if (morph) plan.push({ kind: "morph", lang: "zh-CN", text: morph });
    }
    if (state.settings.speakExample && entry.example) {
      const example = sanitizeForSpeech(entry.example, "en-US", "example");
      if (example) plan.push({ kind: "example", lang: "en-US", text: example });
    }
    return plan;
  }

  function spellingForSpeech(term) {
    const word = String(term || "").trim();
    if (!/^[A-Za-z]+$/.test(word)) return "";
    return word.toLowerCase().split("").join(", ");
  }

  async function speakText(textValue, lang) {
    await ensureVoicesReady();
    return new Promise((resolve, reject) => {
      if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
        reject(new Error(`当前浏览器不支持 speechSynthesis；browser=${navigator.userAgent || "unknown"}`));
        return;
      }
      const utterance = new SpeechSynthesisUtterance(textValue);
      utterance.lang = lang;
      utterance.rate = Number(state.settings.rate) || 0.9;
      utterance.pitch = Number(state.settings.pitch) || 1;
      utterance.volume = Number.isFinite(Number(state.settings.volume)) ? Number(state.settings.volume) : 1;
      const voice = pickVoice(lang);
      if (voice) utterance.voice = voice;
      utterance.onend = () => resolve();
      utterance.onerror = (event) => reject(new Error([
        event.error || "朗读失败",
        `lang=${lang}`,
        `voice=${voice ? `${voice.name}/${voice.lang}` : "none"}`,
        `text=${String(textValue || "").slice(0, 80)}`,
        `browser=${navigator.userAgent || "unknown"}`
      ].join("；")));
      window.speechSynthesis.speak(utterance);
    });
  }

  function pickVoice(lang) {
    const voices = state.availableVoices.length ? state.availableVoices : (window.speechSynthesis?.getVoices?.() || []);
    const selectedURI = lang.startsWith("zh") ? state.settings.chineseVoiceURI : state.settings.englishVoiceURI;
    const selected = selectedURI && voices.find((voice) => voice.voiceURI === selectedURI);
    if (selected) return selected;
    const candidates = voices.filter((voice) => isVoiceCandidate(voice, lang));
    candidates.sort((a, b) => voiceScore(b, lang) - voiceScore(a, lang));
    return candidates[0] || null;
  }

  function isVoiceCandidate(voice, lang) {
    const voiceLang = voice.lang?.toLowerCase() || "";
    if (lang.startsWith("zh")) return voiceLang.startsWith("zh");
    return voiceLang.startsWith("en");
  }

  function voiceScore(voice, lang) {
    const name = `${voice.name} ${voice.voiceURI}`.toLowerCase();
    const voiceLang = voice.lang.toLowerCase();
    let score = 0;
    if (lang === "en-US" && voiceLang === "en-us") score += 60;
    if (lang === "en-US" && voiceLang === "en-gb") score += 35;
    if (lang.startsWith("zh") && voiceLang === "zh-cn") score += 60;
    if (lang.startsWith("zh") && voiceLang.startsWith("zh-hans")) score += 45;
    if (lang.startsWith("zh") && voiceLang.startsWith("zh")) score += 30;
    if (/samantha|ava|allison|nicky|premium|enhanced|siri|natural/.test(name)) score += 30;
    if (/compact|default/.test(name)) score -= 10;
    return score;
  }

  function refreshVoices() {
    if (!("speechSynthesis" in window)) return;
    state.availableVoices = window.speechSynthesis.getVoices?.() || [];
    renderVoiceOptions();
  }

  function ensureVoicesReady() {
    if (!("speechSynthesis" in window)) return Promise.resolve([]);
    refreshVoices();
    if (state.availableVoices.length) return Promise.resolve(state.availableVoices);
    if (voicesReady) return voicesReady;
    voicesReady = new Promise((resolve) => {
      const timer = setTimeout(() => {
        refreshVoices();
        resolve(state.availableVoices);
      }, 800);
      window.speechSynthesis.onvoiceschanged = () => {
        clearTimeout(timer);
        refreshVoices();
        resolve(state.availableVoices);
      };
    });
    return voicesReady;
  }

  function setupMediaSession(entry) {
    if (!("mediaSession" in navigator) || !entry) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: entry.term || "四六级朗读学习器",
        artist: state.currentLibrary?.name || "当前词库",
        album: "四六级朗读学习器"
      });
      navigator.mediaSession.setActionHandler("play", playCurrent);
      navigator.mediaSession.setActionHandler("pause", stopSpeaking);
      navigator.mediaSession.setActionHandler("nexttrack", playNext);
      navigator.mediaSession.setActionHandler("previoustrack", playPrev);
      navigator.mediaSession.playbackState = state.isPlaying ? "playing" : "paused";
    } catch (error) {
      logError("setupMediaSession", error, entry.term);
    }
  }

  async function requestWakeLock() {
    if (!("wakeLock" in navigator)) {
      if (!wakeLockNoticeShown) {
        wakeLockNoticeShown = true;
        setPwaStatus("当前浏览器不支持屏幕常亮；播放仍会继续尝试。", false);
        logInfo("wakeLock", "not supported");
      }
      return;
    }
    try {
      if (!wakeLock) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => {
          wakeLock = null;
        });
      }
    } catch (error) {
      logInfo("wakeLock.request", error.message || String(error));
    }
  }

  async function releaseWakeLock() {
    try {
      if (wakeLock) {
        const lock = wakeLock;
        wakeLock = null;
        await lock.release();
      }
    } catch (error) {
      logInfo("wakeLock.release", error.message || String(error));
    }
  }

  function handleVisibilityChange() {
    logInfo("visibilitychange", document.visibilityState);
    if (state.isPlaying) requestWakeLock();
  }

  // player
  async function playCurrent() {
    const entry = currentEntry();
    if (!entry) return;
    stopSpeaking(false);
    state.isPlaying = true;
    const token = ++state.playerToken;
    renderPlayer();
    try {
      setupMediaSession(entry);
      await requestWakeLock();
      const plan = buildPlayPlan(entry);
      text("speechPreview", plan.map((item) => `${item.kind} [${item.lang}]: ${item.text}`).join("\n"));
      for (const item of plan) {
        if (token !== state.playerToken) return;
        await speakText(item.text, item.lang);
      }
      if (token !== state.playerToken) return;
      addToList(state.learnedEntryIds, entry.id);
      saveState();
      if (state.isPlaying && state.settings.autoPlay) {
        moveNextForPlayback();
        if (state.visibleEntries.length) playCurrent();
      } else {
        state.isPlaying = false;
        releaseWakeLock();
        renderPlayer();
      }
    } catch (error) {
      if (token !== state.playerToken) return;
      state.isPlaying = false;
      releaseWakeLock();
      logError("playCurrent", error, entry.term);
      showStatus(`朗读失败：${error.message || error}`);
      renderPlayer();
    }
  }

  function stopSpeaking(render = true) {
    state.playerToken += 1;
    state.isPlaying = false;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    releaseWakeLock();
    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.playbackState = "paused";
      } catch (error) {
        logError("stopSpeaking.mediaSession", error);
      }
    }
    if (render) renderPlayer();
  }

  function replayCurrent() {
    playCurrent();
  }

  function playNext() {
    const shouldContinue = state.isPlaying;
    stopSpeaking(false);
    if (!state.visibleEntries.length) return;
    state.currentIndex = (state.currentIndex + 1) % state.visibleEntries.length;
    saveState();
    render();
    if (shouldContinue) playCurrent();
  }

  function playPrev() {
    const shouldContinue = state.isPlaying;
    stopSpeaking(false);
    if (!state.visibleEntries.length) return;
    state.currentIndex = (state.currentIndex - 1 + state.visibleEntries.length) % state.visibleEntries.length;
    saveState();
    render();
    if (shouldContinue) playCurrent();
  }

  function moveNextForPlayback() {
    if (!state.visibleEntries.length) return;
    if (state.settings.random && state.visibleEntries.length > 1) {
      let next = state.currentIndex;
      while (next === state.currentIndex) next = Math.floor(Math.random() * state.visibleEntries.length);
      state.currentIndex = next;
    } else {
      state.currentIndex = (state.currentIndex + 1) % state.visibleEntries.length;
    }
    saveState();
    render();
  }

  // actions
  function hideCurrentEntry() {
    const entry = currentEntry();
    if (!entry) return;
    markHidden(entry.id);
    rebuildVisibleEntries();
    if (state.currentIndex >= state.visibleEntries.length) state.currentIndex = Math.max(0, state.visibleEntries.length - 1);
    saveState();
    render();
    showToast(`已移除：${entry.term}`);
  }

  function showHiddenEntries() {
    state.listMode = "hidden";
    const range = $("rangeFilter");
    if (range) range.value = "hidden";
    state.currentIndex = 0;
    render();
    openDrawer("libraryDrawer");
  }

  function editCurrentEntry() {
    const entry = currentEntry();
    if (entry) openEditDialog(entry);
  }

  function openEditDialog(entry) {
    state.currentEditEntryId = entry.id;
    const fields = {
      editTerm: entry.term,
      editMeaning: entry.meaning || "",
      editMorph: entry.morph || "",
      editExample: entry.example || "",
      editType: entry.type || inferEntryType(entry.term)
    };
    Object.entries(fields).forEach(([id, value]) => {
      const el = $(id);
      if (el) el.value = value;
    });
    const dialog = $("editDialog");
    if (dialog?.showModal) dialog.showModal();
    else saveEntryEditFromDialog();
  }

  function saveEntryEditFromDialog() {
    const entryId = state.currentEditEntryId;
    if (!entryId) return;
    const term = cleanDisplayText($("editTerm")?.value || "");
    const typeValue = $("editType")?.value || inferEntryType(term);
    saveEntryEdit(entryId, {
      term,
      meaning: cleanDisplayText($("editMeaning")?.value || ""),
      morph: cleanDisplayText($("editMorph")?.value || ""),
      example: cleanDisplayText($("editExample")?.value || ""),
      type: ["word", "phrase", "sentence"].includes(typeValue) ? typeValue : inferEntryType(term)
    });
    const dialog = $("editDialog");
    if (dialog?.open) dialog.close();
    state.currentEditEntryId = "";
  }

  function saveEntryEdit(entryId, patch) {
    saveOverride(entryId, patch);
    rebuildVisibleEntries();
    render();
    showToast("已保存编辑");
  }

  function restoreOriginalEntry(entryId) {
    removeOverride(entryId);
    rebuildVisibleEntries();
    render();
    showToast("已恢复原始条目");
  }

  function restoreAllHiddenEntries() {
    const count = (state.hiddenEntryIds[state.currentLibraryId] || []).length;
    if (!count) {
      showToast("暂无已移除条目");
      return;
    }
    if (!confirm(`确定恢复当前词库的 ${count} 个已移除条目？`)) return;
    state.hiddenEntryIds[state.currentLibraryId] = [];
    saveState();
    render();
    showToast("已恢复全部已移除条目");
  }

  // language helpers
  function containsChinese(value) {
    return /[\u4e00-\u9fff]/.test(String(value || ""));
  }

  function englishCharRatio(value) {
    const textValue = String(value || "");
    const chars = textValue.replace(/\s/g, "");
    if (!chars.length) return 0;
    return (chars.match(/[A-Za-z]/g) || []).length / chars.length;
  }

  function chineseCharRatio(value) {
    const textValue = String(value || "");
    const chars = textValue.replace(/\s/g, "");
    if (!chars.length) return 0;
    return (chars.match(/[\u4e00-\u9fff]/g) || []).length / chars.length;
  }

  function inferEntryType(term) {
    const textValue = String(term || "").trim();
    const words = textValue.match(/[A-Za-z]+(?:['-][A-Za-z]+)?/g) || [];
    if (words.length <= 1 && /^[A-Za-z]+(?:['-][A-Za-z]+)?$/.test(textValue)) return "word";
    if (/[.!?。！？]$/.test(textValue) || words.length >= 8) return "sentence";
    return "phrase";
  }

  function detectLanguageRatio(value) {
    return {
      english: englishCharRatio(value),
      chinese: chineseCharRatio(value)
    };
  }

  function isLikelyEnglishTerm(value) {
    const textValue = String(value || "").trim();
    return Boolean(textValue) && englishCharRatio(textValue) >= 0.45 && chineseCharRatio(textValue) < 0.35;
  }

  function isLikelyChineseMeaning(value) {
    const textValue = String(value || "").trim();
    return Boolean(textValue) && (containsChinese(textValue) || chineseCharRatio(textValue) >= 0.25);
  }

  function parseCsvLine(line) {
    const cells = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      const next = line[i + 1];
      if (char === '"' && next === '"' && inQuotes) {
        current += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = !inQuotes;
      } else if ((char === "," || char === "\t") && !inQuotes) {
        cells.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    cells.push(current.trim());
    return cells;
  }

  function parseLineToEntry(line, index) {
    const rawLine = String(line || "").trim();
    const base = {
      id: `pending-${index + 1}`,
      term: "",
      meaning: "",
      morph: "",
      example: "",
      type: "word",
      rawLine,
      warnings: [],
      suspectedError: false
    };
    if (!rawLine) return null;

    const csvCells = parseCsvLine(rawLine);
    if (csvCells.length >= 2 && (rawLine.includes(",") || rawLine.includes("\t"))) {
      base.term = cleanDisplayText(csvCells[0]);
      base.meaning = cleanDisplayText(csvCells[1]);
      base.morph = cleanDisplayText(csvCells[2] || "");
      base.example = cleanDisplayText(csvCells[3] || "");
      base.type = ["word", "phrase", "sentence"].includes(csvCells[4]) ? csvCells[4] : inferEntryType(base.term);
      return validateParsedEntry(base);
    }

    const markedParts = rawLine.split(/\s*(?:\||｜|—|--|：|:)\s*/).filter(Boolean);
    if (markedParts.length >= 2 && isLikelyEnglishTerm(markedParts[0])) {
      base.term = cleanDisplayText(markedParts[0]);
      base.meaning = cleanDisplayText(markedParts.slice(1).join("；"));
      base.type = inferEntryType(base.term);
      return validateParsedEntry(base);
    }

    const firstChinese = rawLine.search(/[\u4e00-\u9fff]/);
    if (firstChinese > 0) {
      base.term = cleanDisplayText(rawLine.slice(0, firstChinese).replace(/[，,;；:：-]+$/, ""));
      base.meaning = cleanDisplayText(rawLine.slice(firstChinese));
      base.type = inferEntryType(base.term);
      return validateParsedEntry(base);
    }

    const englishMatch = rawLine.match(/[A-Za-z][A-Za-z0-9'.,!?;:\s/-]*/);
    if (englishMatch && englishMatch.index != null) {
      base.term = cleanDisplayText(englishMatch[0]);
      base.meaning = cleanDisplayText(rawLine.replace(englishMatch[0], ""));
      base.type = inferEntryType(base.term);
      return validateParsedEntry(base);
    }

    base.term = rawLine;
    base.type = inferEntryType(base.term);
    base.warnings.push("unable-to-split");
    base.suspectedError = true;
    return validateParsedEntry(base);
  }

  function parseTextToEntries(textValue) {
    const lines = String(textValue || "")
      .replace(/\r/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !/^term\s*,\s*meaning/i.test(line));
    return lines.map(parseLineToEntry).filter(Boolean);
  }

  function validateParsedEntry(entry) {
    const preservedWarnings = (entry.warnings || []).filter((warning) => warning === "unable-to-split");
    const next = validateEntry({ ...entry, warnings: preservedWarnings, suspectedError: false });
    const termRatio = detectLanguageRatio(next.term);
    const meaningRatio = detectLanguageRatio(next.meaning);
    if (!next.term) next.warnings.push("term-empty");
    if (!next.meaning) next.warnings.push("meaning-empty");
    if (termRatio.chinese > 0.35) next.warnings.push("term-looks-chinese");
    if (meaningRatio.english > 0.65 && !containsChinese(next.meaning)) next.warnings.push("meaning-looks-english");
    if (next.type === "word" && cleanDisplayText(next.term).length > 32) next.warnings.push("word-term-too-long");
    if (isLikelyChineseMeaning(next.term)) next.warnings.push("term-may-be-meaning");
    if (isLikelyEnglishTerm(next.meaning) && !containsChinese(next.meaning)) next.warnings.push("meaning-may-be-term");
    next.suspectedError = next.suspectedError || next.warnings.length > 0;
    return next;
  }

  function renderImportPreview(entries = state.pendingImportEntries) {
    state.pendingImportEntries = entries;
    const preview = $("importPreview");
    const wrap = $("previewTableWrap");
    if (!preview || !wrap) return;
    preview.hidden = !entries.length;
    if (!entries.length) {
      wrap.innerHTML = "";
      return;
    }
    wrap.innerHTML = `
      <table class="preview-table">
        <thead>
          <tr>
            <th>term</th>
            <th>meaning</th>
            <th>morph</th>
            <th>example</th>
            <th>type</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          ${entries.map((entry, index) => previewRowHtml(entry, index)).join("")}
        </tbody>
      </table>
    `;
  }

  function previewRowHtml(entry, index) {
    return `
      <tr class="${entry.suspectedError ? "suspected" : ""}" data-import-row="${index}">
        <td><input data-import-index="${index}" data-field="term" value="${escapeHtml(entry.term)}"></td>
        <td><textarea data-import-index="${index}" data-field="meaning">${escapeHtml(entry.meaning)}</textarea></td>
        <td><textarea data-import-index="${index}" data-field="morph">${escapeHtml(entry.morph || "")}</textarea></td>
        <td><textarea data-import-index="${index}" data-field="example">${escapeHtml(entry.example || "")}</textarea></td>
        <td>
          <select data-import-index="${index}" data-field="type">
            ${["word", "phrase", "sentence"].map((type) => `<option value="${type}" ${entry.type === type ? "selected" : ""}>${TYPE_LABEL[type]}</option>`).join("")}
          </select>
        </td>
        <td class="status-cell">${escapeHtml(importStatusText(entry))}</td>
      </tr>
    `;
  }

  function importStatusText(entry) {
    return entry.suspectedError ? `需检查：${(entry.warnings || []).join(", ") || "疑似错误"}` : "正常";
  }

  function updateImportPreviewField(target) {
    const index = Number(target.dataset.importIndex);
    const field = target.dataset.field;
    if (!Number.isFinite(index) || !field || !state.pendingImportEntries[index]) return;
    state.pendingImportEntries[index][field] = cleanDisplayText(target.value);
    if (field === "term" && !target.closest("tr")?.querySelector('[data-field="type"]')?.value) {
      state.pendingImportEntries[index].type = inferEntryType(target.value);
    }
    state.pendingImportEntries[index] = validateParsedEntry(state.pendingImportEntries[index]);
    const row = target.closest("tr");
    if (row) {
      row.classList.toggle("suspected", Boolean(state.pendingImportEntries[index].suspectedError));
      const status = row.querySelector(".status-cell");
      if (status) status.textContent = importStatusText(state.pendingImportEntries[index]);
    }
  }

  async function handleImportFile(file) {
    if (!file) return;
    try {
      const textValue = await file.text();
      const entries = parseTextToEntries(textValue);
      if (!entries.length) throw new Error("没有解析出可导入条目");
      state.pendingImportFileName = file.name || `导入词库 ${new Date().toLocaleDateString()}`;
      renderImportPreview(entries);
      showToast(`已解析 ${entries.length} 条，请检查后确认导入`);
    } catch (error) {
      logError("handleImportFile", error, file.name);
      showStatus(`导入预览失败：${error.message || error}`);
    }
  }

  function confirmImport() {
    const entries = state.pendingImportEntries
      .map((entry, index) => validateParsedEntry({
        ...entry,
        id: `user-${Date.now()}-${index + 1}`,
        term: cleanDisplayText(entry.term),
        meaning: cleanDisplayText(entry.meaning),
        morph: cleanDisplayText(entry.morph || ""),
        example: cleanDisplayText(entry.example || ""),
        type: ["word", "phrase", "sentence"].includes(entry.type) ? entry.type : inferEntryType(entry.term)
      }))
      .filter((entry) => entry.term);
    if (!entries.length) {
      showStatus("没有可导入的有效条目");
      return;
    }
    const library = saveUserLibrary({
      id: `user-${Date.now()}`,
      name: state.pendingImportFileName || `导入词库 ${new Date().toLocaleString()}`,
      source: state.pendingImportFileName || "用户导入",
      entries
    });
    cancelImport(false);
    loadLibrary(library.id);
    showToast(`已导入用户词库：${library.name}`);
  }

  function cancelImport(showMessage = true) {
    state.pendingImportEntries = [];
    state.pendingImportFileName = "";
    const preview = $("importPreview");
    const wrap = $("previewTableWrap");
    const input = $("importFileInput");
    if (preview) preview.hidden = true;
    if (wrap) wrap.innerHTML = "";
    if (input) input.value = "";
    if (showMessage) showToast("已取消导入");
  }

  function saveUserLibrary(library) {
    const normalized = normalizeUserLibrary(library, state.userLibraries.length);
    const oldIndex = state.userLibraries.findIndex((item) => item.id === normalized.id);
    if (oldIndex >= 0) state.userLibraries.splice(oldIndex, 1, normalized);
    else state.userLibraries.push(normalized);
    state.libraries = state.libraries.filter((item) => item.id !== normalized.id);
    state.libraries.push(normalizeLibraryMeta(normalized, state.userLibraries.length - 1, true));
    saveState();
    renderLibraryOptions();
    return normalized;
  }

  function deleteCurrentUserLibrary() {
    const meta = state.libraries.find((lib) => lib.id === state.currentLibraryId);
    if (!meta?.isUser) {
      showToast("内置词库不能删除");
      return;
    }
    if (!confirm(`确定删除用户词库“${meta.name}”？这不会影响内置词库。`)) return;
    state.userLibraries = state.userLibraries.filter((library) => library.id !== meta.id);
    delete state.hiddenEntryIds[meta.id];
    delete state.learnedEntryIds[meta.id];
    delete state.difficultEntryIds[meta.id];
    delete state.userOverrides[meta.id];
    saveState();
    initLibraries().then(() => {
      const fallback = state.libraries.find((lib) => !lib.isUser)?.id || state.libraries[0]?.id || "";
      if (fallback) loadLibrary(fallback);
      else render();
    });
  }

  function exportBackup() {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const payload = {
        app: "cet-reader",
        version: APP_VERSION,
        exportedAt: new Date().toISOString(),
        currentLibraryId: state.currentLibraryId,
        currentIndex: state.currentIndex,
        settings: state.settings,
        hiddenEntryIds: state.hiddenEntryIds,
        learnedEntryIds: state.learnedEntryIds,
        difficultEntryIds: state.difficultEntryIds,
        userOverrides: state.userOverrides,
        userLibraries: state.userLibraries,
        stats: {
          currentLibraryName: state.currentLibrary?.name || "",
          visibleCount: state.visibleEntries.length,
          learnedCount: (state.learnedEntryIds[state.currentLibraryId] || []).length,
          difficultCount: (state.difficultEntryIds[state.currentLibraryId] || []).length,
          hiddenCount: (state.hiddenEntryIds[state.currentLibraryId] || []).length
        }
      };
      downloadBlob(
        new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
        `cet-reader-backup-${today}.json`
      );
      showToast("备份已导出");
    } catch (error) {
      logError("exportBackup", error);
      showStatus(`导出备份失败：${error.message || error}`);
    }
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importBackup(file) {
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      const looksValid = payload?.app === "cet-reader"
        || payload?.settings
        || payload?.hiddenEntryIds
        || payload?.userLibraries;
      if (!looksValid) throw new Error("不是有效的 CET Reader 备份文件");
      if (!confirm("确定导入备份？会合并用户词库、编辑、移除、不熟和设置。")) return;

      state.settings = { ...DEFAULT_SETTINGS, ...(payload.settings || {}) };
      state.hiddenEntryIds = mergeListMaps(state.hiddenEntryIds, payload.hiddenEntryIds);
      state.learnedEntryIds = mergeListMaps(state.learnedEntryIds, payload.learnedEntryIds);
      state.difficultEntryIds = mergeListMaps(state.difficultEntryIds, payload.difficultEntryIds);
      state.userOverrides = mergeObjectMaps(state.userOverrides, payload.userOverrides);
      mergeUserLibraries(payload.userLibraries);
      state.currentLibraryId = payload.currentLibraryId || state.currentLibraryId;
      state.currentIndex = Number(payload.currentIndex) || 0;
      saveState();
      await initLibraries();
      const target = state.libraries.some((lib) => lib.id === state.currentLibraryId)
        ? state.currentLibraryId
        : state.libraries[0]?.id;
      if (target) await loadLibrary(target);
      render();
      showToast("备份已导入");
    } catch (error) {
      logError("importBackup", error, file.name);
      showStatus(`导入备份失败：${error.message || error}`);
    } finally {
      const input = $("backupInput");
      if (input) input.value = "";
    }
  }

  function mergeListMaps(base, incoming) {
    const result = validMap(base);
    const data = validMap(incoming);
    Object.keys(data).forEach((libraryId) => {
      const set = new Set(Array.isArray(result[libraryId]) ? result[libraryId] : []);
      (Array.isArray(data[libraryId]) ? data[libraryId] : []).forEach((id) => set.add(id));
      result[libraryId] = Array.from(set);
    });
    return result;
  }

  function mergeObjectMaps(base, incoming) {
    const result = validMap(base);
    const data = validMap(incoming);
    Object.keys(data).forEach((libraryId) => {
      result[libraryId] = { ...(result[libraryId] || {}), ...(validMap(data[libraryId])) };
    });
    return result;
  }

  function mergeUserLibraries(incoming) {
    if (!Array.isArray(incoming)) return;
    incoming.forEach((library, index) => {
      try {
        const normalized = normalizeUserLibrary(library, index);
        const existing = state.userLibraries.findIndex((item) => item.id === normalized.id);
        if (existing >= 0) state.userLibraries.splice(existing, 1, normalized);
        else state.userLibraries.push(normalized);
      } catch (error) {
        logError("mergeUserLibraries", error, library?.name || `导入词库 ${index + 1}`);
      }
    });
  }

  function resetProgress() {
    if (!confirm("确定重置学习进度？会清空已移除、已学、不熟和当前位置，但保留编辑、用户词库和设置。")) return;
    state.hiddenEntryIds = {};
    state.learnedEntryIds = {};
    state.difficultEntryIds = {};
    state.currentIndex = 0;
    saveState();
    render();
    showToast("学习进度已重置");
  }

  async function resetAllUserData() {
    if (!confirm("确定清空全部用户数据？会清空编辑、移除、不熟、导入词库和设置。")) return;
    try {
      localStorage.removeItem(STORAGE_KEY);
      state.currentLibraryId = "";
      state.currentLibrary = null;
      state.entries = [];
      state.visibleEntries = [];
      state.currentIndex = 0;
      state.filterType = "all";
      state.searchKeyword = "";
      state.hiddenEntryIds = {};
      state.learnedEntryIds = {};
      state.difficultEntryIds = {};
      state.userOverrides = {};
      state.userLibraries = [];
      state.pendingImportEntries = [];
      state.pendingImportFileName = "";
      state.settings = { ...DEFAULT_SETTINGS };
      await initLibraries();
      if (state.libraries[0]) await loadLibrary(state.libraries[0].id);
      render();
      showToast("全部用户数据已清空");
    } catch (error) {
      logError("resetAllUserData", error);
      showStatus(`清空失败：${error.message || error}`);
    }
  }

  function renderErrorLog() {
    const box = $("errorLogBox");
    if (!box) return;
    if (!state.errors.length) {
      box.textContent = "暂无错误日志";
      return;
    }
    box.textContent = state.errors.slice(-80).map((item) => (
      `[${item.time}] ${item.level || "error"} ${item.action}: ${item.message}${item.detail ? `\n  ${item.detail}` : ""}`
    )).join("\n\n");
  }

  async function copyErrorLogs() {
    try {
      const content = state.errors.length ? state.errors.map((item) => JSON.stringify(item)).join("\n") : "暂无错误日志";
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(content);
      else copyTextFallback(content);
      showToast("错误日志已复制");
    } catch (error) {
      logError("copyErrorLogs", error);
      showStatus(`复制日志失败：${error.message || error}`);
    }
  }

  function copyTextFallback(content) {
    const textarea = document.createElement("textarea");
    textarea.value = content;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  function setPwaStatus(message, ok = false) {
    const status = $("pwaStatus");
    if (status) {
      status.textContent = message;
      status.classList.toggle("status-ok", ok);
      status.classList.toggle("status-warn", !ok);
    }
  }

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) {
      setPwaStatus("当前浏览器不支持离线缓存");
      return;
    }
    const isLocalhost = ["localhost", "127.0.0.1", "::1"].includes(location.hostname);
    const canRegister = location.protocol === "https:" || (location.protocol === "http:" && isLocalhost);
    if (!canRegister) {
      setPwaStatus("用本地服务器或 GitHub Pages 打开后可启用离线缓存；file:// 下不会注册 PWA 缓存。");
      return;
    }
    try {
      await navigator.serviceWorker.register("./sw.js");
      setPwaStatus("离线缓存已启用", true);
      showStatus("离线缓存已启用");
    } catch (error) {
      logError("registerServiceWorker", error, "./sw.js");
      setPwaStatus(`离线缓存注册失败：${error.message || error}`);
    }
  }

  async function refreshCache() {
    try {
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      }
      if ("caches" in window) {
        const names = await caches.keys();
        await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX)).map((name) => caches.delete(name)));
      }
      showToast("缓存已刷新，正在重新加载");
      setTimeout(() => location.reload(), 250);
    } catch (error) {
      logError("refreshCache", error);
      showStatus(`刷新缓存失败：${error.message || error}`);
    }
  }

  function isDifficult(entryId) {
    return (state.difficultEntryIds[state.currentLibraryId] || []).includes(entryId);
  }

  // events
  function bindEvents() {
    on("libraryBtn", "click", () => openDrawer("libraryDrawer"));
    on("settingsBtn", "click", () => openDrawer("settingsDrawer"));
    on("drawerBackdrop", "click", closeDrawers);
    document.querySelectorAll(".close-drawer").forEach((button) => {
      button.addEventListener("click", () => closeDrawer(button.dataset.close));
    });
    document.querySelectorAll("[data-list-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll("[data-list-tab]").forEach((item) => item.classList.remove("active"));
        button.classList.add("active");
        state.listMode = button.dataset.listTab === "removed" ? "hidden" : "current";
        const range = $("rangeFilter");
        if (range) range.value = state.listMode === "hidden" ? "hidden" : "active";
        state.currentIndex = 0;
        render();
      });
    });

    on("loadLibraryBtn", "click", () => loadLibrary($("librarySelect")?.value || state.currentLibraryId));
    on("librarySelect", "change", (event) => loadLibrary(event.target.value));
    on("searchInput", "input", (event) => {
      state.searchKeyword = event.target.value || "";
      state.currentIndex = 0;
      saveState();
      render();
    });
    on("typeFilter", "change", (event) => {
      state.filterType = event.target.value || "all";
      state.currentIndex = 0;
      saveState();
      render();
    });
    on("rangeFilter", "change", (event) => {
      state.listMode = event.target.value === "hidden" ? "hidden" : "current";
      state.currentIndex = 0;
      saveState();
      render();
    });
    on("autoPlayToggle", "change", (event) => {
      state.settings.autoPlay = Boolean(event.target.checked);
      saveState();
    });
    on("randomToggle", "change", (event) => {
      state.settings.random = Boolean(event.target.checked);
      saveState();
    });
    on("recallToggle", "change", (event) => {
      state.settings.recallMode = Boolean(event.target.checked);
      saveState();
      render();
    });
    on("speakMeaningToggle", "change", (event) => {
      state.settings.speakChinese = Boolean(event.target.checked);
      saveState();
      render();
    });
    on("speakMorphToggle", "change", (event) => {
      state.settings.speakMorph = Boolean(event.target.checked);
      saveState();
      render();
    });
    on("speakExampleToggle", "change", (event) => {
      state.settings.speakExample = Boolean(event.target.checked);
      saveState();
      render();
    });
    on("spellToggle", "change", (event) => {
      state.settings.spellWords = Boolean(event.target.checked);
      saveState();
      render();
    });
    on("repeatInput", "change", (event) => {
      state.settings.repeatEnglish = Number(event.target.value) || 2;
      saveState();
      render();
    });
    on("rateInput", "input", (event) => {
      state.settings.rate = Number(event.target.value) || 0.9;
      saveState();
    });
    on("pitchInput", "input", (event) => {
      state.settings.pitch = Number(event.target.value) || 1;
      saveState();
    });
    on("volumeInput", "input", (event) => {
      state.settings.volume = Number(event.target.value);
      saveState();
    });
    on("englishVoiceSelect", "change", (event) => {
      state.settings.englishVoiceURI = event.target.value || "";
      saveState();
      render();
    });
    on("chineseVoiceSelect", "change", (event) => {
      state.settings.chineseVoiceURI = event.target.value || "";
      saveState();
      render();
    });

    on("playPauseBtn", "click", () => {
      if (state.isPlaying) stopSpeaking();
      else playCurrent();
    });
    on("prevBtn", "click", playPrev);
    on("nextBtn", "click", playNext);
    on("nextCardBtn", "click", playNext);
    on("replayBtn", "click", replayCurrent);
    on("removeCurrentBtn", "click", hideCurrentEntry);
    on("difficultCurrentBtn", "click", () => {
      const entry = currentEntry();
      if (!entry) return;
      toggleDifficult(entry.id);
      render();
    });
    on("editCurrentBtn", "click", editCurrentEntry);
    on("showHiddenBtn", "click", showHiddenEntries);
    on("restoreAllBtn", "click", restoreAllHiddenEntries);
    on("deleteLibraryBtn", "click", deleteCurrentUserLibrary);
    on("showAnswerBtn", "click", () => {
      state.settings.recallMode = !state.settings.recallMode;
      const toggle = $("recallToggle");
      if (toggle) toggle.checked = state.settings.recallMode;
      saveState();
      render();
    });
    on("togglePreviewBtn", "click", () => {
      const el = $("speechPreview");
      if (el) el.hidden = !el.hidden;
    });

    const list = $("entryList");
    if (list) {
      list.addEventListener("click", (event) => {
        const actionButton = event.target.closest("[data-action]");
        if (actionButton) {
          const entryId = actionButton.dataset.id;
          if (actionButton.dataset.action === "hide") markHidden(entryId);
          if (actionButton.dataset.action === "restore") restoreHidden(entryId);
          if (actionButton.dataset.action === "edit") {
            const entry = state.visibleEntries.find((item) => item.id === entryId)
              || (state.currentLibrary?.entries || []).map(applyOverride).find((item) => item.id === entryId);
            if (entry) openEditDialog(entry);
          }
          rebuildVisibleEntries();
          render();
          return;
        }
        const item = event.target.closest("[data-index]");
        if (item) {
          state.currentIndex = Number(item.dataset.index) || 0;
          saveState();
          render();
        }
      });
    }

    on("importFileInput", "change", (event) => handleImportFile(event.target.files?.[0]));
    const previewWrap = $("previewTableWrap");
    if (previewWrap) {
      previewWrap.addEventListener("input", (event) => {
        if (event.target.matches("[data-import-index][data-field]")) updateImportPreviewField(event.target);
      });
      previewWrap.addEventListener("change", (event) => {
        if (event.target.matches("[data-import-index][data-field]")) updateImportPreviewField(event.target);
      });
    }
    on("confirmImportBtn", "click", confirmImport);
    on("cancelImportBtn", "click", () => cancelImport(true));
    on("exportBackupBtn", "click", exportBackup);
    on("backupInput", "change", (event) => importBackup(event.target.files?.[0]));
    on("refreshCacheBtn", "click", refreshCache);
    on("resetProgressBtn", "click", resetProgress);
    on("resetAllBtn", "click", resetAllUserData);
    on("copyErrorsBtn", "click", copyErrorLogs);
    on("copyErrorsBtn2", "click", copyErrorLogs);

    const editForm = $("editForm");
    if (editForm) {
      editForm.addEventListener("submit", (event) => {
        event.preventDefault();
        if (event.submitter?.value !== "save") {
          const dialog = $("editDialog");
          if (dialog?.open) dialog.close();
          state.currentEditEntryId = "";
          return;
        }
        saveEntryEditFromDialog();
      });
    }
    on("restoreOriginalBtn", "click", () => {
      if (!state.currentEditEntryId) return;
      if (!confirm("确定恢复该条目的原始内容？")) return;
      restoreOriginalEntry(state.currentEditEntryId);
      const dialog = $("editDialog");
      if (dialog?.open) dialog.close();
      state.currentEditEntryId = "";
    });

    if ("speechSynthesis" in window) {
      refreshVoices();
      window.speechSynthesis.onvoiceschanged = refreshVoices;
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }

  function openDrawer(id) {
    const drawer = $(id);
    const backdrop = $("drawerBackdrop");
    if (drawer) drawer.hidden = false;
    if (backdrop) backdrop.hidden = false;
  }

  function closeDrawer(id) {
    const drawer = $(id);
    if (drawer) drawer.hidden = true;
    const anyOpen = Array.from(document.querySelectorAll(".drawer")).some((item) => !item.hidden);
    const backdrop = $("drawerBackdrop");
    if (backdrop) backdrop.hidden = !anyOpen;
  }

  function closeDrawers() {
    document.querySelectorAll(".drawer").forEach((drawer) => {
      drawer.hidden = true;
    });
    const backdrop = $("drawerBackdrop");
    if (backdrop) backdrop.hidden = true;
  }

  // errors/status
  function logInfo(action, detail = "") {
    const item = {
      time: new Date().toISOString(),
      level: "info",
      action,
      message: "运行状态",
      detail
    };
    state.errors.push(item);
    renderErrorLog();
    console.info("[CET Reader]", item);
  }

  function logError(action, error, detail = "") {
    const item = {
      time: new Date().toISOString(),
      level: "error",
      action,
      message: error?.message || String(error),
      detail
    };
    state.errors.push(item);
    renderErrorLog();
    console.error("[CET Reader]", item, error);
  }

  function showToast(message) {
    showStatus(message);
  }

  function showStatus(message) {
    text("playerStatus", message);
    const banner = $("errorBanner");
    if (banner && /失败|错误|损坏|不支持/.test(message)) {
      banner.hidden = false;
      text("errorTitle", "提示");
      text("errorMessage", message);
    }
  }

  // init
  async function init() {
    ensureBasicApp();
    loadState();
    bindEvents();
    await initLibraries();
    const target = state.currentLibraryId && state.libraries.some((lib) => lib.id === state.currentLibraryId)
      ? state.currentLibraryId
      : state.libraries[0]?.id;
    if (target) await loadLibrary(target);
    render();
    registerServiceWorker();
  }

  document.addEventListener("DOMContentLoaded", init);

  // expose minimal API for manual testing
  window.cetReader = {
    state,
    loadLibrary,
    playCurrent,
    stopSpeaking,
    sanitizeForSpeech,
    sanitizeEnglishForSpeech,
    sanitizeChineseForSpeech,
    morphToSpeakableText,
    buildPlayPlan,
    markHidden,
    restoreHidden,
    saveOverride,
    removeOverride,
    fetchJsonWithFallback,
    validateLibrary,
    exportBackup,
    importBackup,
    refreshCache
  };
})();
