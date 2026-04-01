import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";

import { createLogger, summarizeError } from "../logging/logger.js";
import { buildPythonModuleCommand } from "./python-command.js";

const logger = createLogger("xhs-session-runner");

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
  artifact_dir?: string | null;
  progress_file?: string | null;
  artifacts?: Array<{
    type: string;
    role?: string | null;
    path: string;
    created_at?: string | null;
    capture?: string | null;
    selector?: string | null;
  }>;
  logs: string[];
  error?: XiaohongshuSessionError | null;
}

export interface XiaohongshuSessionProgress {
  schema_version?: number;
  state?: string;
  phase?: string;
  status?: string | null;
  status_message?: string | null;
  logged_in?: boolean;
  profile_dir?: string;
  platform_url?: string | null;
  artifact_dir?: string;
  progress_file?: string;
  updated_at?: string;
  artifacts?: Array<{
    type?: string;
    path?: string;
    role?: string | null;
    created_at?: string | null;
  }>;
  live_artifacts?: Array<{
    type?: string;
    path?: string;
    role?: string | null;
    created_at?: string | null;
  }>;
  logs_tail?: string[];
  error?: XiaohongshuSessionError | null;
}

export interface XiaohongshuSessionRunOptions {
  progressFilePath?: string;
  progressPollIntervalMs?: number;
  onProgress?: (progress: XiaohongshuSessionProgress) => void;
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
  const startedAt = Date.now();
  logger.info("xhs_session_spawn_sync", {
    action,
    cwd: command.cwd,
    executable: command.command,
    args: command.args,
    options_keys: Object.keys(options).sort()
  });
  const result = spawnSync(command.command, command.args, {
    cwd: command.cwd,
    env: command.env,
    input: JSON.stringify({ action, options }),
    encoding: "utf8"
  });

  if (result.error) {
    logger.error("xhs_session_spawn_sync_error", {
      action,
      duration_ms: Date.now() - startedAt,
      ...summarizeError(result.error)
    });
    throw result.error;
  }

  if (result.status !== 0) {
    logger.error("xhs_session_nonzero_exit_sync", {
      action,
      exit_code: result.status,
      duration_ms: Date.now() - startedAt,
      stderr_preview: summarizeText(result.stderr)
    });
    throw new Error(result.stderr || "Xiaohongshu session runner exited with a non-zero status.");
  }

  logger.info("xhs_session_completed_sync", {
    action,
    duration_ms: Date.now() - startedAt,
    stdout_bytes: result.stdout.length
  });
  return JSON.parse(result.stdout) as XiaohongshuSessionResult;
}

export async function runXiaohongshuSessionActionAsync(
  action: XiaohongshuSessionResult["action"],
  options: Record<string, unknown> = {},
  runOptions: XiaohongshuSessionRunOptions = {}
): Promise<XiaohongshuSessionResult> {
  const command = buildXiaohongshuSessionCommand();
  return runJsonCommandWithProgress<XiaohongshuSessionResult>(command, { action, options }, runOptions);
}

export async function runJsonCommandWithProgress<T>(
  command: { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv },
  payload: unknown,
  runOptions: XiaohongshuSessionRunOptions = {}
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const startedAt = Date.now();
    logger.info("xhs_session_spawn", {
      action: summarizeAction(payload),
      cwd: command.cwd,
      executable: command.command,
      args: command.args,
      options_keys: summarizeOptionsKeys(payload)
    });
    const child = spawn(command.command, command.args, {
      cwd: command.cwd,
      env: command.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let lastProgressRaw = "";
    const progressFilePath = runOptions.progressFilePath;
    const pollIntervalMs = Math.max(200, runOptions.progressPollIntervalMs ?? 1000);
    const pollTimer = progressFilePath
      ? setInterval(() => {
          readProgressFromFile(progressFilePath, runOptions.onProgress, (value) => {
            lastProgressRaw = value;
          }, () => lastProgressRaw);
        }, pollIntervalMs)
      : null;

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (pollTimer) {
        clearInterval(pollTimer);
      }
      logger.error("xhs_session_spawn_error", {
        action: summarizeAction(payload),
        duration_ms: Date.now() - startedAt,
        ...summarizeError(error)
      });
      reject(error);
    });
    child.on("close", (code) => {
      if (pollTimer) {
        clearInterval(pollTimer);
      }
      if (progressFilePath) {
        readProgressFromFile(progressFilePath, runOptions.onProgress, (value) => {
          lastProgressRaw = value;
        }, () => lastProgressRaw);
      }
      if (code !== 0) {
        logger.error("xhs_session_nonzero_exit", {
          action: summarizeAction(payload),
          duration_ms: Date.now() - startedAt,
          exit_code: code,
          stderr_preview: summarizeText(stderr)
        });
        reject(new Error(stderr || "Xiaohongshu session runner exited with a non-zero status."));
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as T;
        logger.info("xhs_session_completed", {
          action: summarizeAction(payload),
          duration_ms: Date.now() - startedAt,
          stdout_bytes: stdout.length,
          stderr_bytes: stderr.length
        });
        resolve(parsed);
      } catch (error) {
        logger.error("xhs_session_parse_failed", {
          action: summarizeAction(payload),
          duration_ms: Date.now() - startedAt,
          stdout_preview: summarizeText(stdout),
          stderr_preview: summarizeText(stderr),
          ...summarizeError(error)
        });
        reject(error);
      }
    });

    child.stdin.end(JSON.stringify(payload));
  });
}

function readProgressFromFile(
  progressFilePath: string,
  onProgress: XiaohongshuSessionRunOptions["onProgress"],
  setLastRaw: (value: string) => void,
  getLastRaw: () => string
): void {
  if (!onProgress || !fs.existsSync(progressFilePath)) {
    return;
  }

  try {
    const raw = fs.readFileSync(progressFilePath, "utf8").trim();
    if (!raw || raw === getLastRaw()) {
      return;
    }

    const parsed = JSON.parse(raw) as XiaohongshuSessionProgress;
    setLastRaw(raw);
    onProgress(parsed);
  } catch {
    // Ignore transient read/parse failures while the writer swaps temp files.
  }
}

function summarizeAction(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  return typeof (payload as Record<string, unknown>).action === "string"
    ? ((payload as Record<string, unknown>).action as string)
    : undefined;
}

function summarizeOptionsKeys(payload: unknown): string[] | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const options = (payload as Record<string, unknown>).options;
  if (!options || typeof options !== "object") {
    return undefined;
  }

  return Object.keys(options as Record<string, unknown>).sort();
}

function summarizeText(value: string | null | undefined, maxLength = 240): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }

  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`;
}
