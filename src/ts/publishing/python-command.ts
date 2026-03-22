import fs from "node:fs";
import path from "node:path";

export function resolveProjectPython(
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  if (env.MARKETING_FOX_PUBLISH_PYTHON) {
    return env.MARKETING_FOX_PUBLISH_PYTHON;
  }

  const candidates =
    platform === "win32"
      ? [
          path.join(cwd, ".venv", "Scripts", "python.exe"),
          path.join(cwd, ".venv", "Scripts", "python")
        ]
      : [path.join(cwd, ".venv", "bin", "python")];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return "python3";
}

export function buildPythonModuleCommand(
  moduleName: string,
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env
): { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv } {
  const pythonPath = path.join(cwd, "src", "python");
  return {
    command: resolveProjectPython(cwd, env),
    args: ["-m", moduleName],
    cwd,
    env: {
      ...env,
      PYTHONPATH: env.PYTHONPATH ? `${pythonPath}${path.delimiter}${env.PYTHONPATH}` : pythonPath
    }
  };
}
