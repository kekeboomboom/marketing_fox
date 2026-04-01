import { spawn, spawnSync } from "node:child_process";

import { createLogger, summarizeError } from "../logging/logger.js";
import type { PublishIntent, PublishResult } from "./types.js";
import { buildPythonModuleCommand } from "./python-command.js";

const logger = createLogger("python-publish-runner");

export function buildPublisherCommand(): { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv } {
  return buildPythonModuleCommand("marketing_fox.publishing.runner");
}

export function runPublishIntent(intent: PublishIntent): PublishResult {
  const command = buildPublisherCommand();
  const startedAt = Date.now();
  logger.info("python_publish_spawn_sync", {
    platform: intent.platform,
    mode: intent.mode,
    cwd: command.cwd,
    executable: command.command,
    args: command.args
  });
  const result = spawnSync(command.command, command.args, {
    cwd: command.cwd,
    env: command.env,
    input: JSON.stringify(intent),
    encoding: "utf8"
  });

  if (result.error) {
    logger.error("python_publish_spawn_sync_error", {
      platform: intent.platform,
      mode: intent.mode,
      duration_ms: Date.now() - startedAt,
      ...summarizeError(result.error)
    });
    throw result.error;
  }

  if (result.status !== 0) {
    logger.error("python_publish_nonzero_exit_sync", {
      platform: intent.platform,
      mode: intent.mode,
      duration_ms: Date.now() - startedAt,
      exit_code: result.status,
      stderr_preview: summarizeText(result.stderr)
    });
    throw new Error(result.stderr || "Python publishing runner exited with a non-zero status.");
  }

  logger.info("python_publish_completed_sync", {
    platform: intent.platform,
    mode: intent.mode,
    duration_ms: Date.now() - startedAt,
    stdout_bytes: result.stdout.length
  });
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
    const startedAt = Date.now();
    const payloadSummary = summarizePayload(payload);
    logger.info("python_publish_spawn", {
      cwd: command.cwd,
      executable: command.command,
      args: command.args,
      ...payloadSummary
    });
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
      logger.error("python_publish_spawn_error", {
        duration_ms: Date.now() - startedAt,
        ...payloadSummary,
        ...summarizeError(error)
      });
      reject(error);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        logger.error("python_publish_nonzero_exit", {
          duration_ms: Date.now() - startedAt,
          exit_code: code,
          stderr_preview: summarizeText(stderr),
          ...payloadSummary
        });
        reject(new Error(stderr || "Python publishing runner exited with a non-zero status."));
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as T;
        logger.info("python_publish_completed", {
          duration_ms: Date.now() - startedAt,
          stdout_bytes: stdout.length,
          stderr_bytes: stderr.length,
          ...payloadSummary
        });
        resolve(parsed);
      } catch (error) {
        logger.error("python_publish_parse_failed", {
          duration_ms: Date.now() - startedAt,
          stdout_preview: summarizeText(stdout),
          stderr_preview: summarizeText(stderr),
          ...payloadSummary,
          ...summarizeError(error)
        });
        reject(error);
      }
    });

    child.stdin.end(JSON.stringify(payload));
  });
}

function summarizePayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  const record = payload as Record<string, unknown>;
  const options = record.options;
  return {
    platform: record.platform,
    mode: record.mode,
    action: record.action,
    source_idea_length: typeof record.source_idea === "string" ? record.source_idea.length : undefined,
    assets_count: Array.isArray(record.assets) ? record.assets.length : undefined,
    options_keys: options && typeof options === "object" ? Object.keys(options as Record<string, unknown>).sort() : undefined
  };
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
