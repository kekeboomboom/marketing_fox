import { spawn, spawnSync } from "node:child_process";

import { buildPythonModuleCommand } from "./python-command.js";

export interface XiaohongshuSessionError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface XiaohongshuSessionResult {
  action: "check" | "login";
  status: "logged_in" | "login_required" | "failed";
  logged_in: boolean;
  profile_dir: string;
  platform_url?: string | null;
  screenshots: string[];
  logs: string[];
  error?: XiaohongshuSessionError | null;
}

export function buildXiaohongshuSessionCommand(): {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
} {
  return buildPythonModuleCommand("marketing_fox.publishing.xiaohongshu_session");
}

export function runXiaohongshuSessionAction(
  action: XiaohongshuSessionResult["action"],
  options: Record<string, unknown> = {}
): XiaohongshuSessionResult {
  const command = buildXiaohongshuSessionCommand();
  const result = spawnSync(command.command, command.args, {
    cwd: command.cwd,
    env: command.env,
    input: JSON.stringify({ action, options }),
    encoding: "utf8"
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(result.stderr || "Xiaohongshu session runner exited with a non-zero status.");
  }

  return JSON.parse(result.stdout) as XiaohongshuSessionResult;
}

export async function runXiaohongshuSessionActionAsync(
  action: XiaohongshuSessionResult["action"],
  options: Record<string, unknown> = {}
): Promise<XiaohongshuSessionResult> {
  const command = buildXiaohongshuSessionCommand();
  return runJsonCommand<XiaohongshuSessionResult>(command, { action, options });
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
        reject(new Error(stderr || "Xiaohongshu session runner exited with a non-zero status."));
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
