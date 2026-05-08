#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import date, datetime, time, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

WATCH_ID = "stock-watch-feishu-20260427-0208"
API_ROOT = Path("/Users/ryan/projects/stock-analysis-api")
PYTHON = "/Users/ryan/projects/stock-analysis-api/.venv/bin/python"
SYMBOLS = [
    "603228", "300033", "513110", "002983", "513180", "588320",
    "300757", "002466", "512100", "159919", "159952",
    "300827", "300014", "300274",
]
STATE_DIR = Path.home() / ".cli-claw" / "stock-watch"
STATE_PATH = STATE_DIR / f"{WATCH_ID}.json"
CALENDAR_PATH = STATE_DIR / "cn-trade-calendar.json"
CHANGE_POINT_THRESHOLD = 0.015
ABS_MOVE_THRESHOLD = 0.02
HEARTBEAT_PUSH_INTERVAL_SECONDS = 30 * 60
BEIJING_TZ = ZoneInfo("Asia/Shanghai")
CN_MARKET_SESSIONS = (
    (time(9, 30), time(11, 30)),
    (time(13, 0), time(15, 0)),
)
CN_MARKET_HOLIDAY_RANGES_2026 = (
    (date(2026, 1, 1), date(2026, 1, 3)),
    (date(2026, 2, 15), date(2026, 2, 23)),
    (date(2026, 4, 4), date(2026, 4, 6)),
    (date(2026, 5, 1), date(2026, 5, 5)),
    (date(2026, 6, 19), date(2026, 6, 21)),
    (date(2026, 9, 25), date(2026, 9, 27)),
    (date(2026, 10, 1), date(2026, 10, 7)),
)


def load_env() -> dict[str, str]:
    env = os.environ.copy()
    env["PATH"] = f"/Users/ryan/.local/bin:/opt/homebrew/bin:/usr/local/bin:{env.get('PATH', '')}"
    env["PYTHONUNBUFFERED"] = "1"
    env["PYTHONPATH"] = str(API_ROOT)
    env_file = API_ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip().replace("\r", "")
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def poll() -> dict:
    command = [PYTHON, "scripts/poll_realtime_quotes.py", "--symbols", ",".join(SYMBOLS)]
    completed = subprocess.run(
        command,
        cwd=API_ROOT,
        env=load_env(),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=90,
    )
    if completed.returncode != 0:
        raise RuntimeError((completed.stderr or completed.stdout).strip() or f"exit {completed.returncode}")
    return json.loads(completed.stdout)


def current_beijing_time() -> datetime:
    forced = os.environ.get("STOCK_WATCH_FORCE_NOW")
    if forced:
        parsed = datetime.fromisoformat(forced)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=BEIJING_TZ)
        return parsed.astimezone(BEIJING_TZ)
    return datetime.now(BEIJING_TZ)


def is_cn_market_time(now: datetime) -> bool:
    current = now.time()
    return any(start <= current <= end for start, end in CN_MARKET_SESSIONS)


def static_cn_trading_day(now: datetime) -> bool | None:
    current_date = now.date()
    if current_date.year != 2026:
        return None
    if now.weekday() >= 5:
        return False
    return not any(start <= current_date <= end for start, end in CN_MARKET_HOLIDAY_RANGES_2026)


def load_cached_trading_day(cal_date: str) -> bool | None:
    if not CALENDAR_PATH.exists():
        return None
    try:
        payload = json.loads(CALENDAR_PATH.read_text(encoding="utf-8"))
    except Exception:
        return None
    cached = payload.get(cal_date)
    if isinstance(cached, bool):
        return cached
    return None


def save_cached_trading_day(cal_date: str, is_open: bool) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    payload = {}
    if CALENDAR_PATH.exists():
        try:
            loaded = json.loads(CALENDAR_PATH.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                payload = loaded
        except Exception:
            payload = {}
    payload[cal_date] = is_open
    CALENDAR_PATH.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def query_cn_trading_day(cal_date: str) -> bool | None:
    code = """
import os
import sys
import tushare as ts

token = os.environ.get('TUSHARE_TOKEN')
if not token:
    sys.exit(2)
http_url = os.environ.get('TUSHARE_HTTP_URL', '').strip()
pro = ts.pro_api('anything')
setattr(pro, '_DataApi__token', token)
if http_url:
    setattr(pro, '_DataApi__http_url', http_url)
df = pro.trade_cal(exchange='', start_date=sys.argv[1], end_date=sys.argv[1], fields='cal_date,is_open')
if df is None or df.empty:
    sys.exit(3)
print(int(df.iloc[0]['is_open']))
"""
    completed = subprocess.run(
        [PYTHON, "-c", code, cal_date],
        cwd=API_ROOT,
        env=load_env(),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=30,
    )
    if completed.returncode != 0:
        return None
    value = completed.stdout.strip()
    if value == "1":
        return True
    if value == "0":
        return False
    return None


def is_cn_trading_day(now: datetime) -> bool:
    if now.weekday() >= 5:
        return False
    static_result = static_cn_trading_day(now)
    if static_result is not None:
        return static_result
    cal_date = now.strftime("%Y%m%d")
    cached = load_cached_trading_day(cal_date)
    if cached is not None:
        return cached
    queried = query_cn_trading_day(cal_date)
    if queried is None:
        return False
    save_cached_trading_day(cal_date, queried)
    return queried


def should_poll(now: datetime) -> bool:
    return is_cn_trading_day(now) and is_cn_market_time(now)


def ratio_to_pct(value) -> str:
    try:
        return f"{float(value) * 100:+.2f}%"
    except Exception:
        return "--"


def parse_change_pct(value) -> float:
    try:
        return float(value)
    except Exception:
        return 0.0


def number_to_text(value) -> str:
    if value in (None, ""):
        return "--"
    try:
        text = f"{float(value):.3f}".rstrip("0").rstrip(".")
        return text or "0"
    except Exception:
        return str(value)


def move_badge(change_pct: float) -> str:
    if change_pct >= ABS_MOVE_THRESHOLD:
        return "📈⚡"
    if change_pct > 0:
        return "📈"
    if change_pct <= -ABS_MOVE_THRESHOLD:
        return "📉⚡"
    if change_pct < 0:
        return "📉"
    return "➖"


def format_snapshot_row(
    *,
    symbol: str,
    name: str,
    price,
    change_pct: float,
    reasons: list[str],
) -> str:
    icon = move_badge(change_pct)
    price_text = number_to_text(price)
    pct_text = ratio_to_pct(change_pct)
    if reasons:
        return (
            f"🚨 {icon} {symbol} {name} {price_text} {pct_text}"
            f"｜{'；'.join(reasons)}"
        )
    return f"{icon} {symbol} {name} {price_text} {pct_text}"


def append_snapshot_section(
    lines: list[str],
    title: str,
    rows: list[dict],
) -> None:
    if not rows:
        return
    lines.append(title)
    lines.extend(f"- {row['line']}" for row in rows)


def format_snapshot_lines(rows: list[dict], *, ok: int, total: int) -> list[str]:
    alert_rows = sorted(
        [row for row in rows if row["is_alert"]],
        key=lambda row: abs(row["change_pct"]),
        reverse=True,
    )
    remaining_rows = [row for row in rows if not row["is_alert"]]
    down_rows = sorted(
        [row for row in remaining_rows if row["change_pct"] < 0],
        key=lambda row: row["change_pct"],
    )
    up_rows = sorted(
        [row for row in remaining_rows if row["change_pct"] > 0],
        key=lambda row: row["change_pct"],
        reverse=True,
    )
    flat_rows = sorted(
        [row for row in remaining_rows if row["change_pct"] == 0],
        key=lambda row: row["symbol"],
    )

    up_count = sum(1 for row in rows if row["change_pct"] > 0)
    down_count = sum(1 for row in rows if row["change_pct"] < 0)
    big_move_count = sum(1 for row in rows if abs(row["change_pct"]) >= ABS_MOVE_THRESHOLD)
    alert_count = len(alert_rows)
    other_prefix = "其他 " if alert_rows else ""

    lines = [
        (
            f"盯盘全量快照：成功 {ok}/{total}"
            f"｜📈{up_count}｜📉{down_count}"
            f"｜⚡{big_move_count}｜🚨{alert_count}"
        )
    ]
    append_snapshot_section(lines, f"🚨 异动 {len(alert_rows)}", alert_rows)
    append_snapshot_section(lines, f"📉 {other_prefix}{len(down_rows)}", down_rows)
    append_snapshot_section(lines, f"📈 {other_prefix}{len(up_rows)}", up_rows)
    append_snapshot_section(lines, f"➖ {other_prefix}{len(flat_rows)}", flat_rows)
    return lines


def quote_map(payload: dict) -> dict[str, dict]:
    result = {}
    for item in payload.get("items", []):
        if item.get("status") != "ok" or not item.get("quote_data"):
            continue
        symbol = item.get("requested_symbol") or item.get("info", {}).get("symbol")
        if not symbol:
            continue
        result[symbol] = item
    return result


def load_state() -> dict:
    if not STATE_PATH.exists():
        return {}
    try:
        loaded = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        return loaded if isinstance(loaded, dict) else {}
    except Exception:
        return {}


def parse_utc_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except Exception:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def should_emit_push(
    *,
    previous_alert_keys: set[str],
    current_alert_keys: set[str],
    last_pushed_at: str | None,
    now_utc: datetime,
) -> bool:
    if current_alert_keys - previous_alert_keys:
        return True
    last_pushed = parse_utc_datetime(last_pushed_at)
    if last_pushed is None:
        return True
    return (now_utc - last_pushed).total_seconds() >= HEARTBEAT_PUSH_INTERVAL_SECONDS


def main() -> int:
    now_bj = current_beijing_time()
    if not should_poll(now_bj):
        return 0

    now_utc = now_bj.astimezone(timezone.utc)
    now = now_utc.isoformat()
    payload = poll()
    current = quote_map(payload)
    state = load_state()
    previous = state.get("items", {}) if isinstance(state.get("items"), dict) else {}
    previous_alert_keys = set()
    if isinstance(state.get("alert_keys"), list):
        previous_alert_keys = {str(key) for key in state.get("alert_keys", [])}

    rows: list[dict] = []
    current_alert_keys: set[str] = set()
    for symbol in SYMBOLS:
        item = current.get(symbol)
        if not item:
            continue
        quote = item["quote_data"]
        info = item.get("info") or {}
        name = info.get("name") or symbol
        price = quote.get("price")
        change_pct = quote.get("change_pct")
        cp = parse_change_pct(change_pct)
        reasons = []
        if abs(cp) >= ABS_MOVE_THRESHOLD:
            current_alert_keys.add(f"abs_move:{symbol}")
            reasons.append(f"幅度 {ratio_to_pct(cp)}")
        if symbol == "603228" and cp >= 0.095:
            current_alert_keys.add(f"limit_up:{symbol}")
            reasons.append("接近/达到涨停")
        prev_quote = (previous.get(symbol) or {}).get("quote_data") or {}
        try:
            prev_cp = float(prev_quote.get("change_pct"))
            if abs(cp - prev_cp) >= CHANGE_POINT_THRESHOLD:
                current_alert_keys.add(f"change_point:{symbol}")
                reasons.append(f"较上次变化 {((cp - prev_cp) * 100):+.2f}pct")
        except Exception:
            pass
        rows.append(
            {
                "symbol": symbol,
                "change_pct": cp,
                "is_alert": bool(reasons),
                "line": format_snapshot_row(
                    symbol=symbol,
                    name=name,
                    price=price,
                    change_pct=cp,
                    reasons=reasons,
                ),
            }
        )

    should_emit = should_emit_push(
        previous_alert_keys=previous_alert_keys,
        current_alert_keys=current_alert_keys,
        last_pushed_at=state.get("last_pushed_at") if isinstance(state.get("last_pushed_at"), str) else None,
        now_utc=now_utc,
    )

    STATE_DIR.mkdir(parents=True, exist_ok=True)
    next_state = {
        "updated_at": now,
        "summary": payload.get("summary"),
        "items": current,
        "alert_keys": sorted(current_alert_keys),
        "last_pushed_at": now if should_emit else state.get("last_pushed_at"),
    }
    STATE_PATH.write_text(json.dumps(next_state, ensure_ascii=False), encoding="utf-8")

    if not should_emit:
        return 0

    ok = len(current)
    lines = format_snapshot_lines(rows, ok=ok, total=len(SYMBOLS))
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"盯盘脚本失败：{exc}", file=sys.stderr)
        raise SystemExit(1)
