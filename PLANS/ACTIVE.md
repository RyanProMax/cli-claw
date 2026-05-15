# Active Task: Stock Watch Script Timeout

## Current Goal

- Fix the Feishu stock-watch scheduled script timeout during A-share market hours.
- Address the quote polling hot path instead of only increasing scheduler timeout.

## Current Milestone

Objective:
- Make `poll_realtime_quotes.py` avoid slow per-symbol Tushare Pro metadata/quotation calls when the legacy realtime quote path can provide the watch snapshot data quickly.
- Keep the existing JSON contract and snapshot formatting stable.

Validation:
- `pytest tests/test_realtime_quote_polling_cli.py`
- `python3 tests/stock-watch-feishu-20260427-0208.test.py`
- Live forced market-time run of `scripts/stock-watch-feishu-20260427-0208.py` completes well below the 60s scheduler timeout.
- `git diff --check`

Status:
- done

Validation status:
- passed 2026-05-15:
  - API RED test reproduced missing `--fast-realtime` before implementation.
  - `pytest tests/test_realtime_quote_polling_cli.py`: 6 passed.
  - `python3 tests/stock-watch-feishu-20260427-0208.test.py`: 11 passed.
  - Live forced market-time run with network access returned `成功 14/14` and completed below the 60s scheduler timeout.
  - `git diff --check`: passed for `cli-claw` and `stock-analysis-api`.

Review status:
- passed 2026-05-15: fix targets the quote polling hot path. Normal full-mode `poll_realtime_quotes.py` contract remains unchanged; `--fast-realtime` is opt-in and the Feishu stock-watch script is the only caller changed to use it. Subprocess timeouts are now bounded below the scheduler's 60s timeout so failures can return controlled script errors instead of outer scheduler kills.

## Notes

- 2026-05-15 root cause: `stock-watch-feishu-20260427-0208` times out after market open because the script calls `stock-analysis-api/scripts/poll_realtime_quotes.py` for 14 symbols; the API service queries slow/empty Tushare Pro `stock_basic` / `etf_basic` and `quotation` serially before falling back to fast legacy realtime quotes.
- Outer scheduler timeout is 60s while the inner polling subprocess timeout is 90s, so the scheduler kills the script before it can return a useful error.
- Implemented API `--fast-realtime` mode and updated the stock-watch script to use it with bounded quote/index subprocess timeouts.
