"""Submission checks use bundled provider observations; holdings are example quantities."""
import hashlib
import json
import unittest
from unittest.mock import patch

from demo_market import DIRECTORY, load_demo_history
from engine import inspect_portfolio
from resilience import analyze_resilience

DEMO = [{"ticker": ticker, "quantity": quantity, "exchange": "NSE", "instrumentType": "stock"}
        for ticker, quantity in [("RELIANCE", "5"), ("TCS", "3"), ("INFY", "10")]]


class SubmissionDemoTests(unittest.TestCase):
    def test_snapshot_files_match_manifest_and_unknown_symbol_is_not_invented(self):
        manifest = json.loads((DIRECTORY / "manifest.json").read_text())
        for symbol, entry in manifest["instruments"].items():
            self.assertEqual(hashlib.sha256((DIRECTORY / entry["file"]).read_bytes()).hexdigest(), entry["sha256"])
            frame = load_demo_history(symbol)
            self.assertEqual(len(frame), entry["sourceRowCount"])
            self.assertEqual(str(frame.index[0].date()), entry["firstDate"])
            self.assertEqual(str(frame.index[-1].date()), entry["lastDate"])
        self.assertIsNone(load_demo_history("UNKNOWN.NS"))

    def test_demo_inspection_and_scoring_work_without_yahoo_access(self):
        with patch("engine.yf.Ticker", side_effect=AssertionError("Demo must not call Yahoo")):
            inspection = inspect_portfolio(DEMO)
            scoring = analyze_resilience(DEMO, {"lossLimitInr": "5000"})
        self.assertEqual(inspection["valuation"]["status"], "complete")
        self.assertEqual(scoring["evaluatedScenarioCount"], 500)
        self.assertEqual(scoring["panicGame"]["status"], "revealed")
        self.assertEqual(scoring["simulatedChoices"]["status"], "available")
        self.assertIn("snapshot", scoring["notes"][0])
        self.assertLess(scoring["crashCard"]["wordCount"], 120)
