// Building a State from a reset fixture (§4) or from an imported export (§10). Both validate first and
// return a complete new State; nothing is touched until the caller swaps it in with replaceState().
import { validation } from "./errors.ts";
import { hashPassword } from "./auth.ts";
import { emptyState, findOverlap, nowRfc3339, STATE_VERSION } from "./store.ts";
import type { Receipt, Reservation, Restaurant, State, User } from "./store.ts";
import { checkReservationExtras, normalizeReservation } from "./history.ts";
import { baseTerms, capacityOf, parsePolicy } from "./policies.ts";
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

function parseRestaurant(raw: unknown, fromExport = false): Restaurant {
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
  const combinable = arr(r.combinable ?? [], "combinable").map((x) => {
    const pair = arr(x, "combinable entry").map((t) => str(t, "combinable table id"));
    if (pair.length !== 2 || pair[0] === pair[1]) bad("each combinable entry must be a pair of two different tables");
    if (!pair.every((t) => tables.some((q) => q.id === t))) bad("combinable names a table that is not at the restaurant");
    return pair;
  });
  const out: Restaurant = {
    id: id(r.id, "restaurant id"), name: typeof r.name === "string" ? r.name : String(r.id), timezone,
    slot_minutes: posInt(r.slot_minutes, "slot_minutes"),
    reservation_duration_minutes: posInt(r.reservation_duration_minutes, "reservation_duration_minutes"),
    cancellation_cutoff_minutes: cutoff, opening_hours, tables, combinable,
    manager_user_ids: arr(r.manager_user_ids ?? [], "manager_user_ids").map((u) => id(u, "manager user id")),
    policies: [], revision: 0, closures: [],
  };
  if (fromExport) {
    const rev = r.revision ?? 0;
    if (!isInt(rev) || rev < 0) bad("restaurant revision must be a non-negative integer");
    out.revision = rev;
    out.closures = arr(r.closures ?? [], "closures").map((x) => {
      const c = obj(x, "closure");
      if (!out.tables.some((t) => t.id === c.table_id)) bad("closure names a table that is not at the restaurant");
      if (typeof c.from !== "string" || typeof c.to !== "string" || typeof c.from_ms !== "number" || typeof c.to_ms !== "number" || !(c.from_ms < c.to_ms)) bad("closure interval is invalid");
      return { table_id: c.table_id as string, from: c.from, to: c.to, from_ms: c.from_ms, to_ms: c.to_ms, plan_id: str(c.plan_id, "closure plan_id") };
    });
    out.policies = arr(r.policies ?? [], "policies").map((x, i) => {
      const p = obj(x, "policy");
      if (p.policy_version !== i + 1) bad("policy versions must be 1, 2, 3 in publication order");
      return { policy_version: i + 1, ...parsePolicy(p, out) };
    });
  }
  return out;
}

/** Cross-record invariants that reset and import must both hold (L1.1 no overlap, ids unique, references resolve). */
function checkIntegrity(s: State): void {
  const userIds = new Set<string>();
  for (const u of s.users) { if (userIds.has(u.id)) bad("duplicate user id"); userIds.add(u.id); }
  const restIds = new Set<string>();
  for (const r of s.restaurants) {
    if (restIds.has(r.id)) bad("duplicate restaurant id");
    restIds.add(r.id);
    for (const m of r.manager_user_ids) if (!userIds.has(m)) bad("manager_user_ids names an unknown user");
    const tids = new Set<string>();
    for (const t of r.tables) { if (tids.has(t.id)) bad("duplicate table id within a restaurant"); tids.add(t.id); }
  }
  const placed: State = { ...s, reservations: [] };
  for (const r of s.reservations) {
    const rest = s.restaurants.find((q) => q.id === r.restaurant_id);
    if (!rest) bad("reservation names an unknown restaurant");
    if (!r.table_ids.length || !r.table_ids.every((id) => rest!.tables.some((t) => t.id === id))) bad("reservation names a table that is not at its restaurant");
    if (r.table_ids.length > 2 || (r.table_ids.length === 2 && !rest!.combinable.some((p) => p.includes(r.table_ids[0]) && p.includes(r.table_ids[1])))) bad("reservation holds tables that are not a declared combination");
    checkReservationExtras(r, bad);
    if (r.party_size > capacityOf(r.accepted_terms, r.table_ids)) bad("reservation party_size exceeds the capacity of its tables");
    if (!userIds.has(r.user_id)) bad("reservation names an unknown user");
    if (r.status === "confirmed" && findOverlap(placed, r.restaurant_id, r.table_ids, r.start_ms, r.end_ms)) bad("two confirmed reservations overlap on one table");
    placed.reservations.push(r);
  }
  checkSeries(s);
  checkPlans(s);
}

/** Stored replan previews and applied closures: every reference resolves, an applied plan owns exactly one closure and vice versa. */
function checkPlans(s: State): void {
  if (!Array.isArray(s.plans)) bad("plans must be an array");
  const ids = new Set<string>();
  for (const p of s.plans) {
    const x = obj(p, "plan");
    const pid = str(x.plan_id, "plan_id");
    if (ids.has(pid)) bad("duplicate plan id");
    ids.add(pid);
    const rest = s.restaurants.find((q) => q.id === x.restaurant_id);
    if (!rest) bad("plan names an unknown restaurant");
    if (!isInt(x.restaurant_revision) || x.restaurant_revision < 0 || typeof x.applied !== "boolean") bad("plan revision or applied flag is invalid");
    const c = obj(x.closure, "plan closure");
    if (!rest!.tables.some((t) => t.id === c.table_id) || typeof c.from_ms !== "number" || typeof c.to_ms !== "number" || !(c.from_ms < c.to_ms) || typeof c.from !== "string" || typeof c.to !== "string") bad("plan closure is invalid");
    const seen = new Set<string>();
    let changed = 0;
    for (const a of arr(x.assignments, "plan assignments")) {
      const e = obj(a, "assignment");
      const rec = s.reservations.find((q) => q.reference === e.reference && q.restaurant_id === rest!.id);
      const tids = arr(e.table_ids, "assignment table_ids");
      if (!rec || seen.has(rec.reference) || typeof e.changed !== "boolean") bad("plan assignment is invalid");
      seen.add(rec!.reference);
      if (tids.length < 1 || tids.length > 2 || !tids.every((t) => typeof t === "string" && rest!.tables.some((q) => q.id === t))) bad("plan assignment tables are invalid");
      if (tids.length === 2 && !rest!.combinable.some((q) => q.includes(tids[0] as string) && q.includes(tids[1] as string))) bad("plan assignment is not a declared combination");
      if (e.changed) changed++;
    }
    if (x.moved_count !== changed || !isInt(x.unused_seats) || x.unused_seats < 0) bad("plan totals are invalid");
  }
  for (const r of s.restaurants) {
    for (const c of r.closures) {
      const p = s.plans.find((q) => q.plan_id === c.plan_id);
      if (!p || !p.applied || p.restaurant_id !== r.id || p.closure.table_id !== c.table_id) bad("closure does not belong to an applied plan of its restaurant");
    }
    for (const p of s.plans) if (p.restaurant_id === r.id && p.applied && r.closures.filter((c) => c.plan_id === p.plan_id).length !== 1) bad("an applied plan must have exactly one closure");
  }
}

/** Series invariants: 2..12 distinct occurrences in index order, all owned by the series owner at its restaurant, each pointing back at it. */
function checkSeries(s: State): void {
  if (!Array.isArray(s.series)) bad("series must be an array");
  const ids = new Set<string>();
  const inSeries = new Set<string>();
  for (const ser of s.series) {
    const x = obj(ser, "series");
    const sid = str(x.series_id, "series_id");
    if (ids.has(sid)) bad("duplicate series id");
    ids.add(sid);
    if (!isInt(x.revision) || x.revision < 1 || !isInt(x.interval_weeks) || x.interval_weeks < 1 || x.interval_weeks > 4) bad("series revision or interval is invalid");
    if (!s.users.some((u) => u.id === x.user_id) || !s.restaurants.some((q) => q.id === x.restaurant_id)) bad("series names an unknown user or restaurant");
    const occ = arr(x.occurrences, "series occurrences");
    if (occ.length < 2 || occ.length > 12) bad("a series has 2 to 12 occurrences");
    occ.forEach((o, i) => {
      const e = obj(o, "occurrence");
      const rec = s.reservations.find((r) => r.reference === e.reference);
      if (e.index !== i || typeof e.exception !== "boolean" || !rec) bad("series occurrence is invalid");
      if (rec!.series_id !== sid || rec!.user_id !== x.user_id || rec!.restaurant_id !== x.restaurant_id) bad("series occurrence does not match its reservation");
      if (inSeries.has(rec!.reference)) bad("a reservation is in two series");
      inSeries.add(rec!.reference);
    });
  }
  for (const r of s.reservations) if (r.series_id !== undefined && !inSeries.has(r.reference)) bad("reservation names a series that does not list it");
}

/** A seeded reservation holds `table_id` or `table_ids` (not both): one or more distinct ids. */
function seededTables(r: Obj): string[] {
  if (r.table_id !== undefined && r.table_ids !== undefined) bad("reservation has both table_id and table_ids");
  const raw = r.table_ids !== undefined ? arr(r.table_ids, "table_ids") : [r.table_id];
  const ids = raw.map((t) => id(t, "reservation table id"));
  if (ids.length === 0 || new Set(ids).size !== ids.length) bad("reservation table_ids must be distinct and not empty");
  return ids;
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
      restaurant_id: rest!.id, table_ids: seededTables(r), party_size: posInt(r.party_size, "party_size"),
      status: r.status === "cancelled" ? "cancelled" : "confirmed", starts_at_local: r.starts_at_local as string,
      starts_at: formatInstant(tz, start!), ends_at: formatInstant(tz, end),
      created_at: typeof r.created_at === "string" ? r.created_at : nowRfc3339(),
      user_id: id(r.user_id, "reservation user_id"), start_ms: start!, end_ms: end,
    };
    if (s.reservations.some((q) => q.reference === res.reference || q.reservation_id === res.reservation_id)) bad("duplicate reservation reference or id");
    normalizeReservation(res, rest!, baseTerms(rest!));
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
  // Older exports (stage 1): a reservation holds `table_id`; restaurants have no `combinable` (D7: missing fields default).
  if (Array.isArray(s.reservations)) {
    for (const r of s.reservations as unknown as Obj[]) {
      if (isObj(r) && r.table_ids === undefined && typeof r.table_id === "string") r.table_ids = [r.table_id];
      if (isObj(r)) delete r.table_id;
    }
  }
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
  const parsedRestaurants: Restaurant[] = [];
  for (const r of s.restaurants as Restaurant[]) {
    const p = parseRestaurant(r, true);
    if (rids.has(p.id)) bad("duplicate restaurant id");
    rids.add(p.id);
    parsedRestaurants.push(p);
  }
  s.restaurants = parsedRestaurants;
  const refs = new Set<string>();
  const resIds = new Set<string>();
  for (const r of s.reservations as Reservation[]) {
    const x = obj(r, "reservation");
    if (!Array.isArray(x.table_ids) || !x.table_ids.length || x.table_ids.some((t) => typeof t !== "string")) bad("reservation table_ids is invalid");
    for (const f of ["reservation_id", "reference", "restaurant_id", "starts_at_local", "starts_at", "ends_at", "created_at", "user_id"]) str(x[f], f);
    if (x.status !== "confirmed" && x.status !== "cancelled") bad("reservation status is invalid");
    if (!isInt(x.party_size) || typeof x.start_ms !== "number" || typeof x.end_ms !== "number") bad("reservation numbers are invalid");
    if (!rids.has(x.restaurant_id as string)) bad("reservation names an unknown restaurant");
    reference(x.reference);
    const rest = s.restaurants.find((q) => q.id === x.restaurant_id)!;
    normalizeReservation(r, rest, baseTerms(rest)); // stage-1/2 exports lack revision, terms and history
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
