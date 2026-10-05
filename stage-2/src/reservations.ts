// Owned by builder-b: reservations (create, list, get, cancel, amend) and the one booking validator that moves.ts reuses.
import { fail, malformed, notFound, validation } from "./errors.ts";
import { lookup, readKey, record } from "./idempotency.ts";
import type { Router } from "./router.ts";
import { resolveStart } from "./schedule.ts";
import { findOverlap, newReference, newReservationId, nowRfc3339, read, restaurantById, toPublic, transact } from "./store.ts";
import type { Reservation, Restaurant, State } from "./store.ts";
import { formatInstant, parseLocal } from "./time.ts";
import { asObject, isInt } from "./validate.ts";
import type { Obj } from "./validate.ts";

/**
 * Shape of the bookable fields, identical for create, patch and moves.
 * `required` (create) demands every field; otherwise only the present ones are checked.
 * party_size: anything but an integer >= 1 -> 422. Other fields: wrong JSON type -> 400, null/missing/bad format -> 422.
 */
export function checkShape(o: Obj, required: boolean, withRestaurant: boolean): void {
  const names = withRestaurant ? ["restaurant_id", "table_id", "starts_at_local"] : ["table_id", "starts_at_local"];
  for (const f of names) {
    const v = o[f];
    if (v === undefined) { if (required) validation(`${f} is required`); continue; }
    if (v === null) validation(`${f} must not be null`);
    if (typeof v !== "string") malformed(`${f} must be a string`);
    if (f === "starts_at_local" && !parseLocal(v)) validation("starts_at_local must be a bare local YYYY-MM-DDTHH:MM");
  }
  if (o.party_size === undefined) { if (required) validation("party_size is required"); }
  else if (!isInt(o.party_size) || o.party_size < 1) validation("party_size must be a whole number of at least 1");
}

/** Cancelled -> 409; within the restaurant's cutoff of the CURRENT start (or later) -> 409. Shared by cancel, patch and moves. */
export function checkCutoff(rec: Reservation, restaurant: Restaurant, now: number): void {
  if (now >= rec.start_ms - restaurant.cancellation_cutoff_minutes * 60_000) fail(409, "cutoff_passed", "too close to the start to change or cancel");
}

export function checkNotCancelled(rec: Reservation): void {
  if (rec.status === "cancelled") fail(409, "reservation_cancelled", "reservation is cancelled");
}

export interface Booked { table_id: string; party_size: number; starts_at_local: string; start_ms: number; end_ms: number }

/**
 * Everything except occupancy, in one order: shape (done by the caller) -> table exists in the restaurant (404)
 * -> start validity (invalid_local_time, outside_opening_hours, not_on_slot_grid) -> party_exceeds_capacity.
 * `base` is the current booking for amendments: omitted fields keep their values and are not re-validated.
 */
export function resolveBooking(restaurant: Restaurant, o: Obj, base: Reservation | null): Booked {
  const tableId = (o.table_id as string | undefined) ?? base?.table_id as string;
  const table = restaurant.tables.find((t) => t.id === tableId);
  if (!table) return notFound("no such table at this restaurant");
  let local = base?.starts_at_local as string, startMs = base?.start_ms as number, endMs = base?.end_ms as number;
  if (o.starts_at_local !== undefined) {
    local = o.starts_at_local as string;
    const b = resolveStart(restaurant, local);
    startMs = b.start_ms; endMs = b.end_ms;
  }
  const party = (o.party_size as number | undefined) ?? base?.party_size as number;
  if (base === null || o.table_id !== undefined || o.party_size !== undefined) {
    if (party > table.capacity) fail(422, "party_exceeds_capacity", "party is larger than the table's capacity");
  }
  return { table_id: tableId, party_size: party, starts_at_local: local, start_ms: startMs, end_ms: endMs };
}

/** Apply a resolved booking to a record, refreshing its derived public fields. */
export function applyBooked(rec: Reservation, restaurant: Restaurant, b: Booked): void {
  rec.table_id = b.table_id; rec.party_size = b.party_size; rec.starts_at_local = b.starts_at_local;
  rec.start_ms = b.start_ms; rec.end_ms = b.end_ms;
  rec.starts_at = formatInstant(restaurant.timezone, b.start_ms);
  rec.ends_at = formatInstant(restaurant.timezone, b.end_ms);
}

/** The caller's reservation by reference; someone else's or unknown is 404 (no leak). */
export function ownedReservation(s: State, userId: string, reference: string): Reservation {
  const rec = s.reservations.find((r) => r.reference === reference && r.user_id === userId);
  return rec ?? notFound("no such reservation");
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
      const b = resolveBooking(restaurant, body, null);
      if (findOverlap(s, restaurant.id, b.table_id, b.start_ms, b.end_ms)) fail(409, "table_unavailable", "the table is taken for an overlapping time");
      const rec: Reservation = {
        reservation_id: newReservationId(s), reference: newReference(s), restaurant_id: restaurant.id,
        table_id: b.table_id, party_size: b.party_size, status: "confirmed", starts_at_local: b.starts_at_local,
        starts_at: "", ends_at: "", created_at: nowRfc3339(), user_id: user.id, start_ms: b.start_ms, end_ms: b.end_ms,
      };
      applyBooked(rec, restaurant, b);
      s.reservations.push(rec);
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

  router.add("POST", "/reservations/:reference/cancel", { auth: true }, (ctx) => transact((s: State) => {
    const rec = ownedReservation(s, ctx.user!.id, ctx.params.reference);
    if (rec.status === "cancelled") return { status: 200, body: toPublic(rec) };
    checkCutoff(rec, restaurantById(s, rec.restaurant_id)!, Date.now());
    rec.status = "cancelled";
    return { status: 200, body: toPublic(rec) };
  }));

  router.add("PATCH", "/reservations/:reference", { auth: true }, (ctx) => {
    const body = asObject(ctx.json());
    return transact((s: State) => {
      const rec = ownedReservation(s, ctx.user!.id, ctx.params.reference);
      const restaurant = restaurantById(s, rec.restaurant_id)!;
      checkNotCancelled(rec);
      checkCutoff(rec, restaurant, Date.now());
      checkShape(body, false, false);
      const b = resolveBooking(restaurant, body, rec);
      if (findOverlap(s, restaurant.id, b.table_id, b.start_ms, b.end_ms, rec.reference)) fail(409, "table_unavailable", "the table is taken for an overlapping time");
      applyBooked(rec, restaurant, b);
      return { status: 200, body: toPublic(rec) };
    });
  });
}
