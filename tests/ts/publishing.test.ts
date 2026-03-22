import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildPythonModuleCommand, resolveProjectPython } from "../../src/ts/publishing/python-command.js";
import { buildPublisherCommand, runPublishIntent } from "../../src/ts/publishing/python-runner.js";
import { buildXiaohongshuSessionCommand } from "../../src/ts/publishing/xiaohongshu-session-runner.js";

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

  assert.equal(resolveProjectPython(cwd, {}), pythonPath);
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
