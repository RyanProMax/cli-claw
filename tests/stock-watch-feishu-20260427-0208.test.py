#!/usr/bin/env python3
from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
import tempfile
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "stock-watch-feishu-20260427-0208.py"


def load_module():
    spec = importlib.util.spec_from_file_location("stock_watch_feishu", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load stock watch script")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def payload(change_pct: float = 0.0) -> dict:
    items = []
    for symbol in ["603228", "300033"]:
        items.append(
            {
                "requested_symbol": symbol,
                "status": "ok",
                "info": {"symbol": symbol, "name": f"Name{symbol}"},
                "quote_data": {"price": 10.0, "change_pct": change_pct},
            }
        )
    return {"summary": {"ok": len(items), "failed": 0}, "items": items}


def payload_from(rows: list[tuple[str, str, float, float]]) -> dict:
    return {
        "summary": {"ok": len(rows), "failed": 0},
        "items": [
            {
                "requested_symbol": symbol,
                "status": "ok",
                "info": {"symbol": symbol, "name": name},
                "quote_data": {"price": price, "change_pct": change_pct},
            }
            for symbol, name, price, change_pct in rows
        ],
    }


class StockWatchPushGatingTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.module = load_module()
        self.module.SYMBOLS = ["603228", "300033"]
        self.module.STATE_DIR = Path(self.tmp.name)
        self.module.STATE_PATH = Path(self.tmp.name) / "state.json"
        self.module.CALENDAR_PATH = Path(self.tmp.name) / "calendar.json"
        self.module.should_poll = lambda now: True

    def tearDown(self) -> None:
        self.tmp.cleanup()
        os.environ.pop("STOCK_WATCH_FORCE_NOW", None)

    def run_script(self, at: str, current_payload: dict) -> str:
        os.environ["STOCK_WATCH_FORCE_NOW"] = at
        self.module.poll = lambda: current_payload
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(self.module.main(), 0)
        return output.getvalue().strip()

    def test_first_run_pushes_full_snapshot_and_records_last_push(self) -> None:
        output = self.run_script("2026-04-27T09:40:00+08:00", payload(0.0))

        self.assertIn("盯盘快照", output)
        state = json.loads(self.module.STATE_PATH.read_text(encoding="utf-8"))
        self.assertEqual(state["last_pushed_at"], "2026-04-27T01:40:00+00:00")

    def test_no_alert_within_30_minutes_is_silent(self) -> None:
        self.run_script("2026-04-27T09:40:00+08:00", payload(0.0))

        output = self.run_script("2026-04-27T09:50:00+08:00", payload(0.0))

        self.assertEqual(output, "")

    def test_no_alert_after_30_minutes_pushes_heartbeat_snapshot(self) -> None:
        self.run_script("2026-04-27T09:40:00+08:00", payload(0.0))

        output = self.run_script("2026-04-27T10:10:00+08:00", payload(0.0))

        self.assertIn("盯盘快照：成功 2/2｜0｜0｜⚡0｜0", output)

    def test_new_alert_pushes_before_30_minute_heartbeat(self) -> None:
        self.run_script("2026-04-27T09:40:00+08:00", payload(0.0))

        output = self.run_script("2026-04-27T09:50:00+08:00", payload(0.03))

        self.assertIn("⚡ 603228", output)
        self.assertIn("⚡ 300033", output)

    def test_persistent_alert_is_silent_until_heartbeat(self) -> None:
        self.run_script("2026-04-27T09:40:00+08:00", payload(0.03))

        output = self.run_script("2026-04-27T09:50:00+08:00", payload(0.03))

        self.assertEqual(output, "")

    def test_snapshot_groups_alerts_and_direction_sections(self) -> None:
        self.module.SYMBOLS = ["002466", "300757", "300033", "603228"]
        self.run_script(
            "2026-04-27T09:40:00+08:00",
            payload_from(
                [
                    ("002466", "天齐锂业", 78.0, -0.018),
                    ("300757", "罗博特科", 508.0, 0.0128),
                    ("300033", "同花顺", 247.0, -0.005),
                    ("603228", "景旺电子", 74.0, 0.0),
                ]
            ),
        )

        output = self.run_script(
            "2026-04-27T09:50:00+08:00",
            payload_from(
                [
                    ("002466", "天齐锂业", 76.52, -0.0321),
                    ("300757", "罗博特科", 508.0, -0.0045),
                    ("300033", "同花顺", 243.04, -0.017),
                    ("603228", "景旺电子", 74.73, 0.0067),
                ]
            ),
        )

        self.assertIn("盯盘快照：成功 4/4｜1｜3｜⚡1｜2", output)
        self.assertIn("异动 2 家", output)
        self.assertIn("下跌 1 家", output)
        self.assertIn("上涨 1 家", output)
        self.assertIn(
            "⚡ 002466 天齐锂业 76.52 -3.21%｜下跌幅度超 2%",
            output,
        )
        self.assertIn(
            "⚡ 300757 罗博特科 508 -0.45%｜较上次回落 1.73 个百分点",
            output,
        )
        self.assertIn("-  300033 同花顺 243.04 -1.70%", output)
        self.assertIn("-  603228 景旺电子 74.73 +0.67%", output)
        self.assertNotIn("大跌", output)
        self.assertNotIn("大涨", output)
        self.assertNotIn("其他", output)
        self.assertNotIn("平盘", output)
        self.assertNotIn("涨跌幅", output)
        self.assertLess(output.index("异动 2 家"), output.index("下跌 1 家"))
        self.assertLess(output.index("下跌 1 家"), output.index("上涨 1 家"))


if __name__ == "__main__":
    unittest.main()
