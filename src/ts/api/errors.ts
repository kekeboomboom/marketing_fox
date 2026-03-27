import type { ApiErrorPayload } from "./types.js";

export interface ApiRequestError {
  statusCode: number;
  payload: ApiErrorPayload;
}

function createApiError(statusCode: number, payload: ApiErrorPayload): ApiRequestError {
  return {
    statusCode,
    payload
  };
}

export function badRequest(code: string, message: string): ApiRequestError {
  return createApiError(400, {
    code,
    message,
    retryable: false
  });
}

export function unauthorized(message: string = "Missing or invalid credentials."): ApiRequestError {
  return createApiError(401, {
    code: "unauthorized",
    message,
    retryable: false
  });
}

export function notFound(code: string, message: string): ApiRequestError {
  return createApiError(404, {
    code,
    message,
    retryable: false
  });
}

export function conflict(
  code: string,
  message: string,
  meta?: Record<string, unknown>
): ApiRequestError {
  return createApiError(409, {
    code,
    message,
    retryable: false,
    ...(meta ? { meta } : {})
  });
}

export function internalError(error: unknown): ApiRequestError {
  return createApiError(500, {
    code: "internal_error",
    message: error instanceof Error ? error.message : String(error),
    retryable: true
  });
}

export function isApiError(error: unknown): error is ApiRequestError {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    "payload" in error
  );
}
