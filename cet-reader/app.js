/* 四六级朗读学习器：基础稳定版 app.js */
(() => {
  "use strict";

  // constants
  const APP_VERSION = "pwa-2026-06-11";
  const STORAGE_KEY = "cet-reader-basic-state-v1";
  const CACHE_PREFIX = "cet-reader-cache";
  const AUDIO_CACHE_PREFIX = "cet-reader-audio-cache";
  const TYPE_LABEL = { word: "单词", phrase: "词组", sentence: "句子", root: "词根", correction: "纠错", summary: "总结" };
  const ENTRY_TYPES = ["word", "phrase", "sentence", "root", "correction", "summary"];
  const LEARNABLE_TYPES = new Set(["word", "phrase", "sentence"]);
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
    loopPlayback: false,
    recallMode: false,
    audioMode: "auto"
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
    favoriteEntryIds: {},
    dailyStudyIds: {},
    playCountByEntry: {},
    userOverrides: {},
    userLibraries: [],
    progressByLibrary: {},
    pendingImportEntries: [],
    pendingImportFileName: "",
    currentEditEntryId: "",
    availableVoices: [],
    lastSpeechError: "",
    lastSpeechTimeout: "",
    settings: { ...DEFAULT_SETTINGS },
    currentView: "launch",
    lastAudioSource: "检测中",
    listMode: "current",
    errors: []
  };

  let wakeLock = null;
  let voicesReady = null;
  let wakeLockNoticeShown = false;
  let currentAudio = null;
  let playbackSeenEntryIds = new Set();

  exposeDebugState();

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

  function setImage(id, src) {
    const el = $(id);
    if (el) el.setAttribute("src", src);
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
          <select id="typeFilter"><option value="all">全部</option><option value="word">单词</option><option value="phrase">词组</option><option value="sentence">句子</option><option value="root">词根</option><option value="correction">纠错</option><option value="summary">总结</option><option value="suspected">疑似错误</option></select>
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
  function exposeDebugState() {
    try {
      Object.defineProperty(window, "cetReaderState", {
        value: state,
        writable: true,
        configurable: true
      });
      Object.defineProperty(globalThis, "cetReaderState", {
        value: state,
        writable: true,
        configurable: true
      });
      Object.defineProperty(self, "cetReaderState", {
        value: state,
        writable: true,
        configurable: true
      });
      if (window.top && window.top !== window) {
        Object.defineProperty(window.top, "cetReaderState", {
          value: state,
          writable: true,
          configurable: true
        });
      }
    } catch (error) {
      window.cetReaderState = state;
      globalThis.cetReaderState = state;
      self.cetReaderState = state;
    }
  }

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
      state.favoriteEntryIds = validMap(saved.favoriteEntryIds);
      state.dailyStudyIds = validMap(saved.dailyStudyIds);
      state.playCountByEntry = validMap(saved.playCountByEntry);
      state.userOverrides = validMap(saved.userOverrides);
      state.userLibraries = normalizeSavedUserLibraries(saved.userLibraries);
      state.progressByLibrary = validMap(saved.progressByLibrary);
      if (!saved.progressByLibrary && state.currentLibraryId) {
        state.progressByLibrary[state.currentLibraryId] = {
          currentIndex: state.currentIndex,
          currentEntryId: "",
          updatedAt: Date.now(),
          migratedFromLegacy: true
        };
      }
      state.settings = { ...DEFAULT_SETTINGS, ...(saved.settings || {}) };
      state.currentView = saved.currentView || "launch";
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
        favoriteEntryIds: state.favoriteEntryIds,
        dailyStudyIds: state.dailyStudyIds,
        playCountByEntry: state.playCountByEntry,
        userOverrides: state.userOverrides,
        userLibraries: state.userLibraries,
        progressByLibrary: state.progressByLibrary,
        settings: state.settings,
        currentView: state.currentView
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
    markLearned(entryId);
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

  function markLearned(entryId) {
    addToList(state.learnedEntryIds, entryId);
    const today = todayKey();
    if (!Array.isArray(state.dailyStudyIds[today])) state.dailyStudyIds[today] = [];
    if (!state.dailyStudyIds[today].includes(entryId)) state.dailyStudyIds[today].push(entryId);
    saveState();
  }

  function todayKey() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function incrementPlayCount(entryId) {
    if (!entryId) return;
    const key = `${state.currentLibraryId}:${entryId}`;
    state.playCountByEntry[key] = (Number(state.playCountByEntry[key]) || 0) + 1;
    saveState();
  }

  function getPlayCount(entryId) {
    return Number(state.playCountByEntry[`${state.currentLibraryId}:${entryId}`]) || 0;
  }

  function toggleDifficult(entryId) {
    const list = listFor(state.difficultEntryIds);
    if (list.includes(entryId)) removeFromList(state.difficultEntryIds, entryId);
    else markDifficult(entryId);
    saveState();
  }

  function toggleFavorite(entryId) {
    const list = listFor(state.favoriteEntryIds);
    if (list.includes(entryId)) removeFromList(state.favoriteEntryIds, entryId);
    else addToList(state.favoriteEntryIds, entryId);
    saveState();
  }

  function isFavorite(entryId) {
    return (state.favoriteEntryIds[state.currentLibraryId] || []).includes(entryId);
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
        const data = await fetchJsonWithFallback(["./data/builtin-index.json"], "加载词库索引");
        builtinLibraries = data.libraries || [];
      }
      const builtinMetas = builtinLibraries.map((lib, index) => normalizeLibraryMeta(lib, index, false));
      const userMetas = state.userLibraries.map((lib, index) => normalizeLibraryMeta(lib, index, true));
      state.libraries = [...builtinMetas, ...userMetas];
      if (!state.libraries.length) throw new Error("没有可用词库");
      renderLibraryOptions();
    } catch (error) {
      logError("initLibraries", error, "尝试 ./data/builtin-index.json 或 BUILTIN_FILES");
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

  function getLatestBuiltinLibraryMeta() {
    const builtins = state.libraries.filter((library) => !library.isUser);
    return builtins[builtins.length - 1] || state.libraries[0] || null;
  }

  function preferredLibraryId() {
    if (state.currentLibraryId && state.libraries.some((library) => library.id === state.currentLibraryId)) {
      return state.currentLibraryId;
    }
    return getLatestBuiltinLibraryMeta()?.id || state.libraries[0]?.id || "";
  }

  async function loadLibrary(libraryId) {
    if (state.currentLibraryId && state.currentLibrary) saveCurrentProgress("before-switch-library");
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
        rawLibrary = await fetchJsonWithFallback([`./data/${fileName}`], `加载${meta.name}`);
      }
      const library = normalizeLibrary(rawLibrary, meta);
      validateLibrary(library);
      state.currentLibraryId = library.id;
      state.currentLibrary = library;
      state.entries = library.entries;
      rebuildVisibleEntries();
      restoreProgressForLibrary(library.id);
      saveState();
      render();
      showStatus(`已加载：${library.name}，${library.entries.length} 条`);
    } catch (error) {
      const detail = meta.file ? `尝试 ./data/${meta.file}` : `尝试加载 ${meta.name}`;
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
      type: ENTRY_TYPES.includes(raw.type) ? raw.type : inferEntryType(raw.term || ""),
      rawType: raw.type || "",
      wrong: cleanDisplayText(raw.wrong || ""),
      note: cleanDisplayText(raw.note || ""),
      source: raw.source || library?.source || "",
      section: cleanDisplayText(raw.section || ""),
      warnings: Array.isArray(raw.warnings) ? raw.warnings : [],
      suspectedError: Boolean(raw.suspectedError),
      audio: raw.audio && typeof raw.audio === "object" && !Array.isArray(raw.audio) ? raw.audio : {}
    };
    validateEntry(entry);
    classifyEntry(entry);
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
    if (!ENTRY_TYPES.includes(entry.type)) entry.type = inferEntryType(entry.term);
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

  function classifyEntry(entry) {
    normalizeCorrectionEntry(entry);
    if (isCorrectionLike(entry)) entry.type = "correction";
    else if (isRootLike(entry)) entry.type = "root";
    else if (isSummaryLike(entry)) entry.type = "summary";
    if (!hasValidChineseMeaning(entry)) {
      entry.suspectedError = true;
      if (!entry.warnings.includes("meaning-missing-or-not-chinese")) entry.warnings.push("meaning-missing-or-not-chinese");
    }
    if (hasTooMuchEnglishInMeaning(entry)) {
      entry.suspectedError = true;
      if (!entry.warnings.includes("meaning-too-much-english")) entry.warnings.push("meaning-too-much-english");
    }
    return entry;
  }

  function normalizeCorrectionEntry(entry) {
    const term = entry.term.toLowerCase();
    const corrections = {
      reconstitude: { term: "reconstitute", meaning: "重新组成；重新配制；加水复原" },
      "rest assure": { term: "rest assured", meaning: "放心；请放心；可以确信" },
      "cracking code": { term: "cracking the code", meaning: "破解密码；破译规律；理解关键方法" }
    };
    if (corrections[term]) {
      const fix = corrections[term];
      entry.wrong = entry.term;
      entry.note = `原资料写作 ${entry.term}，建议改为 ${fix.term}`;
      entry.term = fix.term;
      entry.meaning = fix.meaning;
      entry.type = "correction";
      entry.suspectedError = true;
      if (!entry.warnings.includes("manual-correction")) entry.warnings.push("manual-correction");
    }
    if (/catalogue\s*\/\s*catalog|catalog\s*\/\s*catalogue/i.test(entry.term)) {
      entry.term = "catalogue / catalog";
      entry.meaning = "目录；清单；登记；编目";
    }
    return entry;
  }

  function isCorrectionLike(entry) {
    const combined = `${entry.term} ${entry.meaning} ${entry.example}`.toLowerCase();
    return entry.type === "correction" || combined.includes("=>") || /reconstitude|rest assure|cracking code/.test(combined);
  }

  function isRootLike(entry) {
    const term = entry.term.toLowerCase().replace(/\s+/g, "");
    const rootTerms = new Set(["rupt", "mort", "fin", "dis-", "fine/fin-", "fine/fin"]);
    const hasDerivativeList = englishCharRatio(`${entry.meaning} ${entry.example}`) > 0.65 && /[,，;；/]/.test(`${entry.meaning} ${entry.example}`);
    return entry.type === "root" || rootTerms.has(term) || (/^[a-z-]{2,8}$/.test(term) && hasDerivativeList && !containsChinese(entry.meaning));
  }

  function isSummaryLike(entry) {
    const term = entry.term;
    const englishWords = term.match(/[A-Za-z]+/g) || [];
    const separators = (term.match(/[,，;；/]/g) || []).length;
    return entry.type === "summary"
      || term.length > 90
      || (englishWords.length >= 8 && separators >= 3)
      || (!containsChinese(entry.meaning) && englishWords.length >= 5 && entry.meaning.length > 20);
  }

  function hasValidChineseMeaning(entry) {
    return Boolean(entry.meaning) && containsChinese(entry.meaning);
  }

  function hasTooMuchEnglishInMeaning(entry) {
    return Boolean(entry.meaning) && englishCharRatio(entry.meaning) > 0.7 && !containsChinese(entry.meaning);
  }

  function applyOverride(entry) {
    const override = state.userOverrides[state.currentLibraryId]?.[entry.id];
    return override ? classifyEntry(validateEntry({ ...entry, ...override, id: entry.id })) : entry;
  }

  function isEntryHidden(entryId) {
    return (state.hiddenEntryIds[state.currentLibraryId] || []).includes(entryId);
  }

  function rebuildVisibleEntries() {
    const keyword = state.searchKeyword.trim().toLowerCase();
    const hidden = new Set(state.hiddenEntryIds[state.currentLibraryId] || []);
    const difficult = new Set(state.difficultEntryIds[state.currentLibraryId] || []);
    const favorite = new Set(state.favoriteEntryIds[state.currentLibraryId] || []);
    const learned = new Set(state.learnedEntryIds[state.currentLibraryId] || []);
    const range = $("rangeFilter")?.value || (state.listMode === "hidden" ? "hidden" : "active");
    let entries = (state.currentLibrary?.entries || []).map(applyOverride);

    if (range === "active") {
      entries = entries.filter((entry) => !hidden.has(entry.id));
    }
    if (range === "difficult") {
      entries = entries.filter((entry) => !hidden.has(entry.id) && difficult.has(entry.id));
    } else if (range === "favorite") {
      entries = entries.filter((entry) => !hidden.has(entry.id) && favorite.has(entry.id));
    } else if (range === "unlearned") {
      entries = entries.filter((entry) => !hidden.has(entry.id) && !learned.has(entry.id));
    } else if (range === "hidden") {
      entries = entries.filter((entry) => hidden.has(entry.id));
    }

    if (state.filterType === "all") {
      entries = entries.filter((entry) => LEARNABLE_TYPES.has(entry.type));
    } else if (state.filterType === "suspected") {
      entries = entries.filter((entry) => entry.suspectedError);
    } else {
      entries = entries.filter((entry) => entry.type === state.filterType);
    }

    if (keyword) {
      entries = entries.filter((entry) => {
        const haystack = [entry.term, entry.meaning, entry.morph, entry.example, entry.wrong, entry.note].join(" ").toLowerCase();
        return haystack.includes(keyword);
      });
    }

    state.visibleEntries = entries;
    clampCurrentIndex();
  }

  function getProgress(libraryId = state.currentLibraryId) {
    if (!state.progressByLibrary[libraryId]) {
      state.progressByLibrary[libraryId] = { currentIndex: 0, currentEntryId: "", updatedAt: 0 };
    }
    return state.progressByLibrary[libraryId];
  }

  function findEntryIndexById(entryId) {
    if (!entryId) return -1;
    return state.visibleEntries.findIndex((entry) => entry.id === entryId);
  }

  function clampCurrentIndex() {
    const length = state.visibleEntries.length;
    if (!length) {
      state.currentIndex = 0;
      return 0;
    }
    state.currentIndex = Math.max(0, Math.min(Number(state.currentIndex) || 0, length - 1));
    return state.currentIndex;
  }

  function saveCurrentProgress(reason = "update") {
    if (!state.currentLibraryId) return;
    const entry = getCurrentEntry();
    state.progressByLibrary[state.currentLibraryId] = {
      currentIndex: clampCurrentIndex(),
      currentEntryId: entry?.id || "",
      updatedAt: Date.now(),
      reason
    };
  }

  function restoreProgressForLibrary(libraryId = state.currentLibraryId) {
    const progress = getProgress(libraryId);
    const byId = findEntryIndexById(progress.currentEntryId);
    if (byId >= 0) state.currentIndex = byId;
    else state.currentIndex = Number(progress.currentIndex) || 0;
    clampCurrentIndex();
    saveCurrentProgress("restore-progress");
  }

  function setCurrentIndex(index, reason = "set-index", shouldRender = true) {
    state.currentIndex = Number(index) || 0;
    clampCurrentIndex();
    saveCurrentProgress(reason);
    saveState();
    if (shouldRender) render();
  }

  function getCurrentEntry() {
    clampCurrentIndex();
    return state.visibleEntries[state.currentIndex] || null;
  }

  function currentEntry() {
    return getCurrentEntry();
  }

  // render
  function render() {
    rebuildVisibleEntries();
    syncControls();
    renderLibraryOptions();
    renderLibraryActions();
    renderCard();
    renderActionStates();
    renderStats();
    renderHomeStats();
    renderFeaturedLibrary();
    renderLibraryCards();
    renderList();
    renderPlayer();
    renderErrorLog();
    updateSpeechDiagnosticsUI();
    renderBrowserCompat();
    renderAppMeta();
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
    const loopPlayback = $("loopPlaybackToggle");
    if (loopPlayback) loopPlayback.checked = Boolean(state.settings.loopPlayback);
    const audioSource = $("audioSourceSelect");
    if (audioSource) audioSource.value = state.settings.audioMode || "auto";
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
      const emptyMessage = state.searchKeyword
        ? "没有匹配条目"
        : state.currentLibrary ? "当前筛选没有条目" : "请选择词库";
      text("termText", emptyMessage);
      text("meaningText", "");
      text("morphText", "");
      text("exampleText", "");
      text("entryType", "条目");
      text("entryIndex", "0 / 0");
      text("speechPreview", "");
      text("phoneticText", "美音优先");
      updateFavoriteButton(null);
      return;
    }

    text("termText", entry.term);
    text("phoneticText", `${entry.section || "当前条目"} · 已播放 ${getPlayCount(entry.id)} 次`);
    text("meaningText", state.settings.recallMode ? "（背诵模式：点击显示答案）" : entry.meaning);
    const detailText = entry.type === "correction"
      ? [entry.wrong ? `错误写法：${entry.wrong}` : "", entry.note, entry.morph].filter(Boolean).join("\n")
      : entry.type === "root"
        ? [entry.morph || "词根/构词法资料", entry.note].filter(Boolean).join("\n")
        : entry.morph;
    text("morphText", state.settings.recallMode ? "" : detailText);
    text("exampleText", state.settings.recallMode ? "" : entry.example);
    text("entryType", TYPE_LABEL[entry.type] || entry.type);
    text("entryIndex", `${state.currentIndex + 1} / ${state.visibleEntries.length}`);
    updateFavoriteButton(entry);

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

  function renderActionStates() {
    const hasEntry = Boolean(getCurrentEntry());
    [
      "playPauseBtn", "replayBtn", "removeCurrentBtn", "difficultCurrentBtn", "editCurrentBtn", "nextCardBtn",
      "knownCurrentBtn", "unknownCurrentBtn", "favoriteBtn", "speakTermBtn", "speakMeaningBtn", "speakExampleBtn",
      "termAudioBtn", "meaningAudioBtn", "readEvalBtn", "startEvalBtn"
    ].forEach((id) => {
      const el = $(id);
      if (el) el.disabled = !hasEntry;
    });
    ["prevBtn", "nextBtn"].forEach((id) => {
      const el = $(id);
      if (el) el.disabled = !state.visibleEntries.length;
    });
  }

  function updateFavoriteButton(entry) {
    const button = $("favoriteBtn");
    if (!button) return;
    const active = Boolean(entry && isFavorite(entry.id));
    button.classList.toggle("active", active);
    button.setAttribute("aria-label", active ? "取消收藏" : "收藏");
  }

  function renderStats() {
    const hiddenCount = (state.hiddenEntryIds[state.currentLibraryId] || []).length;
    const difficultCount = (state.difficultEntryIds[state.currentLibraryId] || []).length;
    const learnedCount = (state.learnedEntryIds[state.currentLibraryId] || []).length;
    const favoriteCount = (state.favoriteEntryIds[state.currentLibraryId] || []).length;
    text("visibleCount", state.visibleEntries.length);
    text("hiddenCount", hiddenCount);
    text("difficultCount", difficultCount);
    text("learnedCount", learnedCount);
    text("favoriteCount", favoriteCount);
    renderHiddenCount();
    const fill = $("progressFill");
    if (fill) {
      const pct = state.visibleEntries.length ? ((state.currentIndex + 1) / state.visibleEntries.length) * 100 : 0;
      fill.style.width = `${pct}%`;
    }
  }

  function renderHomeStats() {
    const today = todayKey();
    const todayCount = (state.dailyStudyIds[today] || []).length;
    const target = Math.max(10, Math.min(60, state.currentLibrary?.entries?.length || 32));
    const pct = target ? Math.min(100, Math.round((todayCount / target) * 100)) : 0;
    const learnedTotal = Object.values(state.learnedEntryIds)
      .reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
    const difficultTotal = Object.values(state.difficultEntryIds)
      .reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
    const correctBase = learnedTotal + difficultTotal;
    const accuracy = correctBase ? Math.round((learnedTotal / correctBase) * 100) : 0;
    const minutes = Math.max(0, Math.round(Object.values(state.playCountByEntry).reduce((sum, count) => sum + Number(count || 0), 0) * 0.35));

    text("todayLearnedText", todayCount);
    text("todayTargetText", target);
    text("todayPercentText", `${pct}%`);
    text("todayMinutesText", `${minutes} 分钟`);
    text("totalLearnedText", learnedTotal);
    text("accuracyText", `${accuracy}%`);
    text("totalMinutesText", minutes >= 60 ? `${Math.round(minutes / 60)}h` : `${minutes}m`);
    text("streakCountText", todayCount > 0 ? "1" : "0");

    const ring = $("todayProgressRing");
    if (ring) {
      const circumference = 2 * Math.PI * 48;
      ring.style.strokeDasharray = String(circumference);
      ring.style.strokeDashoffset = String(circumference * (1 - pct / 100));
    }
  }

  function renderFeaturedLibrary() {
    const featured = getLatestBuiltinLibraryMeta();
    text("dailyLibraryLabel", "最新词库");
    text("dailyLibraryName", featured?.name || "每日词库");
    text(
      "dailyLibraryHint",
      featured ? `${Number(featured.count) || 0} 条 · 点击开始复习` : "请先检查 data/builtin-index.json"
    );
  }

  function renderLibraryCards() {
    const wrap = $("libraryCards");
    if (!wrap) return;
    wrap.innerHTML = state.libraries.map((lib) => {
      const active = lib.id === state.currentLibraryId;
      return `
        <button class="library-mini-card ${active ? "active" : ""}" type="button" data-library-card="${escapeHtml(lib.id)}">
          <span>
            <strong>${escapeHtml(lib.name)}</strong>
            <span>${escapeHtml(lib.group || "用户词库")} · ${Number(lib.count) || 0} 条</span>
          </span>
          <b>${active ? "当前" : "打开"}</b>
        </button>
      `;
    }).join("");
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
    if (!entries.length) {
      const range = $("rangeFilter")?.value || "active";
      const asset = range === "favorite"
        ? "./assets/empty/empty-favorites.svg"
        : range === "hidden"
          ? "./assets/empty/empty-data.svg"
          : "./assets/empty/empty-learning.svg";
      const title = range === "favorite"
        ? "暂无收藏"
        : range === "hidden"
          ? "暂无已移出词条"
          : "暂无可学习内容";
      list.innerHTML = `
        <div class="empty-state">
          <img src="${asset}" alt="">
          <strong>${title}</strong>
          <p>可以切换词库、调整筛选，或导入自己的学习资料。</p>
        </div>
      `;
      return;
    }
    list.innerHTML = entries.map((entry, index) => `
      <div class="entry-item ${index === state.currentIndex ? "active" : ""} ${entry.suspectedError ? "suspected" : ""}" data-index="${index}">
        <div>
          <p class="entry-title">${escapeHtml(entry.term)}</p>
          <p class="entry-meaning">${escapeHtml(entry.meaning || entry.morph || "")}</p>
        </div>
        <div class="mini-actions">
          <button type="button" data-action="edit" data-id="${escapeHtml(entry.id)}" title="编辑">编辑</button>
          <button type="button" data-action="favorite" data-id="${escapeHtml(entry.id)}" title="收藏">${isFavorite(entry.id) ? "已藏" : "收藏"}</button>
          ${state.listMode === "hidden" || ($("rangeFilter")?.value === "hidden")
            ? `<button type="button" data-action="restore" data-id="${escapeHtml(entry.id)}" title="恢复">恢复</button>`
            : `<button type="button" data-action="hide" data-id="${escapeHtml(entry.id)}" title="移除">移除</button>`}
        </div>
      </div>
    `).join("");
  }

  function renderPlayer() {
    text("playPauseText", state.isPlaying ? "停止" : "播放");
    setImage("playPauseIcon", state.isPlaying ? "./assets/icons/pause.svg" : "./assets/icons/play.svg");
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
    if (!LEARNABLE_TYPES.has(entry.type)) return [];
    const plan = [];
    const repeats = Math.max(1, Math.min(5, Number(state.settings.repeatEnglish) || 1));
    const term = sanitizeForSpeech(entry.term, "en-US", "term");
    for (let i = 0; i < repeats; i++) {
      if (term) plan.push({ kind: "term", lang: "en-US", text: term, audioSrc: entry.audio?.en || "" });
    }
    if (state.settings.spellWords && entry.type === "word") {
      const spelling = spellingForSpeech(entry.term);
      if (spelling) plan.push({ kind: "spelling", lang: "en-US", text: spelling });
    }
    if (state.settings.speakChinese && entry.meaning) {
      const meaning = sanitizeForSpeech(entry.meaning, "zh-CN", "meaning");
      if (meaning) plan.push({ kind: "meaning", lang: "zh-CN", text: meaning, audioSrc: entry.audio?.zh || "" });
    }
    if (state.settings.speakMorph && entry.morph) {
      const morph = sanitizeForSpeech(entry.morph, "zh-CN", "morph");
      if (morph) plan.push({ kind: "morph", lang: "zh-CN", text: morph });
    }
    if (state.settings.speakExample && entry.example) {
      if (entry.audio?.example) {
        const example = sanitizeForSpeech(entry.example, "en-US", "example");
        if (example) plan.push({ kind: "example", lang: "en-US", text: example, audioSrc: entry.audio.example });
      } else {
        plan.push(...mixedSpeechItems(entry.example, "example"));
      }
    }
    return plan;
  }

  function mixedSpeechItems(value, kind) {
    const raw = String(value || "").trim();
    if (!raw) return [];
    const parts = raw
      .replace(/([.!?])([\u4e00-\u9fff])/g, "$1|$2")
      .replace(/([。！？])([A-Za-z])/g, "$1|$2")
      .split("|")
      .map((part) => part.trim())
      .filter(Boolean);
    const items = [];
    for (const part of parts.length ? parts : [raw]) {
      const lang = chineseCharRatio(part) > 0.25 ? "zh-CN" : "en-US";
      const textValue = sanitizeForSpeech(part, lang, kind);
      if (textValue) items.push({ kind, lang, text: textValue });
    }
    return items;
  }

  function spellingForSpeech(term) {
    const word = String(term || "").trim();
    if (!/^[A-Za-z]+$/.test(word)) return "";
    return word.toLowerCase().split("").join(", ");
  }

  function isSpeechSupported() {
    return "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  }

  function setPronunciationSource(label) {
    state.lastAudioSource = label;
    text("pronunciationSourceText", label);
  }

  async function playSpeechItem(item) {
    if (!item?.text && !item?.audioSrc) return;
    const mode = state.settings.audioMode || "auto";
    if (mode === "silent") {
      setPronunciationSource("静音模式");
      return;
    }
    if (mode === "auto" && item.audioSrc) {
      try {
        await playAudioFile(item.audioSrc);
        setPronunciationSource("内置音频");
        return;
      } catch (error) {
        logInfo("playAudioFile.fallback", `${item.audioSrc}；${error.message || error}`);
      }
    }
    if (!isSpeechSupported()) {
      setPronunciationSource("不可用");
      throw new Error("当前浏览器不支持朗读能力，请尝试 Safari、Chrome 或 Edge。");
    }
    setPronunciationSource("系统语音");
    await speakText(item.text, item.lang);
  }

  function playAudioFile(src) {
    const audioSrc = String(src || "").trim();
    if (!audioSrc) return Promise.reject(new Error("音频路径为空"));
    return new Promise((resolve, reject) => {
      if (currentAudio) {
        try {
          currentAudio.pause();
          currentAudio.src = "";
        } catch (error) {
          logInfo("playAudioFile.stopPrevious", error.message || String(error));
        }
      }
      const audio = new Audio(audioSrc);
      currentAudio = audio;
      audio.preload = "auto";
      audio.volume = Number.isFinite(Number(state.settings.volume)) ? Number(state.settings.volume) : 1;
      let settled = false;
      const timer = setTimeout(() => settle(reject, new Error(`内置音频加载超时：${audioSrc}`)), 12000);
      const settle = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (currentAudio === audio) currentAudio = null;
        fn(value);
      };
      audio.onended = () => settle(resolve);
      audio.onerror = () => settle(reject, new Error(`内置音频不可用：${audioSrc}`));
      audio.play().catch((error) => settle(reject, error));
    });
  }

  async function speakText(textValue, lang) {
    return speakTextWithTimeout(textValue, lang);
  }

  async function speakTextWithTimeout(textValue, lang, options = {}) {
    const cleanText = String(textValue || "").trim();
    if (!cleanText) return;
    if (!isSpeechSupported()) {
      const message = `当前浏览器不支持 speechSynthesis；browser=${navigator.userAgent || "unknown"}`;
      state.lastSpeechError = message;
      updateSpeechDiagnosticsUI();
      throw new Error(message);
    }
    await waitForVoicesWithTimeout(options.voiceWaitMs || 450);
    if (!state.availableVoices.length) {
      state.lastSpeechError = "speechSynthesis 可用，但 voices 为空：请检查系统语音包，或换 Safari / Chrome / Edge。";
      updateSpeechDiagnosticsUI();
    }
    return new Promise((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.lang = lang;
      utterance.rate = Number(state.settings.rate) || 0.9;
      utterance.pitch = Number(state.settings.pitch) || 1;
      utterance.volume = Number.isFinite(Number(state.settings.volume)) ? Number(state.settings.volume) : 1;
      const voice = pickVoice(lang);
      if (voice) utterance.voice = voice;
      let settled = false;
      const timeoutMs = estimateSpeechTimeout(cleanText);
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        state.lastSpeechTimeout = `${lang} 超时 ${timeoutMs}ms：${cleanText.slice(0, 60)}`;
        updateSpeechDiagnosticsUI();
        window.speechSynthesis.cancel();
        reject(new Error(`朗读超时：${state.lastSpeechTimeout}`));
      }, timeoutMs);
      const settle = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };
      utterance.onend = () => settle(resolve);
      utterance.onerror = (event) => {
        const message = [
          event.error || "朗读失败",
        `lang=${lang}`,
        `voice=${voice ? `${voice.name}/${voice.lang}` : "none"}`,
          `text=${cleanText.slice(0, 80)}`,
        `browser=${navigator.userAgent || "unknown"}`
        ].join("；");
        state.lastSpeechError = message;
        updateSpeechDiagnosticsUI();
        settle(reject, new Error(message));
      };
      window.speechSynthesis.speak(utterance);
    });
  }

  function estimateSpeechTimeout(value) {
    const length = String(value || "").length;
    return Math.max(6000, Math.min(30000, 2500 + length * 180));
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
    updateSpeechDiagnosticsUI();
  }

  function waitForVoicesWithTimeout(ms = 800) {
    if (!("speechSynthesis" in window)) return Promise.resolve([]);
    refreshVoices();
    if (state.availableVoices.length) return Promise.resolve(state.availableVoices);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        refreshVoices();
        resolve(state.availableVoices);
      }, ms);
      window.speechSynthesis.onvoiceschanged = () => {
        clearTimeout(timer);
        refreshVoices();
        resolve(state.availableVoices);
      };
    });
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

  function getSpeechDiagnostics() {
    const enVoice = pickVoice("en-US");
    const zhVoice = pickVoice("zh-CN");
    return {
      supported: isSpeechSupported(),
      voicesCount: state.availableVoices.length,
      englishVoice: enVoice ? `${enVoice.name} / ${enVoice.lang}` : "未找到",
      chineseVoice: zhVoice ? `${zhVoice.name} / ${zhVoice.lang}` : "未找到",
      source: state.lastAudioSource || sourceLabelForMode(),
      lastError: state.lastSpeechError || "无",
      lastTimeout: state.lastSpeechTimeout || "无"
    };
  }

  function updateSpeechDiagnosticsUI() {
    const box = $("speechDiagnosticsBox");
    if (!box) return;
    const diag = getSpeechDiagnostics();
    box.textContent = [
      `speechSynthesis：${diag.supported ? "支持" : "不支持"}`,
      `可用 voices：${diag.voicesCount}`,
      `英文 voice：${diag.englishVoice}`,
      `中文 voice：${diag.chineseVoice}`,
      `当前发音来源：${diag.source}`,
      `最近错误：${diag.lastError}`,
      `最近超时：${diag.lastTimeout}`,
      "无声音建议：换 Safari / Chrome / Edge；检查系统 TTS 语音包；iOS PWA 锁屏后台可能受限制；微信/QQ/百度内置浏览器不保证稳定。"
    ].join("\n");
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
    const continuing = state.isPlaying;
    stopSpeaking(false);
    if (!continuing) playbackSeenEntryIds = new Set();
    state.isPlaying = true;
    const token = ++state.playerToken;
    renderPlayer();
    try {
      setupMediaSession(entry);
      await requestWakeLock();
      const plan = buildPlayPlan(entry);
      if (!plan.length) {
        state.isPlaying = false;
        releaseWakeLock();
        showStatus(`${TYPE_LABEL[entry.type] || "该条目"}不进入自动朗读`);
        renderPlayer();
        return;
      }
      text("speechPreview", plan.map((item) => `${item.kind} [${item.lang}]: ${item.text}`).join("\n"));
      for (const item of plan) {
        if (token !== state.playerToken) return;
        await playSpeechItem(item);
      }
      if (token !== state.playerToken) return;
      markLearned(entry.id);
      incrementPlayCount(entry.id);
      playbackSeenEntryIds.add(entry.id);
      saveState();
      if (state.isPlaying && state.settings.autoPlay) {
        if (moveNextForPlayback()) playCurrent();
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
    if (currentAudio) {
      try {
        currentAudio.pause();
        currentAudio.src = "";
      } catch (error) {
        logInfo("stopSpeaking.audio", error.message || String(error));
      }
      currentAudio = null;
    }
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
    saveCurrentProgress("replay");
    saveState();
    playCurrent();
  }

  function playNext() {
    const shouldContinue = state.isPlaying;
    stopSpeaking(false);
    if (!state.visibleEntries.length) return;
    setCurrentIndex((state.currentIndex + 1) % state.visibleEntries.length, "manual-next", true);
    if (shouldContinue) playCurrent();
  }

  function playPrev() {
    const shouldContinue = state.isPlaying;
    stopSpeaking(false);
    if (!state.visibleEntries.length) return;
    setCurrentIndex((state.currentIndex - 1 + state.visibleEntries.length) % state.visibleEntries.length, "manual-prev", true);
    if (shouldContinue) playCurrent();
  }

  function hasNextEntry() {
    return state.currentIndex < state.visibleEntries.length - 1;
  }

  function moveNextForPlayback() {
    if (!state.visibleEntries.length) return false;
    if (!state.settings.loopPlayback && playbackSeenEntryIds.size >= state.visibleEntries.length) {
      finishPlaybackList();
      return false;
    }
    if (state.settings.random && state.visibleEntries.length > 1) {
      const candidates = state.visibleEntries
        .map((entry, index) => ({ entry, index }))
        .filter((item) => state.settings.loopPlayback || !playbackSeenEntryIds.has(item.entry.id));
      if (!candidates.length) {
        finishPlaybackList();
        return false;
      }
      const next = candidates[Math.floor(Math.random() * candidates.length)].index;
      setCurrentIndex(next, "playback-random-next", true);
    } else {
      if (!hasNextEntry()) {
        if (!state.settings.loopPlayback) {
          finishPlaybackList();
          return false;
        }
        setCurrentIndex(0, "playback-loop", true);
      } else {
        setCurrentIndex(state.currentIndex + 1, "playback-next", true);
      }
    }
    return true;
  }

  function finishPlaybackList() {
    state.isPlaying = false;
    releaseWakeLock();
    showStatus("已播放完当前列表");
    renderPlayer();
  }

  async function testEnglishVoice() {
    try {
      await speakTextWithTimeout("test pronunciation", "en-US", { voiceWaitMs: 300 });
      showToast("英文测试发音完成");
    } catch (error) {
      logError("testEnglishVoice", error);
      showStatus(`英文发音测试失败：${error.message || error}`);
    }
  }

  async function testChineseVoice() {
    try {
      await speakTextWithTimeout("测试中文发音", "zh-CN", { voiceWaitMs: 300 });
      showToast("中文测试发音完成");
    } catch (error) {
      logError("testChineseVoice", error);
      showStatus(`中文发音测试失败：${error.message || error}`);
    }
  }

  // actions
  async function hideCurrentEntry() {
    const entry = currentEntry();
    if (!entry) return;
    const indexBeforeRemove = state.currentIndex;
    stopSpeaking(false);
    const confirmed = await confirmRemoveCurrentEntry();
    if (!confirmed) {
      renderPlayer();
      return;
    }
    markHidden(entry.id);
    rebuildVisibleEntries();
    setCurrentIndex(indexBeforeRemove, "hide-current", true);
    showToast("已移出当前词，可在已移除列表中恢复。");
  }

  function confirmRemoveCurrentEntry() {
    const dialog = $("confirmRemoveDialog");
    if (!dialog?.showModal) {
      return Promise.resolve(confirm("移出当前单词？\n\n移出后将从复习列表中移除，但不会跳过下一个单词。"));
    }
    return new Promise((resolve) => {
      const onClose = () => {
        dialog.removeEventListener("close", onClose);
        resolve(dialog.returnValue === "confirm");
      };
      dialog.addEventListener("close", onClose);
      dialog.returnValue = "cancel";
      dialog.showModal();
    });
  }

  function showHiddenEntries() {
    state.listMode = "hidden";
    const range = $("rangeFilter");
    if (range) range.value = "hidden";
    setCurrentIndex(0, "show-hidden", true);
    openDrawer("libraryDrawer");
  }

  function markCurrentKnown() {
    const entry = currentEntry();
    if (!entry) return;
    stopSpeaking(false);
    markLearned(entry.id);
    moveToNextAfterFeedback("known");
    showToast("已记录为认识");
  }

  function markCurrentUnknown() {
    const entry = currentEntry();
    if (!entry) return;
    stopSpeaking(false);
    markDifficult(entry.id);
    moveToNextAfterFeedback("unknown");
    showToast("已加入错词 / 不熟");
  }

  function moveToNextAfterFeedback(reason) {
    if (!state.visibleEntries.length) {
      render();
      return;
    }
    const nextIndex = Math.min(state.currentIndex + 1, state.visibleEntries.length - 1);
    setCurrentIndex(nextIndex, reason, true);
  }

  function toggleCurrentFavorite() {
    const entry = currentEntry();
    if (!entry) return;
    toggleFavorite(entry.id);
    render();
    showToast(isFavorite(entry.id) ? "已收藏" : "已取消收藏");
  }

  async function playSinglePart(part) {
    const entry = currentEntry();
    if (!entry) return;
    stopSpeaking(false);
    const token = ++state.playerToken;
    state.isPlaying = true;
    renderPlayer();
    try {
      let item = null;
      if (part === "term") {
        item = { kind: "term", lang: "en-US", text: sanitizeForSpeech(entry.term, "en-US", "term"), audioSrc: entry.audio?.en || "" };
      } else if (part === "meaning") {
        item = { kind: "meaning", lang: "zh-CN", text: sanitizeForSpeech(entry.meaning, "zh-CN", "meaning"), audioSrc: entry.audio?.zh || "" };
      } else if (part === "example") {
        item = { kind: "example", lang: "en-US", text: sanitizeForSpeech(entry.example, "en-US", "example"), audioSrc: entry.audio?.example || "" };
      }
      if (!item?.text && !item?.audioSrc) {
        state.isPlaying = false;
        renderPlayer();
        return;
      }
      await playSpeechItem(item);
      if (token !== state.playerToken) return;
      incrementPlayCount(entry.id);
      state.isPlaying = false;
      render();
    } catch (error) {
      if (token !== state.playerToken) return;
      state.isPlaying = false;
      logError(`playSinglePart.${part}`, error, entry.term);
      showStatus(`发音失败：${error.message || error}`);
      renderPlayer();
    }
  }

  function showEvaluationPlaceholder() {
    text("evalStatusText", "未开始");
    showToast("当前版本仅支持朗读播放与词汇复习，跟读评测为后续功能。");
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
      type: ENTRY_TYPES.includes(typeValue) ? typeValue : inferEntryType(term)
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
    setCurrentIndex(state.currentIndex, "restore-all-hidden", true);
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
      base.type = ENTRY_TYPES.includes(csvCells[4]) ? csvCells[4] : inferEntryType(base.term);
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
            ${ENTRY_TYPES.map((type) => `<option value="${type}" ${entry.type === type ? "selected" : ""}>${TYPE_LABEL[type]}</option>`).join("")}
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
        type: ENTRY_TYPES.includes(entry.type) ? entry.type : inferEntryType(entry.term)
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
    delete state.favoriteEntryIds[meta.id];
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
        favoriteEntryIds: state.favoriteEntryIds,
        dailyStudyIds: state.dailyStudyIds,
        playCountByEntry: state.playCountByEntry,
        userOverrides: state.userOverrides,
        userLibraries: state.userLibraries,
        progressByLibrary: state.progressByLibrary,
        stats: {
          currentLibraryName: state.currentLibrary?.name || "",
          visibleCount: state.visibleEntries.length,
          learnedCount: (state.learnedEntryIds[state.currentLibraryId] || []).length,
          difficultCount: (state.difficultEntryIds[state.currentLibraryId] || []).length,
          favoriteCount: (state.favoriteEntryIds[state.currentLibraryId] || []).length,
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
      state.favoriteEntryIds = mergeListMaps(state.favoriteEntryIds, payload.favoriteEntryIds);
      state.dailyStudyIds = mergeListMaps(state.dailyStudyIds, payload.dailyStudyIds);
      state.playCountByEntry = { ...state.playCountByEntry, ...(validMap(payload.playCountByEntry)) };
      state.userOverrides = mergeObjectMaps(state.userOverrides, payload.userOverrides);
      state.progressByLibrary = mergeObjectMaps(state.progressByLibrary, payload.progressByLibrary);
      mergeUserLibraries(payload.userLibraries);
      state.currentLibraryId = payload.currentLibraryId || state.currentLibraryId;
      state.currentIndex = Number(payload.currentIndex) || 0;
      if (state.currentLibraryId && !state.progressByLibrary[state.currentLibraryId]) {
        state.progressByLibrary[state.currentLibraryId] = {
          currentIndex: state.currentIndex,
          currentEntryId: "",
          updatedAt: Date.now(),
          reason: "import-backup-legacy-index"
        };
      }
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
    state.dailyStudyIds = {};
    state.playCountByEntry = {};
    setCurrentIndex(0, "reset-progress", false);
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
      state.favoriteEntryIds = {};
      state.dailyStudyIds = {};
      state.playCountByEntry = {};
      state.userOverrides = {};
      state.userLibraries = [];
      state.progressByLibrary = {};
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
    text("cacheStatusText", message);
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
      const registration = await navigator.serviceWorker.register("./sw.js");
      if (registration.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
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
        await Promise.all(
          names
            .filter((name) => name.startsWith(CACHE_PREFIX) || name.startsWith(AUDIO_CACHE_PREFIX))
            .map((name) => caches.delete(name))
        );
      }
      localStorage.setItem(`${STORAGE_KEY}:last-cache-refresh`, new Date().toLocaleString());
      renderAppMeta();
      showToast("缓存已刷新，正在重新加载");
      setTimeout(() => location.reload(), 250);
    } catch (error) {
      logError("refreshCache", error);
      showStatus(`刷新缓存失败：${error.message || error}`);
    }
  }

  async function checkCoreAssets() {
    const assets = [
      "./index.html",
      "./style.css",
      "./app.js",
      "./manifest.json",
      "./data/builtin-index.json",
      ...state.libraries
        .filter((library) => !library.isUser && library.file)
        .map((library) => `./data/${library.file}`),
      "./icons/icon.svg",
      "./icons/icon-192.png",
      "./icons/icon-512.png",
      "./icons/apple-touch-icon.png",
      "./icons/logo-mark.svg",
      "./icons/logo-horizontal.svg",
      "./assets/onboarding/onboarding-1.svg",
      "./assets/onboarding/onboarding-2.svg",
      "./assets/onboarding/onboarding-3.svg",
      "./assets/empty/empty-learning.svg",
      "./assets/empty/empty-favorites.svg",
      "./assets/empty/empty-plan.svg",
      "./assets/empty/empty-data.svg",
      "./assets/badges/streak-7.svg",
      "./assets/badges/streak-30.svg",
      "./assets/badges/learn-100.svg",
      "./assets/badges/favorite-master.svg",
      "./assets/badges/review-pro.svg",
      "./assets/badges/persistence.svg",
      "./assets/ui/trophy.svg",
      "./assets/ui/progress-card-deco.svg",
      "./assets/ui/study-plan-deco.svg",
      "./assets/icons/home.svg",
      "./assets/icons/learn.svg",
      "./assets/icons/library.svg",
      "./assets/icons/stats.svg",
      "./assets/icons/profile.svg",
      "./assets/icons/play.svg",
      "./assets/icons/pause.svg",
      "./assets/icons/next.svg",
      "./assets/icons/prev.svg",
      "./assets/icons/repeat.svg",
      "./assets/icons/favorite.svg",
      "./assets/icons/difficult.svg",
      "./assets/icons/mastered.svg",
      "./assets/icons/remove.svg",
      "./assets/icons/settings.svg",
      "./assets/icons/search.svg",
      "./assets/icons/filter.svg",
      "./assets/icons/calendar.svg",
      "./assets/icons/import.svg",
      "./assets/icons/backup.svg",
      "./assets/icons/more.svg",
      "./assets/icons/speaker.svg",
      "./assets/icons/mic.svg",
      "./assets/icons/note.svg",
      "./assets/icons/refresh.svg"
    ];
    if (location.protocol === "file:") {
      setPwaStatus("file:// 下无法完整检查 PWA 资源；请用本地服务器或 GitHub Pages 测试。", false);
      return;
    }
    const failures = [];
    await Promise.all(assets.map(async (path) => {
      try {
        const response = await fetch(withCacheVersion(path), { cache: "no-store" });
        if (!response.ok) failures.push(`${path} HTTP ${response.status}`);
      } catch (error) {
        failures.push(`${path} ${error.message || error}`);
      }
    }));
    if (failures.length) {
      const message = `核心资源缺失或不可访问：${failures.join("；")}`;
      logError("checkCoreAssets", new Error(message));
      showStatus(message);
      setPwaStatus("PWA 核心资源检查失败，请确认 data/ 和 icons/ 已上传。", false);
    } else {
      setPwaStatus("核心资源路径正常，离线缓存可用性取决于浏览器 Service Worker 支持。", true);
    }
  }

  function isDifficult(entryId) {
    return (state.difficultEntryIds[state.currentLibraryId] || []).includes(entryId);
  }

  function setView(viewName, options = {}) {
    const target = viewName || "home";
    state.currentView = target;
    document.body.dataset.view = target;
    document.querySelectorAll(".view").forEach((view) => {
      view.classList.toggle("active", view.dataset.view === target);
    });
    document.querySelectorAll("[data-nav-view]").forEach((button) => {
      button.classList.toggle("active", button.dataset.navView === target || (target === "launch" && button.dataset.navView === "home"));
    });
    if (options.scroll !== false) window.scrollTo({ top: 0, behavior: "smooth" });
    saveState();
  }

  function startLearning() {
    if (!state.currentLibrary && state.libraries.length) {
      loadLibrary(preferredLibraryId()).then(() => setView("study"));
      return;
    }
    setView("study");
  }

  function continueLearning() {
    setView(state.currentLibrary ? "study" : "home");
  }

  function renderAppMeta() {
    text("appVersionText", APP_VERSION);
    text("lastCacheRefreshText", localStorage.getItem(`${STORAGE_KEY}:last-cache-refresh`) || "暂无记录");
    text("pronunciationSourceText", state.lastAudioSource || sourceLabelForMode());
  }

  function sourceLabelForMode() {
    if (state.settings.audioMode === "silent") return "静音模式";
    if (state.settings.audioMode === "system") return "系统语音";
    return "自动：内置音频优先";
  }

  function renderBrowserCompat() {
    const result = detectBrowser();
    const stable = ["Safari", "Chrome", "Edge", "百度浏览器"].includes(result.name);
    const message = stable
      ? `当前浏览器：${result.name}。核心页面可用，朗读和离线能力仍取决于系统权限。`
      : `当前浏览器：${result.name}。可能限制朗读或离线能力，建议使用 Safari 或 Chrome 获得更稳定体验。`;
    text("browserCompatText", message);
  }

  function detectBrowser() {
    const ua = navigator.userAgent || "";
    if (/MicroMessenger/i.test(ua)) return { name: "微信内置浏览器", ua };
    if (/QQBrowser/i.test(ua) || /\bMQQBrowser\b/i.test(ua)) return { name: "QQ 内置浏览器", ua };
    if (/Baidu|baidubrowser|BIDUBrowser/i.test(ua)) return { name: "百度浏览器", ua };
    if (/Edg\//i.test(ua)) return { name: "Edge", ua };
    if (/Chrome|CriOS/i.test(ua) && !/Edg\//i.test(ua)) return { name: "Chrome", ua };
    if (/Safari/i.test(ua) && !/Chrome|CriOS|Edg\//i.test(ua)) return { name: "Safari", ua };
    return { name: "当前浏览器", ua };
  }

  // events
  function bindEvents() {
    on("startLearningBtn", "click", startLearning);
    on("continueLearningBtn", "click", continueLearning);
    on("homeContinueBtn", "click", startLearning);
    on("backHomeBtn", "click", () => setView("home"));
    on("libraryBackBtn", "click", () => setView("study"));
    on("dailyLibraryBtn", "click", async () => {
      const target = getLatestBuiltinLibraryMeta();
      if (target) await loadLibrary(target.id);
      else showStatus("没有找到可用的每日词库");
      setView("study");
    });
    document.querySelectorAll("[data-nav-view]").forEach((button) => {
      button.addEventListener("click", () => setView(button.dataset.navView || "home"));
    });
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
        setCurrentIndex(0, "switch-list-tab", true);
      });
    });

    on("loadLibraryBtn", "click", () => loadLibrary($("librarySelect")?.value || state.currentLibraryId));
    on("librarySelect", "change", (event) => loadLibrary(event.target.value));
    on("searchInput", "input", (event) => {
      state.searchKeyword = event.target.value || "";
      setCurrentIndex(0, "search", true);
    });
    on("typeFilter", "change", (event) => {
      state.filterType = event.target.value || "all";
      setCurrentIndex(0, "type-filter", true);
    });
    on("rangeFilter", "change", (event) => {
      state.listMode = event.target.value === "hidden" ? "hidden" : "current";
      setCurrentIndex(0, "range-filter", true);
    });
    on("autoPlayToggle", "change", (event) => {
      state.settings.autoPlay = Boolean(event.target.checked);
      saveState();
    });
    on("audioSourceSelect", "change", (event) => {
      state.settings.audioMode = event.target.value || "auto";
      setPronunciationSource(sourceLabelForMode());
      saveState();
      render();
    });
    on("loopPlaybackToggle", "change", (event) => {
      state.settings.loopPlayback = Boolean(event.target.checked);
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
    on("testEnglishVoiceBtn", "click", testEnglishVoice);
    on("testChineseVoiceBtn", "click", testChineseVoice);

    on("playPauseBtn", "click", () => {
      if (state.isPlaying) stopSpeaking();
      else playCurrent();
    });
    on("prevBtn", "click", playPrev);
    on("nextBtn", "click", playNext);
    on("nextCardBtn", "click", playNext);
    on("replayBtn", "click", replayCurrent);
    on("removeCurrentBtn", "click", hideCurrentEntry);
    on("knownCurrentBtn", "click", markCurrentKnown);
    on("unknownCurrentBtn", "click", markCurrentUnknown);
    on("favoriteBtn", "click", toggleCurrentFavorite);
    on("quickFavoriteBtn", "click", () => {
      const range = $("rangeFilter");
      if (range) range.value = "favorite";
      state.listMode = "current";
      setCurrentIndex(0, "quick-favorite", true);
      setView("library");
    });
    on("quickDifficultBtn", "click", () => {
      const range = $("rangeFilter");
      if (range) range.value = "difficult";
      state.listMode = "current";
      setCurrentIndex(0, "quick-difficult", true);
      setView("library");
    });
    on("quickRecordBtn", "click", () => setView("library"));
    on("speakTermBtn", "click", () => playSinglePart("term"));
    on("termAudioBtn", "click", () => playSinglePart("term"));
    on("speakMeaningBtn", "click", () => playSinglePart("meaning"));
    on("meaningAudioBtn", "click", () => playSinglePart("meaning"));
    on("speakExampleBtn", "click", () => playSinglePart("example"));
    on("readEvalBtn", "click", showEvaluationPlaceholder);
    on("startEvalBtn", "click", showEvaluationPlaceholder);
    on("notesBtn", "click", () => showToast("笔记功能为后续增强能力，当前可先用收藏和错词记录。"));
    on("moreBtn", "click", () => setView("library"));
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
          if (actionButton.dataset.action === "favorite") toggleFavorite(entryId);
          if (actionButton.dataset.action === "edit") {
            const entry = state.visibleEntries.find((item) => item.id === entryId)
              || (state.currentLibrary?.entries || []).map(applyOverride).find((item) => item.id === entryId);
            if (entry) openEditDialog(entry);
          }
          rebuildVisibleEntries();
          setCurrentIndex(state.currentIndex, `list-${actionButton.dataset.action}`, true);
          return;
        }
        const item = event.target.closest("[data-index]");
        if (item) {
          setCurrentIndex(Number(item.dataset.index) || 0, "list-click", true);
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

    const libraryCards = $("libraryCards");
    if (libraryCards) {
      libraryCards.addEventListener("click", (event) => {
        const card = event.target.closest("[data-library-card]");
        if (!card) return;
        loadLibrary(card.dataset.libraryCard);
        setView("study");
      });
    }

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
    if (id === "libraryDrawer" || id === "settingsDrawer") {
      setView("library");
      return;
    }
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
    const target = preferredLibraryId();
    if (target) await loadLibrary(target);
    render();
    setView(state.currentView || "launch", { scroll: false });
    registerServiceWorker();
    checkCoreAssets();
  }

  document.addEventListener("DOMContentLoaded", init);

  // expose minimal API for manual testing
  exposeDebugState();
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
    playSpeechItem,
    markHidden,
    restoreHidden,
    toggleFavorite,
    setView,
    saveOverride,
    removeOverride,
    fetchJsonWithFallback,
    validateLibrary,
    exportBackup,
    importBackup,
    refreshCache
  };
  globalThis.cetReader = window.cetReader;
})();
