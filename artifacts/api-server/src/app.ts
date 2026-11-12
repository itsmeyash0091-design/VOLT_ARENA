import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { existsSync } from "node:fs";
import path from "node:path";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "512kb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// The submission runs UI and API on one origin, without Replit's routing proxy.
const webDirectory = [
  path.resolve(process.cwd(), "artifacts/voltarena/dist/public"),
  path.resolve(process.cwd(), "../voltarena/dist/public"),
].find((directory) => existsSync(path.join(directory, "index.html")));
if (webDirectory) {
  app.use(express.static(webDirectory));
  app.get("/{*page}", (req, res, next) => {
    if (req.path.startsWith("/api")) { next(); return; }
    res.sendFile(path.join(webDirectory, "index.html"));
  });
}
app.use("/api", (_req, res) => { res.status(404).json({ error: "API route not found." }); });

export default app;
