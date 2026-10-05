// Building a State from a reset fixture (§4) or from an imported export (§10). Both validate first and
// return a complete new State; nothing is touched until the caller swaps it in with replaceState().
import { validation } from "./errors.ts";
import { hashPassword } from "./auth.ts";
import { emptyState, findOverlap, nowRfc3339, STATE_VERSION } from "./store.ts";
import type { Receipt, Reservation, Restaurant, State, User } from "./store.ts";
import { addMinutes, formatInstant, isValidZone, localToInstant, parseLocal } from "./time.ts";
import { isInt, isObj } from "./validate.ts";
import type { Obj } from "./validate.ts";

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const bad = (m: string): never => validation(m);
const str = (v: unknown, what: string): string => (typeof v === "string" && v !== "" ? v : bad(`${what} must be a non-empty string`));
const id = (v: unknown, what: string): string => {
  const x = str(v, what);
  return x.length <= 64 ? x : bad(`${what} is longer than 64 characters`);
};
const REF = /^[A-Z0-9]{6,12}$/;
const reference = (v: unknown): string => (typeof v === "string" && REF.test(v) ? v : bad("reservation reference must be 6 to 12 characters of A-Z0-9"));
const posInt = (v: unknown, what: string): number => (isInt(v) && v > 0 ? v : bad(`${what} must be a positive integer`));
const arr = (v: unknown, what: string): unknown[] => (Array.isArray(v) ? v : bad(`${what} must be an array`));
const obj = (v: unknown, what: string): Obj => (isObj(v) ? v : bad(`${what} must be an object`));

function parseRestaurant(raw: unknown): Restaurant {
  const r = obj(raw, "restaurant");
  const timezone = str(r.timezone, "timezone");
  if (!isValidZone(timezone)) bad(`unknown time zone ${timezone}`);
  const opening_hours = arr(r.opening_hours ?? [], "opening_hours").map((x) => {
    const o = obj(x, "opening_hours entry");
    const weekday = str(o.weekday, "weekday");
    if (!WEEKDAYS.includes(weekday)) bad("weekday must be one of mon..sun");
    if (typeof o.opens !== "string" || !HHMM.test(o.opens) || typeof o.closes !== "string" || !HHMM.test(o.closes)) bad("opens/closes must be HH:MM");
    return { weekday, opens: o.opens, closes: o.closes };
  });
  const tables = arr(r.tables ?? [], "tables").map((x) => {
    const t = obj(x, "table");
    const tid = id(t.id, "table id");
    return { id: tid, label: typeof t.label === "string" ? t.label : tid, capacity: posInt(t.capacity, "capacity") };
  });
  const cutoff = r.cancellation_cutoff_minutes ?? 0;
  if (!isInt(cutoff) || cutoff < 0) bad("cancellation_cutoff_minutes must be a non-negative integer");
  return {
    id: id(r.id, "restaurant id"), name: typeof r.name === "string" ? r.name : String(r.id), timezone,
    slot_minutes: posInt(r.slot_minutes, "slot_minutes"),
    reservation_duration_minutes: posInt(r.reservation_duration_minutes, "reservation_duration_minutes"),
    cancellation_cutoff_minutes: cutoff, opening_hours, tables,
  };
}

/** Cross-record invariants that reset and import must both hold (L1.1 no overlap, ids unique, references resolve). */
function checkIntegrity(s: State): void {
  const userIds = new Set<string>();
  for (const u of s.users) { if (userIds.has(u.id)) bad("duplicate user id"); userIds.add(u.id); }
  const restIds = new Set<string>();
  for (const r of s.restaurants) {
    if (restIds.has(r.id)) bad("duplicate restaurant id");
    restIds.add(r.id);
    const tids = new Set<string>();
    for (const t of r.tables) { if (tids.has(t.id)) bad("duplicate table id within a restaurant"); tids.add(t.id); }
  }
  const placed: State = { ...s, reservations: [] };
  for (const r of s.reservations) {
    const rest = s.restaurants.find((q) => q.id === r.restaurant_id);
    if (!rest) bad("reservation names an unknown restaurant");
    if (!rest!.tables.some((t) => t.id === r.table_id)) bad("reservation names a table that is not at its restaurant");
    if (!userIds.has(r.user_id)) bad("reservation names an unknown user");
    if (r.status === "confirmed" && findOverlap(placed, r.restaurant_id, r.table_id, r.start_ms, r.end_ms)) bad("two confirmed reservations overlap on one table");
    placed.reservations.push(r);
  }
}

/** `fixture` -> a fresh State. Passwords are hashed (async) before anything is replaced. */
export async function stateFromFixture(raw: unknown): Promise<State> {
  const fx = obj(raw, "fixture");
  const s = emptyState();
  const seenEmail = new Set<string>();
  for (const x of arr(fx.users ?? [], "users")) {
    const u = obj(x, "user");
    const email = str(u.email, "user email");
    if (seenEmail.has(email.toLowerCase())) bad("duplicate user email");
    seenEmail.add(email.toLowerCase());
    const user: User = {
      id: id(u.id, "user id"), email, display_name: typeof u.display_name === "string" ? u.display_name : email.split("@")[0],
      password: await hashPassword(str(u.password, "user password")), created_at: nowRfc3339(),
    };
    s.users.push(user);
  }
  s.restaurants = arr(fx.restaurants ?? [], "restaurants").map(parseRestaurant);
  for (const x of arr(fx.reservations ?? [], "reservations")) {
    const r = obj(x, "reservation");
    const rest = s.restaurants.find((q) => q.id === r.restaurant_id);
    if (!rest) bad("reservation names an unknown restaurant");
    const local = parseLocal(r.starts_at_local);
    if (!local) bad("reservation starts_at_local must be YYYY-MM-DDTHH:MM");
    const start = localToInstant(rest!.timezone, local!);
    if (start === null) bad("reservation starts_at_local does not exist in the restaurant's zone");
    const end = addMinutes(start!, rest!.reservation_duration_minutes);
    const tz = rest!.timezone;
    const res: Reservation = {
      reservation_id: id(r.id ?? r.reservation_id, "reservation id"), reference: reference(r.reference),
      restaurant_id: rest!.id, table_id: id(r.table_id, "reservation table_id"), party_size: posInt(r.party_size, "party_size"),
      status: r.status === "cancelled" ? "cancelled" : "confirmed", starts_at_local: r.starts_at_local as string,
      starts_at: formatInstant(tz, start!), ends_at: formatInstant(tz, end),
      created_at: typeof r.created_at === "string" ? r.created_at : nowRfc3339(),
      user_id: id(r.user_id, "reservation user_id"), start_ms: start!, end_ms: end,
    };
    if (s.reservations.some((q) => q.reference === res.reference || q.reservation_id === res.reservation_id)) bad("duplicate reservation reference or id");
    s.reservations.push(res);
  }
  checkIntegrity(s);
  return s;
}

/** An imported export's `state` -> a normalized State. Unknown extra keys are kept; missing newer fields get defaults (D7). */
export function stateFromExport(raw: unknown): State {
  const o = obj(raw, "state");
  if (o.version !== undefined && (!isInt(o.version) || o.version < 1 || o.version > STATE_VERSION)) bad("unsupported state version");
  const s: State = { ...emptyState(), ...(structuredClone(o) as Obj), version: STATE_VERSION } as State;
  const seq = obj(s.seq, "seq");
  if (!isInt(seq.user) || !isInt(seq.reservation)) bad("seq counters must be integers");
  if (!Array.isArray(s.users) || !Array.isArray(s.restaurants) || !Array.isArray(s.reservations)) bad("users, restaurants and reservations must be arrays");
  obj(s.tokens, "tokens");
  obj(s.idempotency, "idempotency");
  const ids = new Set<string>();
  for (const u of s.users as User[]) {
    const x = obj(u, "user");
    str(x.id, "user id"); str(x.email, "user email");
    const p = obj(x.password, "user password");
    if (p.algo !== "scrypt" || !isInt(p.N) || !isInt(p.r) || !isInt(p.p) || typeof p.salt !== "string" || typeof p.hash !== "string") bad("user password hash is invalid");
    if (ids.has(x.id as string)) bad("duplicate user id");
    ids.add(x.id as string);
  }
  for (const [tok, uid] of Object.entries(s.tokens)) if (typeof uid !== "string" || !ids.has(uid)) bad(`token ${tok.slice(0, 4)}… names an unknown user`);
  const rids = new Set<string>();
  for (const r of s.restaurants as Restaurant[]) {
    const p = parseRestaurant(r);
    if (rids.has(p.id)) bad("duplicate restaurant id");
    rids.add(p.id);
  }
  const refs = new Set<string>();
  const resIds = new Set<string>();
  for (const r of s.reservations as Reservation[]) {
    const x = obj(r, "reservation");
    for (const f of ["reservation_id", "reference", "restaurant_id", "table_id", "starts_at_local", "starts_at", "ends_at", "created_at", "user_id"]) str(x[f], f);
    if (x.status !== "confirmed" && x.status !== "cancelled") bad("reservation status is invalid");
    if (!isInt(x.party_size) || typeof x.start_ms !== "number" || typeof x.end_ms !== "number") bad("reservation numbers are invalid");
    if (!rids.has(x.restaurant_id as string)) bad("reservation names an unknown restaurant");
    reference(x.reference);
    if (refs.has(x.reference as string) || resIds.has(x.reservation_id as string)) bad("duplicate reservation reference or id");
    refs.add(x.reference as string);
    resIds.add(x.reservation_id as string);
  }
  for (const [k, v] of Object.entries(s.idempotency)) {
    const r = obj(v, "idempotency receipt") as unknown as Receipt;
    if (typeof r.method !== "string" || typeof r.path !== "string" || typeof r.key !== "string" || typeof r.user_id !== "string" || typeof r.body_canon !== "string" || !isInt(r.status) || !("response" in r)) {
      bad(`idempotency receipt ${k.slice(0, 12)} is invalid`);
    }
  }
  checkIntegrity(s);
  return s;
}
