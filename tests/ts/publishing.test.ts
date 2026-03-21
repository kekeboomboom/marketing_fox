import test from "node:test";
import assert from "node:assert/strict";

import { buildPublisherCommand, runPublishIntent } from "../../src/ts/publishing/python-runner.js";

test("buildPublisherCommand injects local PYTHONPATH", () => {
  const command = buildPublisherCommand();
  assert.equal(command.command.length > 0, true);
  assert.equal(command.args[0], "-m");
  assert.match(command.env.PYTHONPATH ?? "", /src\/python/);
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
