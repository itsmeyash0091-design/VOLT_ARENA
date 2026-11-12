"""Artificial fixtures only; never presented as observed market data."""
import unittest

import numpy as np

from panic_comparison import compare_exposures
from resilience import analyze_resilience
from test_stress_analysis import history, holdings


class ExposureComparisonTests(unittest.TestCase):
    def compare(self, losses=None, budget=10):
        if losses is None:
            losses = np.linspace(-50, 100, 500)
        return compare_exposures(losses, 1000, budget, .95, 1, "Insufficient data")

    def test_same_500_losses_and_cash_arithmetic(self):
        result = self.compare()
        hold, trim, cash = result["choices"]
        self.assertEqual(result["evaluatedScenarioCount"], 500)
        self.assertEqual(hold["worstLossInr"], 100)
        self.assertEqual(trim["worstLossInr"], 75)
        self.assertEqual(hold["bestGainInr"], 50)
        self.assertEqual(trim["bestGainInr"], 37.5)
        self.assertEqual(trim["cashValueInr"], 250)
        self.assertEqual(trim["marketValueInr"], 750)
        self.assertAlmostEqual(trim["tailLossInr"], hold["tailLossInr"] * .75, places=2)
        self.assertEqual(cash["withinLimitCount"], 500)
        self.assertEqual(cash["worstLossInr"], 0)
        self.assertEqual(cash["bestGainInr"], 0)
        self.assertEqual(cash["tailLossInr"], 0)
        self.assertEqual(cash["medianEndValueInr"], 1000)
        self.assertEqual(result, self.compare())

    def test_gain_only_signed_values_are_not_relabelled_as_losses(self):
        hold = self.compare(-np.ones(500) * 5)["choices"][0]
        self.assertEqual(hold["worstLossInr"], -5)
        self.assertEqual(hold["tailLossInr"], -5)
        self.assertEqual(hold["medianEndValueInr"], 1005)

    def test_missing_budget_does_not_invent_coverage(self):
        for choice in self.compare(budget=None)["choices"]:
            self.assertIsNone(choice["withinLimitCount"])
            self.assertIsNone(choice["coverageScorePct"])

    def test_invalid_counts_and_missing_data_have_no_choices(self):
        for losses, value in [(None, 100), (np.ones(499), 100),
                              (np.ones(501), 100), (np.full(500, np.nan), 100),
                              (np.ones(500), None), (np.ones(500), 0)]:
            result = compare_exposures(losses, value, 10, .95, 1, "Insufficient data")
            self.assertEqual(result["status"], "unavailable")
            self.assertEqual(result["choices"], [])
            self.assertEqual(result["evaluatedScenarioCount"], 0)

    def test_integration_hold_matches_original_game_and_cvar(self):
        frames = {"ALPHA.NS": history(400), "BETA.NS": history(400, multiplier=2)}
        a = analyze_resilience(holdings(), {"lossLimitInr": "3"}, lambda s: frames[s])
        b = analyze_resilience(holdings(), {"lossLimitInr": "999", "reflection": "pause"}, lambda s: frames[s])
        self.assertEqual(a["levels"], b["levels"])
        self.assertEqual(a["hiddenScenarioDigest"], b["hiddenScenarioDigest"])
        self.assertEqual(a["crashCard"], b["crashCard"])
        hold = a["simulatedChoices"]["choices"][0]
        self.assertEqual(hold["withinLimitCount"], a["panicGame"]["withinLimitCount"])
        self.assertEqual(hold["coverageScorePct"], a["panicGame"]["coverageScorePct"])
        self.assertEqual(hold["tailLossInr"], a["levels"]["currentCvarInr"])

    def test_short_history_remains_unavailable_even_for_cash(self):
        frames = {"ALPHA.NS": history(100), "BETA.NS": history(100)}
        result = analyze_resilience(holdings(), {"lossLimitInr": "3"}, lambda s: frames[s])
        self.assertEqual(result["simulatedChoices"]["status"], "unavailable")
        self.assertEqual(result["simulatedChoices"]["choices"], [])
        self.assertEqual(result["panicGame"]["status"], "unavailable")


if __name__ == "__main__":
    unittest.main()
