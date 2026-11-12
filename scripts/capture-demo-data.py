"""Explicitly capture public Yahoo observations for the small, dated college demo."""
import gzip
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "artifacts/api-server/python"))
import yfinance as yf

DEST = ROOT / "artifacts/api-server/python/data/demo-market"

def main():
    DEST.mkdir(parents=True, exist_ok=True)
    manifest = {
        "source": "Yahoo Finance via yfinance; bundled historical demo snapshot, not live",
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "independentlyVerified": False,
        "limitations": "Prototype source; no independent full-series or exchange-calendar verification. No missing prices filled. Adjustments are provider supplied. Educational demonstration only.",
        "instruments": {},
    }
    for symbol in ("RELIANCE.NS", "TCS.NS", "INFY.NS"):
        frame = yf.Ticker(symbol).history(period="max", interval="1d", auto_adjust=False,
                                          actions=True, repair=False, keepna=True, timeout=30)
        if frame.empty or len(frame) < 252:
            raise RuntimeError(f"No adequate observed history returned for {symbol}; snapshot not invented.")
        fields = [c for c in ("Close", "Adj Close", "Stock Splits", "Dividends") if c in frame]
        if "Close" not in fields or "Adj Close" not in fields:
            raise RuntimeError(f"Required source fields missing for {symbol}")
        records = []
        for date, row in frame.iterrows():
            record = {"date": date.date().isoformat()}
            for field in fields:
                number = float(row[field])
                record[field] = number if math.isfinite(number) else None
            records.append(record)
        content = gzip.compress(json.dumps(records, separators=(",", ":"), allow_nan=False).encode(), mtime=0)
        filename = symbol + ".json.gz"
        (DEST / filename).write_bytes(content)
        manifest["instruments"][symbol] = {
            "file": filename, "sha256": hashlib.sha256(content).hexdigest(),
            "firstDate": records[0]["date"], "lastDate": records[-1]["date"],
            "sourceRowCount": len(records), "fields": fields,
        }
        print(symbol, len(records), records[0]["date"], records[-1]["date"], len(content), "bytes")
    (DEST / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")

if __name__ == "__main__":
    main()
