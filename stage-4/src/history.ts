// S15: a reservation's revision, accepted terms and own history, and the series bookkeeping that follows every real change.
// One place writes history, so create, amend, cancel and moves cannot diverge (F: history, revision, atomicity).
import type { Terms } from "./policies.ts";
import type { Reservation, Restaurant, State } from "./store.ts";
import { formatInstant } from "./time.ts";
import { isInt, isObj } from "./validate.ts";

export interface HistoryChange { field: string; from: unknown; to: unknown }
export interface HistoryEntry {
  seq: number; at: string; event: "created" | "changed" | "cancelled" | "reassigned"; changes: HistoryChange[]; plan_id?: string;
  revision: number; accepted_terms: Terms;
}

/** The bookable fields a history entry compares. */
export interface Fields { table_ids: string[]; starts_at_local: string; party_size: number }

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** `table_id` for single-to-single, `table_ids` (complete lists) when either side is a pair. */
function tableChange(from: string[] | null, to: string[]): HistoryChange {
  if ((from === null || from.length === 1) && to.length === 1) return { field: "table_id", from: from === null ? null : from[0], to: to[0] };
  return { field: "table_ids", from: from === null ? null : [...from], to: [...to] };
}

export function createdChanges(f: Fields): HistoryChange[] {
  return [tableChange(null, f.table_ids), { field: "starts_at_local", from: null, to: f.starts_at_local }, { field: "party_size", from: null, to: f.party_size }];
}

/** Only the fields that differ, in the order table, starts_at_local, party_size. Empty = a no-op amendment. */
export function diffFields(a: Fields, b: Fields): HistoryChange[] {
  const out: HistoryChange[] = [];
  if (!sameSet(a.table_ids, b.table_ids)) out.push(tableChange(a.table_ids, b.table_ids));
  if (a.starts_at_local !== b.starts_at_local) out.push({ field: "starts_at_local", from: a.starts_at_local, to: b.starts_at_local });
  if (a.party_size !== b.party_size) out.push({ field: "party_size", from: a.party_size, to: b.party_size });
  return out;
}

/** Append the entry for the record's CURRENT revision and terms (callers bump revision / replace terms first). */
export function pushHistory(rec: Reservation, restaurant: Restaurant, event: HistoryEntry["event"], changes: HistoryChange[], nowMs: number, planId?: string): void {
  rec.history.push({
    seq: rec.history.length + 1, at: formatInstant(restaurant.timezone, nowMs), event, changes, ...(planId === undefined ? {} : { plan_id: planId }),
    revision: rec.revision, accepted_terms: structuredClone(rec.accepted_terms),
  });
}

interface SeriesLike { series_id: string; revision: number; occurrences: Array<{ index: number; reference: string; exception: boolean }> }

/**
 * Series bookkeeping: each affected series gains ONE revision per operation; an occurrence listed in `exceptions`
 * becomes a permanent exception. Cancel passes no exceptions. Records outside any series are ignored.
 */
export function bumpSeries(s: State, touched: Array<{ rec: Reservation; exception: boolean }>): void {
  const list = (s as { series?: SeriesLike[] }).series;
  if (!Array.isArray(list)) return;
  const done = new Set<string>();
  for (const { rec, exception } of touched) {
    if (!rec.series_id) continue;
    const ser = list.find((x) => x.series_id === rec.series_id);
    if (!ser) continue;
    if (exception) {
      const occ = ser.occurrences.find((o) => o.reference === rec.reference);
      if (occ) occ.exception = true;
    }
    if (!done.has(ser.series_id)) { ser.revision += 1; done.add(ser.series_id); }
  }
}

/**
 * Reset/import: fill the stage-3 fields of a reservation that lacks them (stage-1/2 exports, seeded fixtures):
 * revision 1 under policy 0, and a history of one `created` entry. Existing values are kept.
 */
export function normalizeReservation(rec: Reservation, restaurant: Restaurant, terms0: Terms): void {
  if (rec.revision === undefined) rec.revision = 1;
  if (rec.accepted_terms === undefined) rec.accepted_terms = structuredClone(terms0);
  if (rec.history === undefined) {
    const at = Date.parse(rec.created_at);
    rec.history = [];
    pushHistory(rec, restaurant, "created", createdChanges({ table_ids: rec.table_ids, starts_at_local: rec.starts_at_local, party_size: rec.party_size }), Number.isNaN(at) ? Date.now() : at);
  }
}

/** Integrity of the stage-3 fields (reset and import both): throws a message string via `bad`. */
export function checkReservationExtras(rec: Reservation, bad: (m: string) => never): void {
  if (!isInt(rec.revision) || rec.revision < 1) bad("reservation revision must be a positive integer");
  const t = rec.accepted_terms as unknown;
  if (!isObj(t) || !isInt(t.policy_version) || !isInt(t.slot_minutes) || !isInt(t.reservation_duration_minutes) || !isInt(t.cancellation_cutoff_minutes)
    || !Array.isArray(t.opening_hours) || !isObj(t.capacities)) bad("reservation accepted_terms is invalid");
  if (!Array.isArray(rec.history) || rec.history.length === 0) bad("reservation history must not be empty");
  rec.history.forEach((h, i) => {
    if (!isObj(h) || h.seq !== i + 1 || typeof h.at !== "string" || !["created", "changed", "cancelled", "reassigned"].includes(h.event as string)
      || !Array.isArray(h.changes) || !isInt(h.revision) || !isObj(h.accepted_terms)) bad("reservation history entry is invalid");
  });
  if (rec.history[0].event !== "created") bad("reservation history must start with created");
}

/** The restaurant's revision counter (+1 per successful booking, real amendment and first cancel; once per move batch with a real change). */
export function bumpRestaurant(restaurant: Restaurant): void {
  const r = restaurant as Restaurant & { revision?: number };
  r.revision = (r.revision ?? 0) + 1;
}

/**
 * Seating repair (replan apply): the booking keeps its times and accepted terms; only its table set moves.
 * Revision +1 once, one `reassigned` entry with a complete `table_ids` change and the plan id. The caller bumps the restaurant
 * once per plan and calls bumpSeries(..., exception false) once for all moved members (exception flags are preserved).
 */
export function reassignBooking(rec: Reservation, restaurant: Restaurant, tableIds: string[], planId: string, nowMs: number): void {
  const from = [...rec.table_ids];
  rec.table_ids = [...tableIds];
  rec.revision += 1;
  pushHistory(rec, restaurant, "reassigned", [{ field: "table_ids", from, to: [...tableIds] }], nowMs, planId);
}
