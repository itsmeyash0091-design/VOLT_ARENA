"""Same-origin release smoke checks. Run against a started submission server."""
import json
from pathlib import Path
import sys
import urllib.error
import urllib.request

base = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
holdings = [{"ticker": t, "quantity": q, "exchange": "NSE", "instrumentType": "stock"}
            for t, q in [("RELIANCE", "5"), ("TCS", "3"), ("INFY", "10")]]

def request(path, body=None):
    encoded = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=encoded, headers={"Content-Type": "application/json"} if encoded else {})
    with urllib.request.urlopen(req, timeout=180) as response:
        data = response.read()
        return json.loads(data) if "json" in response.headers.get("Content-Type", "") else data.decode()

assert 'id="root"' in request("/")
assert request("/api/healthz")["status"] == "ok"
assert request("/api/portfolio/validate", {"holdings": holdings})["valid"]
assert request("/api/portfolio/csv-preview", {"csvText": "ticker,quantity\nTCS,3"})["rowCount"] == 1
inspection = request("/api/portfolio/inspect", {"holdings": holdings})
assert inspection["valuation"]["status"] == "complete"
risk = request("/api/portfolio/risk-analysis", {"holdings": holdings})
windows = risk["replayWindows"]
assert len(windows) == 4
assert any(w["status"] == "complete" and len(w["path"]) > 2 for w in windows)
stress = request("/api/portfolio/stress-analysis", {"holdings": holdings, "scenarioId": "broad-selloff", "targetLossPct": "20"})
assert len(stress["monteCarlo"]["paths"]) == 1000
assert stress["scenario"]["status"] == "available"
assert stress["reverseStress"]["status"] == "available"
game = request("/api/portfolio/resilience", {"holdings": holdings, "lossLimitInr": "5000", "reflection": "pause"})
assert game["evaluatedScenarioCount"] == 500
assert game["panicGame"]["status"] == "revealed"
assert len(game["simulatedChoices"]["choices"]) == 3
assert game["crashCard"]["wordCount"] < 120
try:
    request("/api/portfolio/validate", {"holdings": []})
except urllib.error.HTTPError as error:
    assert error.code == 400
else:
    raise AssertionError("Empty holdings were not rejected")
print(json.dumps({
    "result": "PASS", "origin": base, "valuationDate": inspection["valuation"]["asOfDate"],
    "replays": [{"id": w["id"], "status": w["status"], "recovery": w["recoveryStatus"]} for w in windows],
    "riskContribution": risk["riskContribution"]["status"],
    "monteCarloPaths": len(stress["monteCarlo"]["paths"]), "hiddenScenarios": game["evaluatedScenarioCount"],
    "levels": game["levels"]["status"], "coverage": game["coverageStatus"],
    "note": "Unavailable historical windows and incomplete source coverage are disclosed outcomes, not fabricated successes.",
}, indent=2))
