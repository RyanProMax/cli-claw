#!/usr/bin/env python3
"""Convert /kol into the built-in stock KOL workflow trigger."""

from __future__ import annotations

import json
import shlex
import sys


DEFAULT_DAYS = 30
MIN_DAYS = 1
MAX_DAYS = 365


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
