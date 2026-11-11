import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type EngineIssue = {
  row: number;
  code: string;
  message: string;
};

type EngineEnvelope = {
  ok: boolean;
  data?: unknown;
  error?: string;
  issues?: EngineIssue[];
};

export class PythonInputError extends Error {
  readonly issues: EngineIssue[];

  constructor(message: string, issues: EngineIssue[]) {
    super(message);
    this.name = "PythonInputError";
    this.issues = issues;
  }
}

const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const ENGINE_TIMEOUT_MS = 240_000;

async function findEnginePath(): Promise<string> {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), "artifacts/api-server/python/engine.py"),
    path.resolve(process.cwd(), "python/engine.py"),
    path.resolve(moduleDirectory, "../../python/engine.py"),
    path.resolve(moduleDirectory, "../python/engine.py"),
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.R_OK);
      return candidate;
    } catch {
      // Try the next location used by source and bundled workflow execution.
    }
  }
  throw new Error("Python engine file is unavailable.");
}

export async function runPythonEngine(
  operation: string,
  payload: Record<string, unknown> = {},
): Promise<unknown> {
  const scriptPath = await findEnginePath();
  const pythonCommand = process.env["PYTHON_BIN"] || "python3";

  return await new Promise((resolve, reject) => {
    const child = spawn(pythonCommand, [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(new Error("Python data engine timed out.")));
    }, ENGINE_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (Buffer.byteLength(stdout, "utf8") > MAX_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        finish(() => reject(new Error("Python data engine response exceeded the size limit.")));
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 8_000) stderr += chunk.toString("utf8");
    });

    child.once("error", () => {
      finish(() => reject(new Error("Python data engine could not be started.")));
    });

    child.once("close", (code) => {
      if (settled) return;
      let envelope: EngineEnvelope;
      try {
        envelope = JSON.parse(stdout) as EngineEnvelope;
      } catch {
        const diagnostic = stderr.trim() ? " Check the server's Python runtime." : "";
        finish(() =>
          reject(new Error(`Python data engine returned an invalid response.${diagnostic}`)),
        );
        return;
      }

      if (code === 2 && envelope.ok === false) {
        finish(() =>
          reject(
            new PythonInputError(
              envelope.error || "Portfolio input is invalid.",
              envelope.issues || [],
            ),
          ),
        );
        return;
      }

      if (code !== 0 || envelope.ok !== true || envelope.data === undefined) {
        finish(() => reject(new Error("Python data engine failed to complete the request.")));
        return;
      }

      finish(() => resolve(envelope.data));
    });

    child.stdin.end(JSON.stringify({ operation, ...payload }));
  });
}
