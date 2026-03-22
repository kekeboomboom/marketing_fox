import { spawnSync } from "node:child_process";

import type { PublishIntent, PublishResult } from "./types.js";
import { buildPythonModuleCommand } from "./python-command.js";

export function buildPublisherCommand(): { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv } {
  return buildPythonModuleCommand("marketing_fox.publishing.runner");
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
