type LogLevel = "info" | "warn" | "error";

export interface LogFields {
  [key: string]: unknown;
}

interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export interface JsonLineEnvelope {
  event: string;
  [key: string]: unknown;
}

export function createLogger(component: string): Logger {
  return {
    info: (event, fields) => writeLog("info", component, event, fields),
    warn: (event, fields) => writeLog("warn", component, event, fields),
    error: (event, fields) => writeLog("error", component, event, fields)
  };
}

export function summarizeError(error: unknown): LogFields {
  if (error instanceof Error) {
    return {
      error_name: error.name,
      error_message: error.message,
      error_stack: error.stack
    };
  }

  return {
    error_message: String(error)
  };
}

export function writeJsonLine(payload: JsonLineEnvelope): void {
  process.stdout.write(`${JSON.stringify(normalizeValue(payload))}\n`);
}

function writeLog(level: LogLevel, component: string, event: string, fields: LogFields = {}): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    component,
    event,
    ...normalizeFields(fields)
  };

  process.stderr.write(`${JSON.stringify(entry)}\n`);
}

function normalizeFields(fields: LogFields): LogFields {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, normalizeValue(value)])
  );
}

function normalizeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return summarizeError(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, nestedValue]) => nestedValue !== undefined)
        .map(([key, nestedValue]) => [key, normalizeValue(nestedValue)])
    );
  }

  return value;
}
