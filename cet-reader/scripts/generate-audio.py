#!/usr/bin/env python3
"""Generate local mp3 pronunciation files for CET Reader dictionaries.

This script uses edge-tts. It intentionally generates English term audio and
Chinese meaning audio only; example audio is reserved for a later pass.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
AUDIO_EN_DIR = ROOT / "audio" / "en"
AUDIO_ZH_DIR = ROOT / "audio" / "zh"
AUDIO_EXAMPLE_DIR = ROOT / "audio" / "example"
LOG_DIR = ROOT / "logs"
ERROR_LOG = LOG_DIR / "audio-errors.json"

DEFAULT_EN_VOICE = "en-US-JennyNeural"
DEFAULT_ZH_VOICE = "zh-CN-XiaoxiaoNeural"
DEFAULT_EN_RATE = "-10%"
DEFAULT_ZH_RATE = "+0%"

POS_PREFIX_RE = re.compile(
    r"^\s*(?:"
    r"(?:n|v|vt|vi|adj|adv|phr|prep|pron|conj|num|interj|abbr|pl)\.?"
    r"|"
    r"(?:n|v)-?ing"
    r"|"
    r"v-ed"
    r")"
    r"(?:\s*/\s*(?:n|v|vt|vi|adj|adv|phr|prep|pron|conj|num|interj|abbr|pl)\.?)*"
    r"\s*[；;，,、:：.]?\s*",
    re.IGNORECASE,
)


@dataclass
class LibraryStats:
    file: str
    total_entries: int = 0
    generated_en: int = 0
    generated_zh: int = 0
    skipped_existing: int = 0
    failed: int = 0
    json_changed: bool = False


def ensure_dirs() -> None:
    AUDIO_EN_DIR.mkdir(parents=True, exist_ok=True)
    AUDIO_ZH_DIR.mkdir(parents=True, exist_ok=True)
    AUDIO_EXAMPLE_DIR.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)


def safe_id(value: Any, index: int) -> str:
    raw = str(value or "").strip().lower()
    raw = re.sub(r"\s+", "-", raw)
    raw = re.sub(r"[^a-z0-9_-]+", "-", raw)
    raw = re.sub(r"-{2,}", "-", raw).strip("-")
    return raw or f"audio-{index + 1}"


def has_chinese(value: str) -> bool:
    return bool(re.search(r"[\u4e00-\u9fff]", value or ""))


def clean_zh_meaning(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""

    for marker in ("搭配：", "例句：", "提醒：", "构词法："):
        if marker in text:
            text = text.split(marker, 1)[0]

    text = text.replace("；", ";").replace("。", ";").replace("，", ";").replace("、", ";")
    text = text.replace("/", ";")
    text = POS_PREFIX_RE.sub("", text)
    text = re.sub(r"^[a-zA-Z./\s-]+[:：;,.，；、\s]+", "", text)

    parts: list[str] = []
    for part in re.split(r"[;；]+", text):
        item = part.strip()
        item = POS_PREFIX_RE.sub("", item).strip()
        item = re.sub(r"\s+", " ", item)
        if not item or not has_chinese(item):
            continue
        item = re.sub(r"[A-Za-z]{2,}[^，。；;]*", "", item).strip(" ，,.;；")
        if item and has_chinese(item):
            parts.append(item[:32])
        if len(parts) >= 2:
            break

    return "，".join(parts)


def relative_audio_path(kind: str, filename: str) -> str:
    return f"./audio/{kind}/{filename}"


def resolve_library_path(name: str) -> Path:
    candidate = Path(name)
    if candidate.is_absolute() and candidate.exists():
        return candidate
    if candidate.suffix != ".json":
        candidate = candidate.with_suffix(".json")
    return DATA_DIR / candidate.name


def library_paths(args: argparse.Namespace) -> list[Path]:
    if args.all:
        return sorted(path for path in DATA_DIR.glob("*.json") if path.name != "builtin-index.json")
    path = resolve_library_path(args.library)
    if not path.exists():
        raise FileNotFoundError(f"词库不存在：{path}")
    if path.name == "builtin-index.json":
        raise ValueError("不能处理 builtin-index.json")
    return [path]


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def backup_json(path: Path) -> None:
    backup = path.with_suffix(path.suffix + ".bak")
    if not backup.exists():
        shutil.copy2(path, backup)


async def synthesize_mp3(edge_tts: Any, text: str, voice: str, rate: str, output: Path) -> tuple[bool, str]:
    last_error = ""
    for attempt in range(1, 4):
        try:
            output.parent.mkdir(parents=True, exist_ok=True)
            communicate = edge_tts.Communicate(text, voice=voice, rate=rate)
            await communicate.save(str(output))
            if output.exists() and output.stat().st_size > 0:
                return True, ""
            raise RuntimeError("生成后文件为空")
        except Exception as error:  # noqa: BLE001 - keep batch generation moving
            last_error = str(error)
            if output.exists() and output.stat().st_size == 0:
                output.unlink(missing_ok=True)
            await asyncio.sleep(min(3.0, 0.7 * attempt))
    return False, last_error


async def process_entry(
    edge_tts: Any,
    entry: dict[str, Any],
    index: int,
    args: argparse.Namespace,
    semaphore: asyncio.Semaphore,
    stats: LibraryStats,
    errors: list[dict[str, Any]],
) -> bool:
    changed = False
    entry_id = entry.get("id") or entry.get("term") or f"audio-{index + 1}"
    file_id = safe_id(entry_id, index)
    audio = entry.get("audio") if isinstance(entry.get("audio"), dict) else {}
    audio = dict(audio)

    term = str(entry.get("term") or "").strip()
    if term:
        filename = f"{file_id}.mp3"
        output = AUDIO_EN_DIR / filename
        rel = relative_audio_path("en", filename)
        if output.exists() and not args.overwrite:
            stats.skipped_existing += 1
            if audio.get("en") != rel:
                audio["en"] = rel
                changed = True
        else:
            async with semaphore:
                ok, message = await synthesize_mp3(edge_tts, term, args.en_voice, args.en_rate, output)
            if ok:
                stats.generated_en += 1
                if audio.get("en") != rel:
                    audio["en"] = rel
                    changed = True
            else:
                stats.failed += 1
                errors.append({
                    "entryId": entry.get("id", ""),
                    "term": term,
                    "kind": "en",
                    "text": term,
                    "path": str(output.relative_to(ROOT)),
                    "error": message,
                })

    zh_text = clean_zh_meaning(entry.get("meaning"))
    if zh_text:
        filename = f"{file_id}.mp3"
        output = AUDIO_ZH_DIR / filename
        rel = relative_audio_path("zh", filename)
        if output.exists() and not args.overwrite:
            stats.skipped_existing += 1
            if audio.get("zh") != rel:
                audio["zh"] = rel
                changed = True
        else:
            async with semaphore:
                ok, message = await synthesize_mp3(edge_tts, zh_text, args.zh_voice, args.zh_rate, output)
            if ok:
                stats.generated_zh += 1
                if audio.get("zh") != rel:
                    audio["zh"] = rel
                    changed = True
            else:
                stats.failed += 1
                errors.append({
                    "entryId": entry.get("id", ""),
                    "term": term,
                    "kind": "zh",
                    "text": zh_text,
                    "path": str(output.relative_to(ROOT)),
                    "error": message,
                })

    if audio and entry.get("audio") != audio:
        entry["audio"] = audio
        changed = True
    return changed


async def process_library(path: Path, args: argparse.Namespace, edge_tts: Any, errors: list[dict[str, Any]]) -> LibraryStats:
    library = read_json(path)
    entries = library.get("entries")
    if not isinstance(entries, list):
        raise ValueError(f"{path.name} entries 不是数组")

    selected = entries[: args.limit] if args.limit else entries
    stats = LibraryStats(file=path.name, total_entries=len(selected))
    semaphore = asyncio.Semaphore(max(1, int(args.concurrency)))

    print(f"\n处理 {path.name}")
    print(f"总词条数：{stats.total_entries}")

    tasks = [
        process_entry(edge_tts, entry, index, args, semaphore, stats, errors)
        for index, entry in enumerate(selected)
    ]
    results = await asyncio.gather(*tasks)
    stats.json_changed = any(results)

    if stats.json_changed:
        backup_json(path)
        path.write_text(json.dumps(library, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"生成英文音频数：{stats.generated_en}")
    print(f"生成中文音频数：{stats.generated_zh}")
    print(f"跳过已有音频数：{stats.skipped_existing}")
    print(f"失败数：{stats.failed}")
    print(f"修改 JSON：{1 if stats.json_changed else 0}")
    return stats


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate local mp3 audio for CET Reader dictionaries.")
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--library", help="只处理指定词库，例如 0604.json")
    target.add_argument("--all", action="store_true", help="处理 data/ 下所有词库 JSON")
    parser.add_argument("--limit", type=int, default=0, help="只处理前 N 个词条")
    parser.add_argument("--en-voice", default=DEFAULT_EN_VOICE, help="英文 edge-tts voice")
    parser.add_argument("--zh-voice", default=DEFAULT_ZH_VOICE, help="中文 edge-tts voice")
    parser.add_argument("--en-rate", default=DEFAULT_EN_RATE, help="英文语速，例如 -10%")
    parser.add_argument("--zh-rate", default=DEFAULT_ZH_RATE, help="中文语速，例如 +0%")
    parser.add_argument("--overwrite", action="store_true", help="覆盖已有 mp3")
    parser.add_argument("--concurrency", type=int, default=3, help="并发数，默认 3")
    return parser.parse_args()


async def main_async() -> int:
    args = parse_args()
    ensure_dirs()
    try:
        import edge_tts  # type: ignore[import-not-found]
    except ModuleNotFoundError:
        print("缺少依赖 edge-tts。请先运行：pip install edge-tts")
        return 2

    errors: list[dict[str, Any]] = []
    all_stats: list[LibraryStats] = []
    for path in library_paths(args):
        all_stats.append(await process_library(path, args, edge_tts, errors))

    if errors:
        ERROR_LOG.write_text(json.dumps(errors, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    elif ERROR_LOG.exists():
        ERROR_LOG.unlink()
    print("\n汇总")
    print(f"处理 JSON 数量：{len(all_stats)}")
    print(f"生成英文音频数：{sum(item.generated_en for item in all_stats)}")
    print(f"生成中文音频数：{sum(item.generated_zh for item in all_stats)}")
    print(f"跳过已有音频数：{sum(item.skipped_existing for item in all_stats)}")
    print(f"失败数：{sum(item.failed for item in all_stats)}")
    print(f"修改 JSON 数量：{sum(1 for item in all_stats if item.json_changed)}")
    print(f"错误日志路径：{ERROR_LOG if errors else '无错误'}")
    return 1 if errors else 0


def main() -> int:
    try:
        return asyncio.run(main_async())
    except Exception as error:  # noqa: BLE001 - top-level CLI guard
        print(f"生成失败：{error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
