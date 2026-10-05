// The only way the UI talks to the server. Every result is real server output; nothing is faked from cache.
import { token, setSession } from "./session.js";

/**
 * -> { status, ok, data } for any complete HTTP answer, or { net: true } when the answer never arrived
 * (offline, timeout, reset connection, unreadable body). `net` means the outcome is unknown.
 */
export async function api(method, path, { body, headers = {}, timeout = 20000 } = {}) {
  const h = { Accept: "application/json", ...headers };
  const tk = token();
  if (tk) h.Authorization = `Bearer ${tk}`;
  if (body !== undefined) h["Content-Type"] = "application/json";
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  let res;
  try {
    res = await fetch(path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal });
    const text = await res.text();
    clearTimeout(timer);
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch { return { net: true, status: res.status }; } }
    if (res.status === 401 && tk) setSession(null);
    return { status: res.status, ok: res.ok, data };
  } catch {
    clearTimeout(timer);
    return { net: true };
  }
}

export const errCode = (r) => (r && r.data && r.data.error && r.data.error.code) || "";

/** A new random idempotency key. */
export function newKey() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return Array.from({ length: 4 }, () => Math.random().toString(36).slice(2)).join("-");
}

/** Stable JSON text of a value (sorted keys) so equal bodies compare equal. */
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
