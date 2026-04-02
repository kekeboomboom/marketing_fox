import assert from "node:assert/strict";
import test from "node:test";

import { createLogger, writeJsonLine } from "../../src/ts/logging/logger.js";

function captureStream(stream: NodeJS.WriteStream): {
  output: string[];
  restore: () => void;
} {
  const originalWrite = stream.write.bind(stream);
  const output: string[] = [];

  stream.write = ((chunk: unknown, encoding?: BufferEncoding | ((error: Error | null | undefined) => void), callback?: (error: Error | null | undefined) => void) => {
    output.push(typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString(typeof encoding === "string" ? encoding : undefined));
    if (typeof encoding === "function") {
      encoding(null);
    } else if (callback) {
      callback(null);
    }
    return true;
  }) as typeof stream.write;

  return {
    output,
    restore: () => {
      stream.write = originalWrite;
    }
  };
}

test("createLogger writes newline-delimited JSON to stderr", () => {
  const capture = captureStream(process.stderr);
  const logger = createLogger("test-component");

  try {
    logger.info("server_listening", {
      service: "marketing_fox",
      host: "0.0.0.0",
      port: 3001,
      nested: {
        data_dir: "/data/marketing_fox/service-data"
      }
    });
  } finally {
    capture.restore();
  }

  assert.equal(capture.output.length, 1);
  assert.equal(capture.output[0]?.endsWith("\n"), true);

  const rawLine = capture.output[0]?.trimEnd() ?? "";
  assert.equal(rawLine.includes("\n"), false);

  const parsed = JSON.parse(rawLine) as Record<string, unknown>;
  assert.equal(parsed.level, "info");
  assert.equal(parsed.component, "test-component");
  assert.equal(parsed.event, "server_listening");
  assert.deepEqual(parsed.nested, {
    data_dir: "/data/marketing_fox/service-data"
  });
});

test("writeJsonLine writes one JSON record to stdout", () => {
  const capture = captureStream(process.stdout);

  try {
    writeJsonLine({
      event: "publish_command_result",
      status: "published",
      detail: {
        platform: "xiaohongshu"
      }
    });
  } finally {
    capture.restore();
  }

  assert.equal(capture.output.length, 1);
  assert.equal(capture.output[0]?.endsWith("\n"), true);

  const rawLine = capture.output[0]?.trimEnd() ?? "";
  assert.equal(rawLine.includes("\n"), false);
  assert.deepEqual(JSON.parse(rawLine), {
    event: "publish_command_result",
    status: "published",
    detail: {
      platform: "xiaohongshu"
    }
  });
});
