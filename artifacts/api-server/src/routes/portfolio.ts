import { Router, type IRouter } from "express";
import {
  GetMarketDataUniverseResponse,
  InspectPortfolioMarketDataBody,
  InspectPortfolioMarketDataResponse,
  AnalyzePortfolioRiskBody,
  AnalyzePortfolioRiskResponse,
  GetStaticScenariosResponse,
  RunPortfolioStressBody,
  RunPortfolioStressResponse,
  PortfolioInputError,
  PreviewPortfolioCsvBody,
  PreviewPortfolioCsvResponse,
  ValidatePortfolioInputBody,
  ValidatePortfolioInputResponse,
} from "@workspace/api-zod";
import { PythonInputError, runPythonEngine } from "../lib/python-engine";

const router: IRouter = Router();

function requestBodyError(message: string): PortfolioInputError {
  return { error: message };
}

router.get("/market-data/universe", async (req, res): Promise<void> => {
  try {
    const data = GetMarketDataUniverseResponse.parse(
      await runPythonEngine("get_market_data_universe"),
    );
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Unable to load market-data universe");
    res.status(502).json({ error: "The Python data engine is unavailable." });
  }
});

router.post("/portfolio/csv-preview", async (req, res): Promise<void> => {
  const parsed = PreviewPortfolioCsvBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(requestBodyError("Provide a valid CSV preview request."));
    return;
  }

  try {
    const data = PreviewPortfolioCsvResponse.parse(
      await runPythonEngine("preview_portfolio_csv", parsed.data),
    );
    res.json(data);
  } catch (err) {
    if (err instanceof PythonInputError) {
      const response: PortfolioInputError = {
        error: err.message,
        issues: err.issues,
      };
      res.status(400).json(response);
      return;
    }
    req.log.error({ err }, "Unable to preview portfolio CSV");
    res.status(502).json({ error: "CSV preview could not be completed by the Python engine." });
  }
});

router.post("/portfolio/validate", async (req, res): Promise<void> => {
  const parsed = ValidatePortfolioInputBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(requestBodyError("Provide valid portfolio rows."));
    return;
  }

  try {
    const data = ValidatePortfolioInputResponse.parse(
      await runPythonEngine("validate_portfolio", parsed.data),
    );
    res.json(data);
  } catch (err) {
    if (err instanceof PythonInputError) {
      const response: PortfolioInputError = {
        error: err.message,
        issues: err.issues,
      };
      res.status(400).json(response);
      return;
    }
    req.log.error({ err }, "Unable to validate portfolio input");
    res.status(502).json({ error: "Portfolio validation could not be completed by the Python engine." });
  }
});

router.post("/portfolio/inspect", async (req, res): Promise<void> => {
  const parsed = InspectPortfolioMarketDataBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(requestBodyError("Provide valid portfolio rows."));
    return;
  }

  try {
    const data = await runPythonEngine("inspect_portfolio", parsed.data);
    // Validate without replacing Python's YYYY-MM-DD strings with coerced JS Dates.
    InspectPortfolioMarketDataResponse.parse(data);
    res.json(data);
  } catch (err) {
    if (err instanceof PythonInputError) {
      const response: PortfolioInputError = {
        error: err.message,
        issues: err.issues,
      };
      res.status(400).json(response);
      return;
    }
    req.log.error({ err }, "Unable to inspect portfolio market data");
    res.status(502).json({ error: "Market history could not be inspected by the Python engine." });
  }
});

router.post("/portfolio/risk-analysis", async (req, res): Promise<void> => {
  const parsed = AnalyzePortfolioRiskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(requestBodyError("Provide valid portfolio rows."));
    return;
  }

  try {
    const data = await runPythonEngine("analyze_portfolio_risk", parsed.data);
    // Keep Python's date-only strings intact while validating the response.
    AnalyzePortfolioRiskResponse.parse(data);
    res.json(data);
  } catch (err) {
    if (err instanceof PythonInputError) {
      const response: PortfolioInputError = {
        error: err.message,
        issues: err.issues,
      };
      res.status(400).json(response);
      return;
    }
    req.log.error({ err }, "Unable to calculate portfolio replay and risk contribution");
    res.status(502).json({ error: "Portfolio risk analysis could not be completed by the Python engine." });
  }
});

router.get("/scenarios", async (req, res): Promise<void> => {
  try {
    const data = await runPythonEngine("get_static_scenarios");
    GetStaticScenariosResponse.parse(data);
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Unable to load static scenario library");
    res.status(502).json({ error: "The Python scenario library is unavailable." });
  }
});

router.post("/portfolio/stress-analysis", async (req, res): Promise<void> => {
  const parsed = RunPortfolioStressBody.extend({
    overrides: RunPortfolioStressBody.shape.overrides.unwrap().strict().optional(),
  }).strict().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(requestBodyError("Provide valid holdings, a static scenario, and numeric input strings."));
    return;
  }
  try {
    const data = await runPythonEngine("run_portfolio_stress", parsed.data);
    RunPortfolioStressResponse.parse(data);
    res.json(data);
  } catch (err) {
    if (err instanceof PythonInputError) {
      res.status(400).json({ error: err.message, issues: err.issues });
      return;
    }
    req.log.error({ err }, "Unable to calculate portfolio stress and simulations");
    res.status(502).json({ error: "Stress analysis could not be completed by the Python engine." });
  }
});

export default router;
