"""Analytical, explicitly artificial fixtures for the exact empirical risk model."""
import unittest
from unittest.mock import patch

import cvxpy as cp
import numpy as np

from cvar_par import empirical_cvar, solve_equal_cvar_par


class CvarParTests(unittest.TestCase):
    def test_exact_fractional_tail_and_ties(self):
        losses = np.array([1, 2, 3, 4, 4], dtype=float)
        risk, q = empirical_cvar(losses, 0.5)  # 2.5 equally likely worst observations.
        self.assertAlmostEqual(risk, (4 + 4 + 0.5 * 3) / 2.5)
        self.assertAlmostEqual(q.sum(), 1)
        self.assertEqual(q[3], q[4])
        risk, q = empirical_cvar(np.ones(500) * 0.02, 0.95)
        self.assertAlmostEqual(risk, 0.02)
        np.testing.assert_allclose(q, np.ones(500) / 500)

    def test_known_equal_component_solution_is_not_equal_weight_substitution(self):
        returns = np.tile([[-0.01, -0.02]], (500, 1))
        result = solve_equal_cvar_par(returns, .95)
        self.assertEqual(result["status"], "available", result["reason"])
        np.testing.assert_allclose(result["weights"], [2/3, 1/3], atol=1e-4)
        np.testing.assert_allclose(result["componentShares"], [.5, .5], atol=1e-4)
        self.assertAlmostEqual(sum(result["weights"]), 1, places=10)
        self.assertTrue(all(0 <= weight <= 1 for weight in result["weights"]))
        self.assertAlmostEqual(sum(result["components"]), result["cvar"], places=7)

    def test_nonsmooth_joint_sample_has_certified_equal_components(self):
        returns = np.random.default_rng(902).normal(-.0002, .012, (500, 3))
        result = solve_equal_cvar_par(returns, .95)
        self.assertEqual(result["status"], "available", result["reason"])
        self.assertLessEqual(result["maxShareError"], 1e-4)
        actual, _ = empirical_cvar(-(returns @ np.array(result["weights"])), .95)
        self.assertAlmostEqual(result["cvar"], actual, places=12)

    def test_solution_is_deterministic_and_scale_invariant(self):
        returns = np.random.default_rng(39).normal(0, .02, (500, 2))
        a, b = solve_equal_cvar_par(returns, .95), solve_equal_cvar_par(returns, .95)
        self.assertEqual(a, b)
        scaled = solve_equal_cvar_par(returns * 3, .95)
        self.assertEqual(a["status"], "available")
        self.assertEqual(scaled["status"], "available")
        np.testing.assert_allclose(a["weights"], scaled["weights"], atol=1e-6)
        self.assertAlmostEqual(scaled["cvar"], 3 * a["cvar"], places=7)

    def test_unavailable_cases_never_get_another_benchmark(self):
        cases = [np.zeros((500, 2)), np.ones((500, 2)) * .01,
                 np.tile([[-.01, 0]], (500, 1)), np.full((500, 2), np.nan)]
        for returns in cases:
            with self.subTest(returns=returns[0].tolist()):
                result = solve_equal_cvar_par(returns, .95)
                self.assertEqual(result["status"], "unavailable")
                self.assertEqual(result["weights"], [])
                self.assertIsNone(result["cvar"])

    def test_solver_failure_is_unavailable_without_a_fallback(self):
        with patch("cvar_par.cp.Problem.solve", side_effect=cp.error.SolverError("artificial solver failure")):
            result = solve_equal_cvar_par(np.tile([[-.01, -.02]], (500, 1)), .95)
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["weights"], [])

    def test_solver_claim_cannot_bypass_independent_dual_and_component_checks(self):
        original = cp.Problem.solve
        def corrupt_dual(problem, *args, **kwargs):
            result = original(problem, *args, **kwargs)
            dual = problem.constraints[0].dual_variables[0]
            dual.value = np.zeros(dual.shape)
            return result
        def corrupt_weights(problem, *args, **kwargs):
            result = original(problem, *args, **kwargs)
            for variable in problem.variables():
                if variable.attributes["pos"]:
                    variable.value = np.ones(variable.shape)
            return result
        for method in (corrupt_dual, corrupt_weights):
            with self.subTest(method=method.__name__), patch.object(cp.Problem, "solve", new=method):
                result = solve_equal_cvar_par(np.tile([[-.01, -.02]], (500, 1)), .95)
                self.assertEqual(result["status"], "unavailable")
                self.assertEqual(result["weights"], [])

    def test_invalid_tail_inputs_and_single_holding(self):
        for losses, confidence in [(np.array([]), .95), (np.array([np.inf]), .95), (np.array([1]), 1)]:
            with self.assertRaises(ValueError):
                empirical_cvar(losses, confidence)
        result = solve_equal_cvar_par(np.ones((500, 1)) * -.01, .95)
        self.assertEqual(result["weights"], [1])
        self.assertEqual(result["componentShares"], [1])
