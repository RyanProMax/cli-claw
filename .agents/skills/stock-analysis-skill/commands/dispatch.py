#!/usr/bin/env python3
"""Delegate repository slash commands to the stock-analysis-skill repo."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path


COMMAND_FILES = {
    "hkipo": "hkipo.py",
    "cnipo": "cnipo.py",
    "research": "research.py",
    "otc": "otc.py",
}


def emit_error(message: str) -> None:
    sys.stdout.write(
        json.dumps(
            {"reply": {"type": "final_markdown", "content": message}},
            ensure_ascii=False,
        )
    )


def repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def candidate_roots() -> list[Path]:
    roots: list[Path] = []
    env_root = os.environ.get("STOCK_ANALYSIS_SKILL_ROOT")
    if env_root:
        roots.append(Path(env_root).expanduser())
    root = repo_root()
    roots.extend(
        [
            root.parent / "stock-analysis-skill",
            Path.home() / "projects" / "stock-analysis-skill",
            Path.home() / "stock-analysis-skill",
        ]
    )
    return roots


def resolve_external_root() -> Path | None:
    for root in candidate_roots():
        candidate = root.resolve()
        if (candidate / "commands.json").is_file() and (
            candidate / "commands"
        ).is_dir():
            return candidate
    return None


def python_executable(root: Path) -> str:
    candidates = (
        [root / ".venv" / "Scripts" / "python.exe", root / ".venv" / "Scripts" / "python"]
        if os.name == "nt"
        else [root / ".venv" / "bin" / "python"]
    )
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    return sys.executable


def main() -> int:
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    filename = COMMAND_FILES.get(command)
    if not filename:
        emit_error(f"未知股票命令：/{command or '?'}")
        return 0

    external_root = resolve_external_root()
    if external_root is None:
        emit_error(
            "未找到 stock-analysis-skill 仓库。请设置 STOCK_ANALYSIS_SKILL_ROOT，"
            "或把该仓库放在 cli-claw 同级目录。"
        )
        return 0

    script = external_root / "commands" / filename
    if not script.is_file():
        emit_error(f"stock-analysis-skill 缺少命令文件：commands/{filename}")
        return 0

    env = os.environ.copy()
    env["CLI_CLAW_SKILL_DIR"] = str(external_root)
    proc = subprocess.run(
        [python_executable(external_root), str(script)],
        input=sys.stdin.read(),
        text=True,
        cwd=str(external_root),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if proc.stdout:
        sys.stdout.write(proc.stdout)
    else:
        emit_error(proc.stderr.strip() or f"/{command} 未返回结果")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
