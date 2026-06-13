#!/usr/bin/env python3
"""Convert /kol into the built-in stock KOL workflow trigger."""

from __future__ import annotations

import json
import os
import re
import shlex
import sys
from pathlib import Path


DEFAULT_DAYS = 30
MIN_DAYS = 1
MAX_DAYS = 365
X_HANDLE_RE = re.compile(
    r"(?:https?://(?:www\.)?(?:x|twitter)\.com/([A-Za-z0-9_]{1,15})(?:[/?#][^\s)]*)?)|@([A-Za-z0-9_]{1,15})",
    re.IGNORECASE,
)
RESERVED_X_PATHS = {"i", "intent", "search", "share", "home", "explore"}


def emit_reply(reply: dict) -> None:
    sys.stdout.write(json.dumps({"reply": reply}, ensure_ascii=False))


def emit_usage(message: str | None = None) -> None:
    prefix = f"{message}\n\n" if message else ""
    emit_reply(
        {
            "type": "final_markdown",
            "content": (
                prefix
                + "用法：`/kol [--days=30]`\n\n"
                + "- `/kol`：触发默认 KOL 白名单工作流，最近 30 天。\n"
                + "- `/kol --days=7`：触发最近 7 天的 KOL 情报工作流。\n\n"
                + "不支持 `--platform` / `--deep` / positional KOL 参数；平台和 KOL 范围由白名单与内置信源统一维护。"
            ),
        }
    )


def emit_kol_add_usage(message: str | None = None) -> None:
    prefix = f"{message}\n\n" if message else ""
    emit_reply(
        {
            "type": "final_markdown",
            "content": (
                prefix
                + "用法：`/kol-add <@handle 或 X 链接...> [--name 名称] [--focus 标签] [--note 说明]`\n\n"
                + "- `/kol-add @charliebilello --name \"Charlie Bilello\" --focus 市场策略 --note 数据图表分析`\n"
                + "- `/kol-add` 后也可以直接粘贴多行 Markdown X 链接列表。\n\n"
                + "该命令会写入 `/kol` workflow 实际读取的 `references/kol_whitelist.json`，按 X handle 去重。"
            ),
        }
    )


def parse_days(args_text: str) -> tuple[int | None, str | None]:
    try:
        args = shlex.split(args_text.strip())
    except ValueError as exc:
        return None, f"参数解析失败：{exc}"

    days = DEFAULT_DAYS
    index = 0
    while index < len(args):
        arg = args[index]
        if arg.startswith("--days="):
            value = arg.split("=", 1)[1]
        elif arg == "--days":
            index += 1
            if index >= len(args):
                return None, "`--days` 需要一个数字参数。"
            value = args[index]
        else:
            return None, f"不支持的参数：`{arg}`。"

        try:
            parsed = int(value)
        except ValueError:
            return None, f"`--days` 必须是整数，当前是 `{value}`。"
        if parsed < MIN_DAYS or parsed > MAX_DAYS:
            return None, (
                f"`--days` 必须在 {MIN_DAYS}-{MAX_DAYS} 之间，当前是 {parsed}。"
            )
        days = parsed
        index += 1

    return days, None


def normalize_handle(value: str | None) -> str | None:
    handle = (value or "").strip().lstrip("@").lower()
    if not handle or handle in RESERVED_X_PATHS:
        return None
    if not re.fullmatch(r"[a-z0-9_]{1,15}", handle):
        return None
    return handle


def extract_x_handles(text: str) -> list[tuple[str, int]]:
    handles: list[tuple[str, int]] = []
    seen: set[str] = set()
    for line_index, line in enumerate(text.splitlines() or [text]):
        for match in X_HANDLE_RE.finditer(line):
            handle = normalize_handle(match.group(1) or match.group(2))
            if not handle or handle in seen:
                continue
            seen.add(handle)
            handles.append((handle, line_index))
    return handles


def parse_kol_add_flags(args_text: str) -> dict:
    values: dict = {"name": None, "focus": [], "note": None}
    try:
        args = shlex.split(args_text.strip())
    except ValueError:
        return values

    index = 0
    while index < len(args):
        arg = args[index]
        value: str | None = None
        key = arg
        if arg.startswith("--") and "=" in arg:
            key, value = arg.split("=", 1)
        elif arg in {"--name", "--display-name", "--focus", "--tag", "--note"}:
            index += 1
            if index >= len(args):
                break
            value = args[index]
        else:
            index += 1
            continue

        if value is None:
            index += 1
            continue
        if key in {"--name", "--display-name"} and not values["name"]:
            values["name"] = value.strip()
        elif key in {"--focus", "--tag"}:
            values["focus"].extend(split_focus_values(value))
        elif key == "--note" and not values["note"]:
            values["note"] = value.strip()
        index += 1

    return values


def split_focus_values(value: str) -> list[str]:
    return [
        item.strip()
        for item in re.split(r"[,，/、]", value)
        if item.strip()
    ]


def clean_context_line(line: str) -> str:
    text = line.strip()
    text = re.sub(r"^\s*[-*]\s*", "", text)
    text = re.sub(r"^\s*\d+[.、]\s*", "", text)
    return text.strip()


def context_for_handle(args_text: str, line_index: int) -> tuple[str | None, str | None]:
    lines = args_text.splitlines()
    display_name: str | None = None
    note_parts: list[str] = []

    for line in lines[line_index + 1 :]:
        if extract_x_handles(line):
            break
        cleaned = clean_context_line(line)
        if not cleaned or cleaned in {"---", "—"}:
            continue
        if display_name is None:
            display_name = cleaned
            continue
        note_parts.append(cleaned)

    note = " ".join(note_parts).strip() or None
    return display_name, note


def find_skill_repo_root() -> Path | None:
    env_root = os.environ.get("STOCK_KOL_INTEL_ROOT", "").strip()
    candidates: list[Path] = []
    if env_root:
        candidates.append(Path(env_root).expanduser())

    skill_dir = Path(
        os.environ.get("AGENT_FABRIC_SKILL_DIR", "") or __file__
    ).resolve()
    if skill_dir.is_file():
        skill_dir = skill_dir.parent.parent
    for parent in [skill_dir, *skill_dir.parents]:
        candidates.append(parent)
        candidates.append(parent.parent / "stock-kol-intel")

    candidates.extend(
        [
            Path.home() / "projects" / "stock-kol-intel",
            Path.home() / "stock-kol-intel",
        ]
    )

    for candidate in candidates:
        resolved = candidate.expanduser().resolve()
        if (
            (resolved / "references" / "kol_whitelist.json").exists()
            and (resolved / "commands" / "kol.py").exists()
        ):
            return resolved
    return None


def load_whitelist_file(root: Path) -> tuple[Path, dict]:
    path = root / "references" / "kol_whitelist.json"
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise RuntimeError(f"未找到 KOL 白名单文件：{path}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"KOL 白名单 JSON 解析失败：{exc}") from exc
    if not isinstance(value, dict):
        raise RuntimeError("KOL 白名单必须是 JSON object")
    if not isinstance(value.get("kols"), list):
        value["kols"] = []
    return path, value


def existing_handles(whitelist: dict) -> set[str]:
    handles: set[str] = set()
    for kol in whitelist.get("kols", []):
        if not isinstance(kol, dict):
            continue
        kol_id = normalize_handle(str(kol.get("id") or ""))
        if kol_id:
            handles.add(kol_id)
        links = []
        links.extend(kol.get("primary_links") or [])
        links.extend(kol.get("candidate_links") or [])
        for link in links:
            if not isinstance(link, dict):
                continue
            url = str(link.get("url") or "")
            for handle, _line in extract_x_handles(url):
                handles.add(handle)
    return handles


def unique_strings(values: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for raw in values:
        value = raw.strip()
        key = value.lower()
        if not value or key in seen:
            continue
        seen.add(key)
        result.append(value)
    return result


def build_kol_entry(
    handle: str,
    display_name: str | None,
    focus: list[str],
    note: str | None,
) -> dict:
    name = (display_name or handle).strip() or handle
    aliases = unique_strings([name, handle])
    focus_values = unique_strings(focus or ([name] if name != handle else []))
    notes = (note or "Added via /kol-add from a user-provided X/Twitter handle.").strip()
    return {
        "id": handle,
        "display_name": name,
        "aliases": aliases,
        "focus": focus_values,
        "primary_links": [
            {
                "platform": "X/Twitter",
                "url": f"https://x.com/{handle}",
                "confidence": "confirmed",
                "evidence": "User-provided target handle via /kol-add.",
            }
        ],
        "candidate_links": [],
        "notes": notes,
    }


def write_whitelist(path: Path, whitelist: dict) -> None:
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(
        json.dumps(whitelist, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    tmp_path.replace(path)


def handle_kol_add(args_text: str) -> int:
    extracted = extract_x_handles(args_text)
    if not extracted:
        emit_kol_add_usage("没有识别到 X/Twitter handle 或链接。")
        return 0

    root = find_skill_repo_root()
    if root is None:
        emit_reply(
            {
                "type": "final_markdown",
                "content": "未找到 stock-kol-intel 仓库或 references/kol_whitelist.json；可设置 STOCK_KOL_INTEL_ROOT。",
            }
        )
        return 0

    try:
        path, whitelist = load_whitelist_file(root)
    except RuntimeError as exc:
        emit_reply({"type": "final_markdown", "content": str(exc)})
        return 0

    flags = parse_kol_add_flags(args_text)
    existing = existing_handles(whitelist)
    added: list[str] = []
    skipped: list[str] = []

    for handle, line_index in extracted:
        if handle in existing:
            skipped.append(handle)
            continue
        context_name, context_note = context_for_handle(args_text, line_index)
        display_name = flags["name"] if len(extracted) == 1 else context_name
        note = flags["note"] if len(extracted) == 1 else context_note
        focus = flags["focus"] if flags["focus"] else split_focus_values(context_name or "")
        whitelist["kols"].append(build_kol_entry(handle, display_name, focus, note))
        existing.add(handle)
        added.append(handle)

    if added:
        write_whitelist(path, whitelist)

    lines = [
        "已更新 KOL 白名单。",
        f"白名单：`{path}`",
        f"新增 {len(added)} 个：{', '.join('@' + item for item in added) if added else '无'}",
        f"已存在 {len(skipped)} 个：{', '.join('@' + item for item in skipped) if skipped else '无'}",
        f"当前总数：{len(whitelist.get('kols', []))}",
    ]
    emit_reply({"type": "final_markdown", "content": "\n".join(lines)})
    return 0


def load_payload() -> dict:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


def main() -> int:
    payload = load_payload()
    command = str(payload.get("command") or "kol").strip().lower()
    if command == "kol-add":
        return handle_kol_add(str(payload.get("argsText") or ""))

    days, error = parse_days(str(payload.get("argsText") or ""))
    if error:
        emit_usage(error)
        return 0

    resolved_days = days or DEFAULT_DAYS
    emit_reply(
        {
            "type": "workflow",
            "workflowId": "kol",
            "content": "股票 KOL 情报报告",
            "input": {"days": resolved_days},
            "ack": f"已启动 KOL 情报工作流，窗口 {resolved_days} 天。",
        }
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
