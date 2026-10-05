// S4: idempotency, shared by every write path that takes a key (create, reservation-moves).
// Scope: the authenticated user. Identity of a request: user + method + path + key; a replay also needs the same JSON body.
// Same key + same path + different body -> 409. Same key on another path is a different request.
// Only successes are recorded, so a key whose request failed with 4xx is a first use next time.
import { idempotencyKeyReuse, missingIdempotencyKey, validation } from "./errors.ts";
import type { State } from "./store.ts";

/** Header value -> key. 400 when absent/empty, 422 when longer than 255 characters. */
export function readKey(headers: Record<string, string | string[] | undefined>): string {
  const raw = headers["idempotency-key"];
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === undefined || v === "") return missingIdempotencyKey();
  if (v.length > 255) return validation("Idempotency-Key must be 1 to 255 characters");
  return v;
}

/** Canonical JSON: sorted keys, so key order and whitespace never matter. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

const slot = (userId: string, method: string, path: string, key: string) => JSON.stringify([userId, method, path, key]);

/**
 * Call first inside transact(), after auth and body parsing and BEFORE any field validation.
 * Returns the original response body to replay with status 200, or null on first use. Throws 409 on a different body.
 */
export function lookup(s: State, userId: string, method: string, path: string, key: string, body: unknown): unknown | null {
  const r = s.idempotency[slot(userId, method, path, key)];
  if (!r) return null;
  if (r.body_canon !== canonical(body)) return idempotencyKeyReuse();
  return structuredClone(r.response);
}

/** Call last inside the same transact() that applied the effect, so effect and receipt commit together. */
export function record(s: State, userId: string, method: string, path: string, key: string, body: unknown, status: number, response: unknown): void {
  s.idempotency[slot(userId, method, path, key)] = {
    method, path, key, user_id: userId, body_canon: canonical(body), status, response: structuredClone(response),
  };
}
