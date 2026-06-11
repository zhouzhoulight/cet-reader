const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dataDir = path.join(root, "data");
const allowedTypes = new Set(["word", "phrase", "sentence", "root", "correction", "summary"]);
const requiredAssets = [
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "icons/logo-mark.svg",
  "icons/logo-horizontal.svg",
  "assets/onboarding/onboarding-1.svg",
  "assets/onboarding/onboarding-2.svg",
  "assets/onboarding/onboarding-3.svg",
  "assets/empty/empty-learning.svg",
  "assets/empty/empty-favorites.svg",
  "assets/empty/empty-plan.svg",
  "assets/empty/empty-data.svg",
  "assets/badges/streak-7.svg",
  "assets/badges/streak-30.svg",
  "assets/badges/learn-100.svg",
  "assets/badges/favorite-master.svg",
  "assets/badges/review-pro.svg",
  "assets/badges/persistence.svg",
  "assets/ui/trophy.svg",
  "assets/ui/progress-card-deco.svg",
  "assets/ui/study-plan-deco.svg",
  "assets/icons/home.svg",
  "assets/icons/learn.svg",
  "assets/icons/library.svg",
  "assets/icons/stats.svg",
  "assets/icons/profile.svg",
  "assets/icons/play.svg",
  "assets/icons/pause.svg",
  "assets/icons/next.svg",
  "assets/icons/prev.svg",
  "assets/icons/repeat.svg",
  "assets/icons/favorite.svg",
  "assets/icons/difficult.svg",
  "assets/icons/mastered.svg",
  "assets/icons/remove.svg",
  "assets/icons/settings.svg",
  "assets/icons/search.svg",
  "assets/icons/filter.svg",
  "assets/icons/calendar.svg",
  "assets/icons/import.svg",
  "assets/icons/backup.svg",
  "assets/icons/more.svg",
  "assets/icons/speaker.svg",
  "assets/icons/mic.svg",
  "assets/icons/note.svg",
  "assets/icons/refresh.svg"
];
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
  ],
  "0604.json": [
    "reckoned", "go along", "secretary", "slides", "as to", "remark",
    "dramatic", "extend", "retailers", "rivals", "ties up", "revenue",
    "forwarding", "frantic", "refined", "sugars", "reserve", "inclusion",
    "prejudiced", "nominees", "policies", "mortgage", "breadwinner",
    "inherently", "depiction", "clever", "twist", "in excess", "digestive",
    "other than", "adverse", "symptoms"
  ],
  "0611.json": [
    "let loose", "clarity", "ward / wards / -wards", "distinctive", "inhibiting",
    "majestic", "interrogation", "mandatory", "intrinsically", "evade", "intervene",
    "precedent", "appoint", "obliged", "contentious", "disposal", "grid",
    "infrastructure", "adherence", "exclusive", "overwhelm"
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
if (index.version !== "2026-06-11") {
  fail(`builtin-index.json version must be 2026-06-11, actual=${index.version}`);
}
if (!libraries.some((meta) => meta.file === "0604.json")) {
  fail("builtin-index.json missing 0604.json");
}
const meta0611 = libraries.find((meta) => meta.file === "0611.json");
if (!meta0611) {
  fail("builtin-index.json missing 0611.json");
} else if (meta0611.count !== 21) {
  fail(`0611.json index count must be 21, actual=${meta0611.count}`);
}

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
  if (meta.file === "0604.json" && library.entries.length !== 32) {
    fail(`0604.json must contain exactly 32 entries, actual=${library.entries.length}`);
  }
  if (meta.file === "0611.json" && library.entries.length !== 21) {
    fail(`0611.json must contain exactly 21 entries, actual=${library.entries.length}`);
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
    if (entry.audio && (typeof entry.audio !== "object" || Array.isArray(entry.audio))) {
      fail(`${meta.file} ${entry.id} audio must be an object when present`);
    }
    if (entry.suspectedError) suspected += 1;
  }

  if (meta.file === "0611.json") {
    const letLoose = library.entries.find((entry) => entry.term === "let loose");
    if (!letLoose || letLoose.type !== "phrase") {
      fail("0611.json let loose must exist and have type phrase");
    }
    const ward = library.entries.find((entry) => entry.term === "ward / wards / -wards");
    if (!ward || ward.type !== "word") {
      fail("0611.json ward / wards / -wards must exist and have type word");
    }
    if (library.entries.some((entry) => /infrstructure/i.test(`${entry.term} ${entry.meaning} ${entry.morph} ${entry.example}`))) {
      fail("0611.json contains misspelling infrstructure");
    }
    if (!library.entries.some((entry) => entry.term === "infrastructure")) {
      fail("0611.json missing correctly spelled infrastructure");
    }
  }

  const required = requiredTerms[meta.file] || [];
  for (const term of required) {
    if (!library.entries.some((entry) => entry.term === term)) {
      fail(`${meta.file} missing required term ${term}`);
    }
  }

  console.log(`OK ${meta.file}: ${library.entries.length} entries, suspected=${suspected}`);
}

for (const asset of requiredAssets) {
  const filePath = path.join(root, asset);
  if (!fs.existsSync(filePath)) {
    fail(`asset missing: ${asset}`);
  } else if (fs.statSync(filePath).size <= 0) {
    fail(`asset empty: ${asset}`);
  }
}

if (!process.exitCode) {
  console.log("All data checks passed.");
}
