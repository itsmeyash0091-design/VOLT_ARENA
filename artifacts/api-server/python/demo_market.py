"""Integrity-checked public price snapshots; no personal portfolios or modeled prices."""
import gzip
import hashlib
import json
from pathlib import Path

import pandas as pd

DIRECTORY = Path(__file__).parent / "data/demo-market"

def snapshot_note() -> str:
    path = DIRECTORY / "manifest.json"
    if not path.exists():
        return "No bundled demo snapshots installed; live source access is required."
    manifest = json.loads(path.read_text())
    ranges = "; ".join(f"{s}: {e['firstDate']} to {e['lastDate']}" for s, e in manifest["instruments"].items())
    return f"Bundled historical demo snapshots (not live), captured {manifest['capturedAt']}. {ranges}. {manifest['limitations']} Other instruments require live Yahoo access."


def load_demo_history(symbol: str) -> pd.DataFrame | None:
    manifest_path = DIRECTORY / "manifest.json"
    if not manifest_path.exists():
        return None
    manifest = json.loads(manifest_path.read_text())
    entry = manifest["instruments"].get(symbol)
    if entry is None:
        return None
    filename = entry["file"]
    if Path(filename).name != filename:
        raise ValueError("Invalid demo snapshot filename.")
    compressed = (DIRECTORY / filename).read_bytes()
    if hashlib.sha256(compressed).hexdigest() != entry["sha256"]:
        raise ValueError(f"Demo snapshot integrity check failed for {symbol}. No prices substituted.")
    records = json.loads(gzip.decompress(compressed))
    if len(records) != entry["sourceRowCount"]:
        raise ValueError(f"Demo snapshot row count mismatch for {symbol}.")
    frame = pd.DataFrame.from_records(records).set_index("date")
    frame.index = pd.to_datetime(frame.index)
    return frame
