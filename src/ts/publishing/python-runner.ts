import { spawnSync } from "node:child_process";
import path from "node:path";

import type { PublishIntent, PublishResult } from "./types.js";

export function buildPublisherCommand(): { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv } {
  const cwd = process.cwd();
  const pythonPath = path.join(cwd, "src", "python");
  return {
    command: process.env.MARKETING_FOX_PUBLISH_PYTHON ?? "python3",
    args: ["-m", "marketing_fox.publishing.runner"],
    cwd,
    env: {
      ...process.env,
      PYTHONPATH: process.env.PYTHONPATH ? `${pythonPath}:${process.env.PYTHONPATH}` : pythonPath
    }
  };
}

export function runPublishIntent(intent: PublishIntent): PublishResult {
  const command = buildPublisherCommand();
  const result = spawnSync(command.command, command.args, {
    cwd: command.cwd,
    env: command.env,
    input: JSON.stringify(intent),
    encoding: "utf8"
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(result.stderr || "Python publishing runner exited with a non-zero status.");
  }

  return JSON.parse(result.stdout) as PublishResult;
}
