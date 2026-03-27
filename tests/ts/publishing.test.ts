import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildPythonModuleCommand, resolveProjectPython } from "../../src/ts/publishing/python-command.js";
import { buildPublisherCommand, runPublishIntent } from "../../src/ts/publishing/python-runner.js";
import { buildXiaohongshuSessionCommand, runJsonCommandWithProgress } from "../../src/ts/publishing/xiaohongshu-session-runner.js";

test("buildPublisherCommand injects local PYTHONPATH", () => {
  const command = buildPublisherCommand();
  assert.equal(command.command.length > 0, true);
  assert.equal(command.args[0], "-m");
  assert.match(command.env.PYTHONPATH ?? "", /src\/python/);
});

test("resolveProjectPython prefers the local virtualenv interpreter", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "marketing-fox-python-"));
  const venvDir = path.join(cwd, ".venv", "bin");
  fs.mkdirSync(venvDir, { recursive: true });
  const pythonPath = path.join(venvDir, "python");
  fs.writeFileSync(pythonPath, "");

  assert.equal(resolveProjectPython(cwd, { ...process.env }), pythonPath);
});

test("buildPythonModuleCommand respects the explicit Python override", () => {
  const command = buildPythonModuleCommand("marketing_fox.publishing.runner", process.cwd(), {
    ...process.env,
    MARKETING_FOX_PUBLISH_PYTHON: "/tmp/custom-python"
  });

  assert.equal(command.command, "/tmp/custom-python");
  assert.deepEqual(command.args, ["-m", "marketing_fox.publishing.runner"]);
});

test("buildXiaohongshuSessionCommand targets the session runner module", () => {
  const command = buildXiaohongshuSessionCommand();

  assert.deepEqual(command.args, ["-m", "marketing_fox.publishing.xiaohongshu_session"]);
});

test("runPublishIntent returns Python runner output", () => {
  const result = runPublishIntent({
    platform: "x",
    source_idea: "Turn one idea into an X-ready hook",
    mode: "prepare"
  });

  assert.equal(result.status, "prepared");
  assert.equal(result.platform, "x");
  assert.equal(typeof result.draft_artifact.text, "string");
});

test("runJsonCommandWithProgress reports progress updates from a parent-owned file", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "marketing-fox-progress-"));
  const progressPath = path.join(tempDir, "progress.json");
  const seenPhases: string[] = [];
  const script = [
    "const fs = require('node:fs');",
    "let input = '';",
    "process.stdin.on('data', (chunk) => { input += chunk.toString(); });",
    "process.stdin.on('end', () => {",
    "  fs.writeFileSync(process.env.PROGRESS_FILE, JSON.stringify({ phase: 'awaiting_qr_scan', status_message: 'waiting' }));",
    "  setTimeout(() => {",
    "    fs.writeFileSync(process.env.PROGRESS_FILE, JSON.stringify({ phase: 'completed', status_message: 'done' }));",
    "    process.stdout.write(JSON.stringify({ status: 'ok' }) + '\\n');",
    "  }, 80);",
    "});"
  ].join("");

  const result = await runJsonCommandWithProgress<{ status: string }>(
    {
      command: process.execPath,
      args: ["-e", script],
      cwd: tempDir,
      env: {
        ...process.env,
        PROGRESS_FILE: progressPath
      }
    },
    { action: "login" },
    {
      progressFilePath: progressPath,
      progressPollIntervalMs: 20,
      onProgress: (progress) => {
        if (progress.phase) {
          seenPhases.push(progress.phase);
        }
      }
    }
  );

  assert.equal(result.status, "ok");
  assert.equal(seenPhases.length > 0, true);
  assert.equal(seenPhases.includes("completed"), true);
});
