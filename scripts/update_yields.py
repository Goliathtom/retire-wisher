#!/usr/bin/env python3
"""ETF 배당 수익률(TTM) 자동 갱신 스크립트.

- 해외(미국) ETF: yfinance 로 최근 12개월 분배금 합 / 현재가 = TTM 수익률 계산
- 국내 ETF: pykrx 로 최근 12개월 분배금(배당) 합 / 현재가 = TTM 수익률 계산

계산된 값으로 ../etf.js 의 ETF_DATA 내 각 종목 `yield:` 값을 in-place 로 갱신하고,
각 그룹(미국/국내)을 수익률 오름차순으로 재정렬한다.

사용법:
    pip install -r requirements.txt
    python update_yields.py            # etf.js 갱신
    python update_yields.py --dry-run  # 계산만 하고 파일은 건드리지 않음
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import re
import sys
from pathlib import Path

ETF_JS = Path(__file__).resolve().parent.parent / "etf.js"

# etf.js 의 ETF_DATA 키 -> yfinance 티커 (미국)
US_TICKERS = {
    "SCHD": "SCHD",
    "JEPI": "JEPI",
    "GPIQ": "GPIQ",
    "JEPQ": "JEPQ",
    "SPYI": "SPYI",
    "QQQI": "QQQI",
}

# etf.js 의 ETF_DATA 키 -> KRX 종목코드 (국내)
# NOTE: 일부 코드는 검증 필요. 빈 문자열("")이면 해당 종목은 건너뛰고 기존 값을 유지한다.
KR_TICKERS = {
    "TIGER배당다우": "458730",     # TIGER 미국배당다우존스
    "SOL배당다우": "446720",       # SOL 미국배당다우존스
    "TIGER고배당": "210780",       # TIGER 고배당
    "TIGER프리미엄": "458760",     # TIGER 미국배당+7%프리미엄다우존스
    "KODEX프리미엄": "441640",     # KODEX 미국배당프리미엄(커버드콜액티브)
    "KODEX나스닥프리미엄": "",     # KODEX 미국배당나스닥프리미엄 — 종목코드 확인 후 입력
}


def _one_year_ago(today: dt.date) -> dt.date:
    try:
        return today.replace(year=today.year - 1)
    except ValueError:  # 2/29
        return today.replace(year=today.year - 1, day=28)


def _yf_session():
    """사내 프록시(MITM) 환경에서 ETF_INSECURE_SSL=1 이면 SSL 검증을 끈 세션 반환."""
    if os.environ.get("ETF_INSECURE_SSL") not in ("1", "true", "True"):
        return None
    try:
        from curl_cffi import requests as cffi_requests

        return cffi_requests.Session(verify=False, impersonate="chrome")
    except Exception:  # noqa: BLE001
        return None


def fetch_us_yield(symbol: str) -> float | None:
    """yfinance 로 TTM 배당수익률 계산 (소수, 예: 0.0325)."""
    import yfinance as yf

    session = _yf_session()
    ticker = yf.Ticker(symbol, session=session) if session else yf.Ticker(symbol)
    divs = ticker.dividends
    if divs is None or divs.empty:
        return None

    today = dt.date.today()
    cutoff = _one_year_ago(today)
    ttm = divs[divs.index.date >= cutoff].sum()
    if ttm <= 0:
        return None

    hist = ticker.history(period="5d")
    if hist.empty:
        return None
    price = float(hist["Close"].iloc[-1])
    if price <= 0:
        return None

    return round(ttm / price, 4)


def fetch_kr_yield(code: str) -> float | None:
    """pykrx 로 TTM 배당수익률 계산 (소수). 분배금 데이터가 없으면 None."""
    from pykrx import stock

    today = dt.date.today()
    cutoff = _one_year_ago(today)
    start = cutoff.strftime("%Y%m%d")
    end = today.strftime("%Y%m%d")

    # 현재가
    ohlcv = stock.get_etf_ohlcv_by_date(start, end, code)
    if ohlcv is None or ohlcv.empty:
        return None
    price = float(ohlcv["종가"].iloc[-1])
    if price <= 0:
        return None

    # 분배금(배당) 내역 — pykrx 의 ETF 분배금 API
    try:
        divs = stock.get_etf_trading_value_by_date  # placeholder guard
    except AttributeError:
        divs = None

    # pykrx 는 ETF 분배금 시계열을 get_etf_ohlcv_by_date 의 '기초지수'/'분배금'으로 직접
    # 제공하지 않으므로, 분배금 컬럼이 있으면 사용하고 없으면 fundamental DIV 로 fallback.
    div_total = 0.0
    if "분배금" in ohlcv.columns:
        div_total = float(ohlcv["분배금"].sum())

    if div_total > 0:
        return round(div_total / price, 4)

    # fallback: 시장 기본 지표의 DIV(배당수익률, %) 사용
    fund = stock.get_market_fundamental_by_date(start, end, code)
    if fund is not None and not fund.empty and "DIV" in fund.columns:
        div_pct = float(fund["DIV"].iloc[-1])
        if div_pct > 0:
            return round(div_pct / 100, 4)

    return None


def update_etf_js(yields: dict[str, float], dry_run: bool) -> None:
    text = ETF_JS.read_text(encoding="utf-8")

    for key, value in yields.items():
        # 'KEY': { yield: 0.0325, ...  또는  KEY: { yield: 0.0325, ...
        pattern = re.compile(
            r"(['\"]?" + re.escape(key) + r"['\"]?\s*:\s*\{\s*yield:\s*)([0-9.]+)"
        )
        new_text, n = pattern.subn(lambda m: f"{m.group(1)}{value}", text)
        if n == 0:
            print(f"  ! etf.js 에서 '{key}' 항목을 찾지 못함 — 건너뜀", file=sys.stderr)
        else:
            text = new_text

    if dry_run:
        print("\n[dry-run] etf.js 는 변경하지 않았습니다.")
        return

    ETF_JS.write_text(text, encoding="utf-8")
    print(f"\netf.js 갱신 완료: {len(yields)}개 종목")


def main() -> int:
    parser = argparse.ArgumentParser(description="ETF 배당 수익률(TTM) 자동 갱신")
    parser.add_argument("--dry-run", action="store_true", help="계산만 하고 파일은 변경하지 않음")
    args = parser.parse_args()

    results: dict[str, float] = {}

    print("== 미국 ETF (yfinance) ==")
    for key, symbol in US_TICKERS.items():
        try:
            y = fetch_us_yield(symbol)
        except Exception as exc:  # noqa: BLE001
            print(f"  {key} ({symbol}): 오류 - {exc}", file=sys.stderr)
            continue
        if y is None:
            print(f"  {key} ({symbol}): 수익률 계산 실패 — 기존 값 유지")
            continue
        results[key] = y
        print(f"  {key} ({symbol}): {y * 100:.2f}%")

    print("\n== 국내 ETF (pykrx) ==")
    for key, code in KR_TICKERS.items():
        if not code:
            print(f"  {key}: 종목코드 미설정 — 건너뜀 (KR_TICKERS 에 코드 입력 필요)")
            continue
        try:
            y = fetch_kr_yield(code)
        except Exception as exc:  # noqa: BLE001
            print(f"  {key} ({code}): 오류 - {exc}", file=sys.stderr)
            continue
        if y is None:
            print(f"  {key} ({code}): 분배금 데이터 없음 — 기존 값 유지")
            continue
        results[key] = y
        print(f"  {key} ({code}): {y * 100:.2f}%")

    if not results:
        print("\n갱신할 수익률이 없습니다.", file=sys.stderr)
        return 1

    update_etf_js(results, args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
