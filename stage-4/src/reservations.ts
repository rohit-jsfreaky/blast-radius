// Owned by builder-b: reservations (create, list, get, cancel, amend, history, decision) and the one amendment path that moves.ts reuses.
import { authenticate } from "./auth.ts";
import { fail, malformed, notFound, validation } from "./errors.ts";
import { bumpRestaurant, bumpSeries, createdChanges, diffFields, pushHistory } from "./history.ts";
import type { HistoryChange } from "./history.ts";
import { lookup, readKey, record } from "./idempotency.ts";
import { termsFor } from "./policies.ts";
import type { Terms } from "./policies.ts";
import type { Router } from "./router.ts";
import { resolveStart } from "./schedule.ts";
import { findOverlap, newReference, newReservationId, nowRfc3339, read, restaurantById, toPublic, transact } from "./store.ts";
import type { Reservation, Restaurant, State } from "./store.ts";
import { readTableIds, resolveTableSet, setCapacity } from "./tables.ts";
import { formatInstant, parseLocal } from "./time.ts";
import { asObject, isInt } from "./validate.ts";
import type { Obj } from "./validate.ts";

/**
 * Shape of the bookable fields, identical for create, patch and moves.
 * `required` (create) demands every field; otherwise only the present ones are checked.
 * party_size: anything but an integer >= 1 -> 422. Other fields: wrong JSON type -> 400, null/missing/bad format -> 422.
 */
export function checkShape(o: Obj, required: boolean, withRestaurant: boolean): void {
  if (withRestaurant) {
    const v = o.restaurant_id;
    if (v === undefined || v === null) validation("restaurant_id is required");
    if (typeof v !== "string") malformed("restaurant_id must be a string");
  }
  if (readTableIds(o) === undefined && required) validation("table_id or table_ids is required");
  const v = o.starts_at_local;
  if (v === undefined) { if (required) validation("starts_at_local is required"); }
  else {
    if (v === null) validation("starts_at_local must not be null");
    if (typeof v !== "string") malformed("starts_at_local must be a string");
    if (!parseLocal(v)) validation("starts_at_local must be a bare local YYYY-MM-DDTHH:MM");
  }
  if (o.party_size === undefined) { if (required) validation("party_size is required"); }
  else if (!isInt(o.party_size) || o.party_size < 1) validation("party_size must be a whole number of at least 1");
}

/** Within the ACCEPTED cancellation cutoff of the CURRENT start (or later) -> 409. Shared by cancel, patch and moves. */
export function checkCutoff(rec: Reservation, now: number): void {
  if (now >= rec.start_ms - rec.accepted_terms.cancellation_cutoff_minutes * 60_000) fail(409, "cutoff_passed", "too close to the start to change or cancel");
}

export function checkNotCancelled(rec: Reservation): void {
  if (rec.status === "cancelled") fail(409, "reservation_cancelled", "reservation is cancelled");
}

/** Optional `expected_revision`: a positive integer, else 422 (booleans, strings, 0, negatives, fractions, null). */
export function readExpectedRevision(o: Obj): number | undefined {
  const v = o.expected_revision;
  if (v === undefined) return undefined;
  if (!isInt(v) || v < 1) return validation("expected_revision must be a positive integer");
  return v;
}

export interface Booked { table_ids: string[]; party_size: number; starts_at_local: string; start_ms: number; end_ms: number }
export interface Resolved extends Booked { terms: Terms }

/**
 * Validates a resulting booking against the policy that applies to its resulting LOCAL START DATE, in one order:
 * start validity (invalid_local_time, outside_opening_hours, not_on_slot_grid) -> party_exceeds_capacity (summed over the set).
 * The table set must already be resolved (tables exist, declared set). Occupancy is checked by the caller.
 */
export function resolveUnderPolicy(s: State, restaurant: Restaurant, f: { table_ids: string[]; starts_at_local: string; party_size: number }): Resolved {
  const terms = termsFor(s, restaurant, f.starts_at_local.slice(0, 10));
  const b = resolveStart(restaurant, f.starts_at_local, terms);
  if (f.party_size > setCapacity(restaurant, f.table_ids, terms)) fail(422, "party_exceeds_capacity", "party is larger than the tables' capacity");
  return { table_ids: f.table_ids, party_size: f.party_size, starts_at_local: f.starts_at_local, start_ms: b.start_ms, end_ms: b.end_ms, terms };
}

/** Apply a resolved booking to a record, refreshing its derived public fields. */
export function applyBooked(rec: Reservation, restaurant: Restaurant, b: Booked): void {
  rec.table_ids = b.table_ids; rec.party_size = b.party_size; rec.starts_at_local = b.starts_at_local;
  rec.start_ms = b.start_ms; rec.end_ms = b.end_ms;
  rec.starts_at = formatInstant(restaurant.timezone, b.start_ms);
  rec.ends_at = formatInstant(restaurant.timezone, b.end_ms);
}

/**
 * Creates a confirmed reservation inside a transaction: table set, policy for the start date, occupancy, revision 1,
 * accepted terms and the `created` history entry. No idempotency here (the caller owns that); used by POST /reservations and series adoption.
 */
export function createBooking(s: State, restaurant: Restaurant, userId: string, f: { table_ids: string[]; starts_at_local: string; party_size: number }, nowMs: number): Reservation {
  const ids = resolveTableSet(restaurant, f.table_ids);
  const b = resolveUnderPolicy(s, restaurant, { ...f, table_ids: ids });
  if (findOverlap(s, restaurant.id, ids, b.start_ms, b.end_ms)) fail(409, "table_unavailable", "the table is taken for an overlapping time");
  const rec: Reservation = {
    reservation_id: newReservationId(s), reference: newReference(s), restaurant_id: restaurant.id,
    table_ids: ids, party_size: b.party_size, status: "confirmed", starts_at_local: b.starts_at_local,
    starts_at: "", ends_at: "", created_at: nowRfc3339(), user_id: userId, start_ms: b.start_ms, end_ms: b.end_ms,
    revision: 1, accepted_terms: b.terms, history: [],
  };
  applyBooked(rec, restaurant, b);
  pushHistory(rec, restaurant, "created", createdChanges({ table_ids: ids, starts_at_local: b.starts_at_local, party_size: b.party_size }), nowMs);
  s.reservations.push(rec);
  return rec;
}

export interface Plan { resolved: Resolved; changes: HistoryChange[] }

/**
 * An amendment of one booking (PATCH, and each move), pure: nothing is mutated. Order:
 * expected_revision shape 422 -> stale_revision 409 -> cancelled 409 -> OLD accepted cutoff 409 -> field shape
 * -> table set (404, combination_not_allowed) -> no-op (returns null) -> resulting date's policy (start rules, capacity).
 * Occupancy is the caller's.
 */
export function planAmend(s: State, rec: Reservation, restaurant: Restaurant, input: Obj, now: number): Plan | null {
  const expected = readExpectedRevision(input);
  if (expected !== undefined && expected !== rec.revision) fail(409, "stale_revision", "the reservation changed since that revision");
  checkNotCancelled(rec);
  checkCutoff(rec, now);
  checkShape(input, false, false);
  const ids = resolveTableSet(restaurant, readTableIds(input) ?? rec.table_ids);
  const f = {
    table_ids: ids, starts_at_local: (input.starts_at_local as string | undefined) ?? rec.starts_at_local,
    party_size: (input.party_size as number | undefined) ?? rec.party_size,
  };
  const changes = diffFields(rec, f);
  if (changes.length === 0) return null;
  return { resolved: resolveUnderPolicy(s, restaurant, f), changes };
}

/** Commit a plan to the record: terms and end time replaced, revision +1 once, one `changed` entry. */
export function applyPlan(rec: Reservation, restaurant: Restaurant, plan: Plan, nowMs: number): void {
  applyBooked(rec, restaurant, plan.resolved);
  rec.accepted_terms = plan.resolved.terms;
  rec.revision += 1;
  pushHistory(rec, restaurant, "changed", plan.changes, nowMs);
}

/** The caller's reservation by reference; someone else's or unknown is 404 (no leak). */
export function ownedReservation(s: State, userId: string, reference: string): Reservation {
  const rec = s.reservations.find((r) => r.reference === reference && r.user_id === userId);
  return rec ?? notFound("no such reservation");
}

/** History and decision: owner only; anyone else, signed in or not, gets the same 404. */
function ownerOr404(ctx: { headers: Record<string, string | string[] | undefined>; params: Record<string, string> }): Reservation {
  let userId: string;
  try { userId = authenticate(ctx.headers).id; } catch { return notFound("no such reservation"); }
  return ownedReservation(read(), userId, ctx.params.reference);
}

export function register(router: Router): void {
  router.add("POST", "/reservations", { auth: true }, (ctx) => {
    const user = ctx.user!;
    const key = readKey(ctx.headers);
    const body = asObject(ctx.json());
    return transact((s: State) => {
      const replay = lookup(s, user.id, ctx.method, ctx.path, key, body);
      if (replay !== null) return { status: 200, body: replay };
      checkShape(body, true, true);
      const restaurant = restaurantById(s, body.restaurant_id as string);
      if (!restaurant) return notFound("no such restaurant");
      const rec = createBooking(s, restaurant, user.id, {
        table_ids: readTableIds(body)!, starts_at_local: body.starts_at_local as string, party_size: body.party_size as number,
      }, Date.now());
      bumpRestaurant(restaurant);
      const response = toPublic(rec);
      record(s, user.id, ctx.method, ctx.path, key, body, 201, response);
      return { status: 201, body: response };
    });
  });

  router.add("GET", "/reservations", { auth: true }, (ctx) => {
    const mine = read().reservations.filter((r) => r.user_id === ctx.user!.id);
    mine.sort((a, b) => b.start_ms - a.start_ms || (a.reference < b.reference ? -1 : 1));
    return { status: 200, body: { reservations: mine.map(toPublic) } };
  });

  router.add("GET", "/reservations/:reference", { auth: true }, (ctx) => {
    const rec = ownedReservation(read(), ctx.user!.id, ctx.params.reference);
    return { status: 200, body: toPublic(rec) };
  });

  router.add("GET", "/reservations/:reference/history", { auth: false }, (ctx) => {
    const rec = ownerOr404(ctx);
    return { status: 200, body: { reference: rec.reference, entries: structuredClone(rec.history) } };
  });

  router.add("GET", "/reservations/:reference/decision", { auth: false }, (ctx) => {
    const rec = ownerOr404(ctx);
    return { status: 200, body: { reference: rec.reference, revision: rec.revision, accepted_terms: structuredClone(rec.accepted_terms) } };
  });

  router.add("POST", "/reservations/:reference/cancel", { auth: true }, (ctx) => transact((s: State) => {
    const rec = ownedReservation(s, ctx.user!.id, ctx.params.reference);
    if (rec.status === "cancelled") return { status: 200, body: toPublic(rec) };
    const now = Date.now();
    checkCutoff(rec, now);
    rec.status = "cancelled";
    rec.revision += 1;
    const restaurant = restaurantById(s, rec.restaurant_id)!;
    pushHistory(rec, restaurant, "cancelled", [], now);
    bumpRestaurant(restaurant);
    bumpSeries(s, [{ rec, exception: false }]);
    return { status: 200, body: toPublic(rec) };
  }));

  router.add("PATCH", "/reservations/:reference", { auth: true }, (ctx) => {
    const body = asObject(ctx.json());
    return transact((s: State) => {
      const rec = ownedReservation(s, ctx.user!.id, ctx.params.reference);
      const restaurant = restaurantById(s, rec.restaurant_id)!;
      const now = Date.now();
      const plan = planAmend(s, rec, restaurant, body, now);
      if (plan === null) return { status: 200, body: toPublic(rec) };
      const r = plan.resolved;
      if (findOverlap(s, restaurant.id, r.table_ids, r.start_ms, r.end_ms, rec.reference)) fail(409, "table_unavailable", "the table is taken for an overlapping time");
      applyPlan(rec, restaurant, plan, now);
      bumpRestaurant(restaurant);
      bumpSeries(s, [{ rec, exception: true }]);
      return { status: 200, body: toPublic(rec) };
    });
  });
}
