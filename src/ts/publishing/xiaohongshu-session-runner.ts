import { spawnSync } from "node:child_process";

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
