const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dataDir = path.join(root, "data");
const allowedTypes = new Set(["word", "phrase", "sentence", "root", "correction", "summary"]);
const requiredTerms = {
  "0602.json": [
    "fate", "destiny", "bring over", "nonsense", "cover to cover", "fantasy",
    "chemistry", "lens", "self-esteem", "upward mobility", "is but", "dismiss",
    "deport", "appraise", "assault / assaults", "prescribed", "substitute",
    "vanish / vanishes", "overtake"
  ],
  "0603.json": [
    "weird", "refreshing", "stale bread", "ham", "delicacy", "spicy", "peppery",
    "promptly", "radically", "tremendous", "destructive", "disruption",
    "monument", "segments", "rock saws", "terminal", "elevation", "stone pit",
    "Nile", "cater to", "take in", "on the verge", "decent", "initiative",
    "compatible", "self-assured", "acupuncture"
  ]
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

const indexPath = path.join(dataDir, "builtin-index.json");
const index = readJson(indexPath);
const libraries = Array.isArray(index.libraries) ? index.libraries : [];

for (const meta of libraries) {
  const filePath = path.join(dataDir, meta.file || "");
  if (!fs.existsSync(filePath)) {
    fail(`${meta.file} missing`);
    continue;
  }

  const library = readJson(filePath);
  if (!library.id) fail(`${meta.file} missing library.id`);
  if (!library.name) fail(`${meta.file} missing library.name`);
  if (!Array.isArray(library.entries)) {
    fail(`${meta.file} entries is not array`);
    continue;
  }
  if (meta.count !== library.entries.length) {
    fail(`${meta.file} count mismatch: index=${meta.count} actual=${library.entries.length}`);
  }

  const ids = new Set();
  let suspected = 0;
  for (const entry of library.entries) {
    if (!entry.id) fail(`${meta.file} entry missing id`);
    if (ids.has(entry.id)) fail(`${meta.file} duplicate id ${entry.id}`);
    ids.add(entry.id);
    if (!entry.term) fail(`${meta.file} ${entry.id} empty term`);
    if (!entry.meaning) fail(`${meta.file} ${entry.id} empty meaning`);
    if (!allowedTypes.has(entry.type)) fail(`${meta.file} ${entry.id} invalid type ${entry.type}`);
    if (!Array.isArray(entry.warnings)) fail(`${meta.file} ${entry.id} warnings is not array`);
    if (entry.suspectedError) suspected += 1;
  }

  const required = requiredTerms[meta.file] || [];
  for (const term of required) {
    if (!library.entries.some((entry) => entry.term === term)) {
      fail(`${meta.file} missing required term ${term}`);
    }
  }

  console.log(`OK ${meta.file}: ${library.entries.length} entries, suspected=${suspected}`);
}

if (!process.exitCode) {
  console.log("All data checks passed.");
}
