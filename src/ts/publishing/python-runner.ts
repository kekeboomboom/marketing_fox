import { spawn, spawnSync } from "node:child_process";

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

export async function runPublishIntentAsync(intent: PublishIntent): Promise<PublishResult> {
  const command = buildPublisherCommand();
  return runJsonCommand<PublishResult>(command, intent);
}

async function runJsonCommand<T>(
  command: { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv },
  payload: unknown
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const child = spawn(command.command, command.args, {
      cwd: command.cwd,
      env: command.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || "Python publishing runner exited with a non-zero status."));
        return;
      }

      try {
        resolve(JSON.parse(stdout) as T);
      } catch (error) {
        reject(error);
      }
    });

    child.stdin.end(JSON.stringify(payload));
  });
}
