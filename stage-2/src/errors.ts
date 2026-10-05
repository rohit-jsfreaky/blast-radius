// S2: the one way errors are shaped (F: error envelope, validation order and codes).
export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

export const fail = (status: number, code: string, message?: string): never => {
  throw new ApiError(status, code, message);
};

export const malformed = (message = "malformed request"): never => fail(400, "malformed_request", message);
export const missingIdempotencyKey = (): never => fail(400, "missing_idempotency_key", "Idempotency-Key header is required");
export const unauthenticated = (message = "authentication required"): never => fail(401, "unauthenticated", message);
export const forbidden = (message = "forbidden"): never => fail(403, "forbidden", message);
export const notFound = (message = "not found"): never => fail(404, "not_found", message);
export const validation = (message = "validation failed"): never => fail(422, "validation_failed", message);
export const idempotencyKeyReuse = (): never =>
  fail(409, "idempotency_key_reuse", "Idempotency-Key was already used with a different request body");

export const errorBody = (e: ApiError) => ({ error: { code: e.code, message: e.message } });
