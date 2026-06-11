const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dataDir = path.join(root, "data");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function resolveAudioPath(value) {
  const clean = String(value || "").replace(/^\.\//, "");
  return path.join(root, clean);
}

const missing = [];
const invalid = [];
const files = fs.readdirSync(dataDir)
  .filter((file) => file.endsWith(".json") && file !== "builtin-index.json")
  .sort();

for (const file of files) {
  const filePath = path.join(dataDir, file);
  const library = readJson(filePath);
  const entries = Array.isArray(library.entries) ? library.entries : [];
  for (const entry of entries) {
    if (!entry || !entry.audio) continue;
    if (typeof entry.audio !== "object" || Array.isArray(entry.audio)) {
      invalid.push({
        file,
        entryId: entry.id || "",
        term: entry.term || "",
        message: "audio must be an object"
      });
      continue;
    }
    const audio = entry.audio;
    for (const key of ["en", "zh"]) {
      if (!audio[key]) continue;
      const target = resolveAudioPath(audio[key]);
      if (!fs.existsSync(target)) {
        missing.push({
          file,
          entryId: entry.id || "",
          term: entry.term || "",
          path: audio[key]
        });
      }
    }
  }
}

if (invalid.length) {
  console.error(`音频字段格式错误数量：${invalid.length}`);
  for (const item of invalid) {
    console.error(`${item.file} | ${item.entryId} | ${item.term} | ${item.message}`);
  }
  process.exit(1);
}

if (missing.length) {
  console.error(`音频缺失数量：${missing.length}`);
  for (const item of missing) {
    console.error(`${item.file} | ${item.entryId} | ${item.term} | ${item.path}`);
  }
  process.exit(1);
}

console.log("音频校验通过。仅检查已声明的 audio.en / audio.zh，空 audio 对象会跳过。");
