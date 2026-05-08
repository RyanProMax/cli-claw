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

        self.assertIn("**盯盘快照：成功 2/2｜📈0｜📉0｜🚨0**", output)

    def test_new_alert_pushes_before_30_minute_heartbeat(self) -> None:
        self.run_script("2026-04-27T09:40:00+08:00", payload(0.0))

        output = self.run_script("2026-04-27T09:50:00+08:00", payload(0.03))

        self.assertIn("📈⚡ 603228", output)
        self.assertIn("📈⚡ 300033", output)

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

        self.assertIn("**盯盘快照：成功 4/4｜📈1｜📉3｜🚨2**", output)
        self.assertIn("**🚨 异动 2 家**", output)
        self.assertIn("**📉 下跌 1 家**", output)
        self.assertIn("**📈 上涨 1 家**", output)
        self.assertIn(
            "📉⚡ 002466 天齐锂业 76.52 -3.21%｜下跌幅度超 2% 🚨",
            output,
        )
        self.assertIn(
            "📉 300757 罗博特科 508 -0.45%｜较上次回落 1.73 个百分点 🚨",
            output,
        )
        self.assertIn("- 📉 300033 同花顺 243.04 -1.70%", output)
        self.assertIn("- 📈 603228 景旺电子 74.73 +0.67%", output)
        self.assertNotIn("大跌", output)
        self.assertNotIn("大涨", output)
        self.assertNotIn("其他", output)
        self.assertNotIn("平盘", output)
        self.assertNotIn("涨跌幅", output)
        self.assertLess(output.index("🚨 异动 2 家"), output.index("📉 下跌 1 家"))
        self.assertLess(output.index("📉 下跌 1 家"), output.index("📈 上涨 1 家"))

    def test_snapshot_matches_user_template_exactly(self) -> None:
        self.module.SYMBOLS = [
            "002466",
            "300757",
            "300014",
            "513180",
            "300827",
            "588320",
            "300033",
            "159952",
            "159919",
            "002983",
            "512100",
            "300274",
            "603228",
            "513110",
        ]
        self.run_script(
            "2026-04-27T09:40:00+08:00",
            payload_from(
                [
                    ("002466", "天齐锂业", 79.06, -0.018),
                    ("300757", "罗博特科", 510.31, 0.0),
                    ("300014", "亿纬锂能", 71.0, -0.01),
                    ("513180", "恒生科技ETF华夏", 0.65, -0.01),
                    ("300827", "上能电气", 38.5, -0.01),
                    ("588320", "双创50增强ETF广发", 1.84, -0.01),
                    ("300033", "同花顺", 245.0, -0.01),
                    ("159952", "创业ETF", 2.32, -0.005),
                    ("159919", "沪深300", 5.1, -0.005),
                    ("002983", "芯瑞达", 23.5, -0.002),
                    ("512100", "中证1000ETF南方", 3.5, 0.003),
                    ("300274", "阳光电源", 139.5, 0.002),
                    ("603228", "景旺电子", 74.0, 0.0),
                    ("513110", "纳指ETF华泰柏瑞", 2.315, 0.0),
                ]
            ),
        )

        output = self.run_script(
            "2026-04-27T09:50:00+08:00",
            payload_from(
                [
                    ("002466", "天齐锂业", 76.28, -0.0352),
                    ("300757", "罗博特科", 522.46, 0.0238),
                    ("300014", "亿纬锂能", 70.52, -0.018),
                    ("513180", "恒生科技ETF华夏", 0.645, -0.0138),
                    ("300827", "上能电气", 38.09, -0.0122),
                    ("588320", "双创50增强ETF广发", 1.821, -0.0114),
                    ("300033", "同花顺", 244.65, -0.0105),
                    ("159952", "创业ETF", 2.313, -0.0086),
                    ("159919", "沪深300", 5.09, -0.0061),
                    ("002983", "芯瑞达", 23.46, -0.0026),
                    ("512100", "中证1000ETF南方", 3.509, 0.0046),
                    ("300274", "阳光电源", 139.98, 0.0034),
                    ("603228", "景旺电子", 74.3, 0.0009),
                    ("513110", "纳指ETF华泰柏瑞", 2.315, 0.0),
                ]
            ),
        )

        self.assertEqual(
            output,
            "\n".join(
                [
                    "**盯盘快照：成功 14/14｜📈4｜📉9｜🚨2**",
                    "**🚨 异动 2 家**",
                    "- 📉⚡ 002466 天齐锂业 76.28 -3.52%｜下跌幅度超 2% 🚨",
                    "- 📈⚡ 300757 罗博特科 522.46 +2.38%｜上涨幅度超 2% 🚨",
                    "**📉 下跌 8 家**",
                    "- 📉 300014 亿纬锂能 70.52 -1.80%",
                    "- 📉 513180 恒生科技ETF华夏 0.645 -1.38%",
                    "- 📉 300827 上能电气 38.09 -1.22%",
                    "- 📉 588320 双创50增强ETF广发 1.821 -1.14%",
                    "- 📉 300033 同花顺 244.65 -1.05%",
                    "- 📉 159952 创业ETF 2.313 -0.86%",
                    "- 📉 159919 沪深300 5.09 -0.61%",
                    "- 📉 002983 芯瑞达 23.46 -0.26%",
                    "**📈 上涨 3 家**",
                    "- 📈 512100 中证1000ETF南方 3.509 +0.46%",
                    "- 📈 300274 阳光电源 139.98 +0.34%",
                    "- 📈 603228 景旺电子 74.3 +0.09%",
                    "**➖ 平盘 1 家**",
                    "- ➖ 513110 纳指ETF华泰柏瑞 2.315 +0.00%",
                ]
            ),
        )


if __name__ == "__main__":
    unittest.main()
