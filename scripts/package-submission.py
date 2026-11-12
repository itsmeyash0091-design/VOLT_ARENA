"""Create a curated source+prebuilt release, never a dump of this workspace."""
import json
from pathlib import Path
import re
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "generated-artifacts"
STAGE = OUT / "VoltArena-MVP"

def ignore(_folder, names):
    return {name for name in names if name in {"node_modules", "__pycache__", ".cache", ".git", ".DS_Store", ".replit-artifact"}
            or name.endswith((".pyc", ".tsbuildinfo", ".map"))}

def main():
    if STAGE.exists():
        shutil.rmtree(STAGE)
    STAGE.mkdir(parents=True)
    for name in ["README.md", "SUBMISSION.md", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml",
                 ".npmrc", "tsconfig.json", "tsconfig.base.json", "pyproject.toml", "uv.lock", "requirements.txt"]:
        shutil.copy2(ROOT / name, STAGE / name)
    for folder in ["artifacts/voltarena", "artifacts/api-server", "lib", "docs"]:
        shutil.copytree(ROOT / folder, STAGE / folder, ignore=ignore)
    for name in ["start-submission.mjs", "build-submission.mjs", "capture-demo-data.py", "smoke-submission.py", "check-package-manager.mjs"]:
        (STAGE / "scripts").mkdir(exist_ok=True)
        shutil.copy2(ROOT / "scripts" / name, STAGE / "scripts" / name)
    # The scaffold excludes non-Linux native binaries. Restore platform support
    # in the portable submission; retain security overrides and release-age policy.
    workspace = (STAGE / "pnpm-workspace.yaml").read_text()
    workspace = "\n".join(line for line in workspace.splitlines()
                          if not re.match(r'\s*["\'](?:esbuild>|lightningcss>|@tailwindcss/oxide>|rollup>).*:\s*["\']-["\']', line)
                          and "replit uses linux-x64 only" not in line) + "\n"
    (STAGE / "pnpm-workspace.yaml").write_text(workspace)
    # No Agent/canvas history, uploads, personal memory, credentials or source caches.
    shutil.copy2(ROOT / "artifacts/voltarena/src/assets/demo-portfolio.csv", STAGE / "demo-portfolio.csv")
    (STAGE / "START_HERE.txt").write_text("Read SUBMISSION.md first.\nInstall dependencies once, then run: node scripts/start-submission.mjs\nUpload demo-portfolio.csv on Portfolio, or use Sample Portfolios.\n")
    # Regenerate ONLY this release copy's lock after restoring platform binaries.
    subprocess.run(["pnpm", "install", "--lockfile-only", "--ignore-scripts"], cwd=STAGE, check=True)
    for path in STAGE.rglob("*"):
        if path.is_file() and (path.name.startswith(".env") or path.suffix in {".pem", ".key"}):
            raise RuntimeError(f"Refusing to package secret-like file: {path.relative_to(STAGE)}")
    # The locked release is installed and smoke-tested before final delivery.
    print("Staged release:", STAGE)

def archive():
    target = OUT / "VoltArena-MVP-submission.zip"
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
        for file in sorted(STAGE.rglob("*")):
            if not file.is_file() or any(part in {"node_modules", "__pycache__"} for part in file.relative_to(STAGE).parts):
                continue
            bundle.write(file, Path("VoltArena-MVP") / file.relative_to(STAGE))
    with zipfile.ZipFile(target) as bundle:
        if bundle.testzip() is not None:
            raise RuntimeError("ZIP failed its integrity test")
    print(target, target.stat().st_size, "bytes")

if __name__ == "__main__":
    import sys
    archive() if "--archive" in sys.argv else main()
