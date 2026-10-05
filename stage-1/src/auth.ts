// S5: password hashing (D3, scrypt), bearer tokens, signup/login, and the auth guard used by the router.
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { ApiError, fail, unauthenticated, validation } from "./errors.ts";
import { newUserId, nowRfc3339, read, transact } from "./store.ts";
import type { ScryptHash, State, User } from "./store.ts";
import { asObject, optString, reqString } from "./validate.ts";

const PARAMS = { N: 8192, r: 8, p: 1 } as const;
const KEYLEN = 32;

function derive(password: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((res, rej) =>
    scrypt(password, salt, KEYLEN, { N, r, p, maxmem: 128 * N * r * 2 }, (e, k) => (e ? rej(e) : res(k))));
}

export async function hashPassword(password: string): Promise<ScryptHash> {
  const salt = randomBytes(16);
  const k = await derive(password, salt, PARAMS.N, PARAMS.r, PARAMS.p);
  return { algo: "scrypt", ...PARAMS, salt: salt.toString("hex"), hash: k.toString("hex") };
}

export async function verifyPassword(password: string, h: ScryptHash): Promise<boolean> {
  const k = await derive(password, Buffer.from(h.salt, "hex"), h.N, h.r, h.p);
  const want = Buffer.from(h.hash, "hex");
  return k.length === want.length && timingSafeEqual(k, want);
}

const sameEmail = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export const userByEmail = (s: State, email: string): User | undefined => s.users.find((u) => sameEmail(u.email, email));
export const userById = (s: State, id: string): User | undefined => s.users.find((u) => u.id === id);

export const newToken = () => randomBytes(32).toString("hex");

/** Bearer token from the Authorization header -> the user, else 401 unauthenticated. */
export function authenticate(headers: Record<string, string | string[] | undefined>): User {
  const raw = headers["authorization"];
  const h = Array.isArray(raw) ? raw[0] : raw;
  const m = typeof h === "string" ? /^Bearer +(\S+)$/i.exec(h.trim()) : null;
  if (!m) return unauthenticated("missing or malformed bearer token");
  const s = read();
  const uid = Object.prototype.hasOwnProperty.call(s.tokens, m[1]) ? s.tokens[m[1]] : undefined;
  const user = uid ? userById(s, uid) : undefined;
  return user ?? unauthenticated("unknown bearer token");
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;

export async function signup(bodyIn: unknown) {
  const body = asObject(bodyIn);
  const email = reqString(body, "email");
  const password = reqString(body, "password");
  const display = optString(body, "display_name");
  if (!EMAIL_RE.test(email) || email.length > 254) validation("email must be of the form local@domain");
  if (password.length < 8) validation("password must be at least 8 characters");
  const display_name = display !== undefined && display !== "" ? display : email.split("@")[0];
  const hashed = await hashPassword(password); // the slow part runs first; the commit below is synchronous
  const token = newToken();
  return transact((d) => {
    if (userByEmail(d, email)) fail(409, "email_taken", "email already registered");
    const u: User = { id: newUserId(d), email, display_name, password: hashed, created_at: nowRfc3339() };
    d.users.push(u);
    d.tokens[token] = u.id;
    return { status: 201, body: { user_id: u.id, display_name: u.display_name, token } };
  });
}

export async function login(bodyIn: unknown) {
  const body = asObject(bodyIn);
  const email = reqString(body, "email");
  const password = reqString(body, "password");
  const u = userByEmail(read(), email);
  if (!u) {
    await hashPassword(password).catch(() => undefined); // keep unknown-email timing close to wrong-password
    return unauthenticated("invalid credentials");
  }
  if (!(await verifyPassword(password, u.password))) return unauthenticated("invalid credentials");
  const token = newToken();
  return transact((d) => {
    if (!userById(d, u.id)) throw new ApiError(401, "unauthenticated", "invalid credentials");
    d.tokens[token] = u.id;
    return { status: 200, body: { user_id: u.id, display_name: u.display_name, token } };
  });
}
