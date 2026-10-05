// S1: the whole service state (D2: one process, in memory) and the copy-then-commit transaction helper (D6).
import { randomBytes } from "node:crypto";
import { ApiError } from "./errors.ts";
import type { HistoryEntry } from "./history.ts";
import type { Terms } from "./policies.ts";
import { formatInstant } from "./time.ts";

export const STATE_VERSION = 4;

export interface ScryptHash { algo: "scrypt"; N: number; r: number; p: number; salt: string; hash: string }
export interface User { id: string; email: string; display_name: string; password: ScryptHash; created_at: string }
export interface Table { id: string; label: string; capacity: number }
export interface OpeningHours { weekday: string; opens: string; closes: string }
/** What a booking is accepted under: a snapshot of the selected policy (policy 0 = the fixture rules), without effective_from. */
export interface Terms {
  policy_version: number; slot_minutes: number; reservation_duration_minutes: number; cancellation_cutoff_minutes: number;
  opening_hours: OpeningHours[]; capacities: Record<string, number>;
}
/** A published policy: immutable. */
export interface Policy extends Terms { effective_from: string }
export interface SeriesOccurrence { index: number; reference: string; exception: boolean }
export interface Series { series_id: string; user_id: string; restaurant_id: string; revision: number; interval_weeks: number; occurrences: SeriesOccurrence[] }
/** An applied table closure: the half-open interval [from_ms, to_ms) on one table is occupied. from/to keep the offsets as supplied. */
export interface Closure { table_id: string; from: string; to: string; from_ms: number; to_ms: number; plan_id: string }
export interface PlanAssignment { reference: string; table_ids: string[]; changed: boolean }
/** A stored replan preview. It changes nothing until applied; applying needs the restaurant revision it was made at. */
export interface Plan {
  plan_id: string; restaurant_id: string; restaurant_revision: number;
  closure: { table_id: string; from: string; to: string; from_ms: number; to_ms: number };
  assignments: PlanAssignment[]; moved_count: number; unused_seats: number; applied: boolean;
}
export interface Restaurant {
  id: string; name: string; timezone: string; slot_minutes: number;
  reservation_duration_minutes: number; cancellation_cutoff_minutes: number;
  opening_hours: OpeningHours[]; tables: Table[];
  /** Declared combinable pairs (unordered, pairs only, not transitive), table ids of this restaurant. */
  combinable: string[][];
  /** Users allowed to publish policies (stage 3). */
  manager_user_ids: string[];
  /** Published policies in publication order; policy_version = position + 1 (policy 0 is the fixture rules above). */
  policies: Policy[];
  /** Restaurant revision counter: 0 after reset; +1 per successful booking, real amendment, cancellation, policy publication, batch, adoption. */
  revision: number;
  /** Applied closures (stage 4), in application order. */
  closures: Closure[];
}
/** Public fields (what the API returns) + owner + the instants used for occupancy. */
export interface Reservation {
  reservation_id: string; reference: string; restaurant_id: string; table_ids: string[]; party_size: number;
  status: "confirmed" | "cancelled"; starts_at_local: string; starts_at: string; ends_at: string; created_at: string;
  user_id: string; start_ms: number; end_ms: number;
  /** Stage 3 (history.ts): 1 at creation; the terms accepted at the last real change; the record's own history; the series it belongs to. */
  revision: number; accepted_terms: Terms; history: HistoryEntry[]; series_id?: string;
}
/** A completed idempotent request: replayed verbatim (status 200) for the same user, method, path, body. */
export interface Receipt { method: string; path: string; key: string; user_id: string; body_canon: string; status: number; response: unknown }
export interface State {
  version: number;
  seq: { user: number; reservation: number; series?: number; plan?: number };
  users: User[];
  tokens: Record<string, string>; // bearer token -> user id
  restaurants: Restaurant[];
  reservations: Reservation[];
  series: Series[];
  plans: Plan[];
  idempotency: Record<string, Receipt>; // key from idempotencyId() in idempotency.ts
  [extra: string]: unknown;
}

export const emptyState = (): State => ({
  version: STATE_VERSION, seq: { user: 0, reservation: 0 },
  users: [], tokens: {}, restaurants: [], reservations: [], series: [], plans: [], idempotency: {},
});

let committed: State = emptyState();

/** Read-only view of the committed state. Never mutate it: write only inside transact(). */
export const read = (): State => committed;

/** Replace everything (reset / import). The caller has already built and validated `next`. */
export const replaceState = (next: State): void => { committed = next; };

/**
 * Copy-then-commit. `fn` is synchronous (no await between read and commit), receives a private draft and
 * may mutate it freely. If `fn` throws (ApiError or anything else) the draft is discarded and the committed
 * state is untouched: a failed request leaves no partial booking. Returns whatever `fn` returns.
 */
export function transact<T>(fn: (draft: State) => T): T {
  const draft = structuredClone(committed);
  const result = fn(draft);
  if (result && typeof (result as { then?: unknown }).then === "function") {
    throw new Error("transact callback must be synchronous");
  }
  committed = draft;
  return result;
}

export const restaurantById = (s: State, id: string): Restaurant | undefined => s.restaurants.find((r) => r.id === id);
export const reservationByRef = (s: State, ref: string): Reservation | undefined => s.reservations.find((r) => r.reference === ref);

/** A confirmed reservation at that restaurant holding ANY of `tableIds` (table ids are only unique within a restaurant) whose half-open interval [start_ms, end_ms) overlaps [startMs, endMs). The one occupancy predicate for singles and pairs. */
/** Stand-in returned by findOverlap when an applied closure (not a booking) holds the interval. */
export const CLOSED = { closed: true } as unknown as Reservation;

export function findOverlap(s: State, restaurantId: string, tableIds: string | string[], startMs: number, endMs: number, ignoreRef?: string): Reservation | undefined {
  const ids = typeof tableIds === "string" ? [tableIds] : tableIds;
  // An applied closure occupies its table for [from, to) exactly like a booking does.
  const rest = s.restaurants.find((r) => r.id === restaurantId);
  if (rest && (rest.closures ?? []).some((c) => ids.includes(c.table_id) && c.from_ms < endMs && startMs < c.to_ms)) return CLOSED;
  return s.reservations.find(
    (r) => r.status === "confirmed" && r.restaurant_id === restaurantId && r.reference !== ignoreRef && r.start_ms < endMs && startMs < r.end_ms
      && r.table_ids.some((t) => ids.includes(t)),
  );
}

/** The reservation as the API shows it (no owner, no internal instants). */
export function toPublic(r: Reservation) {
  return {
    reservation_id: r.reservation_id, reference: r.reference, restaurant_id: r.restaurant_id,
    ...(r.table_ids.length === 1 ? { table_id: r.table_ids[0] } : {}), table_ids: [...r.table_ids], party_size: r.party_size, status: r.status, starts_at_local: r.starts_at_local, starts_at: r.starts_at,
    ends_at: r.ends_at, created_at: r.created_at, revision: r.revision, accepted_terms: structuredClone(r.accepted_terms),
  };
}

const REF_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
/** Unique across all reservations (6 chars of A-Z0-9). */
export function newReference(s: State): string {
  const taken = new Set(s.reservations.map((r) => r.reference));
  for (;;) {
    const b = randomBytes(6);
    let ref = "";
    for (let i = 0; i < 6; i++) ref += REF_CHARS[b[i] % 36];
    if (!taken.has(ref)) return ref;
  }
}

/** `res_<n>`, unique among existing ids (fixtures may already use that shape). */
export function newReservationId(s: State): string {
  const taken = new Set(s.reservations.map((r) => r.reservation_id));
  for (;;) {
    const id = `res_${++s.seq.reservation}`;
    if (!taken.has(id)) return id;
  }
}

/** `ser_<n>`, unique among existing series. */
export function newSeriesId(s: State): string {
  const taken = new Set(s.series.map((x) => x.series_id));
  for (;;) {
    const id = `ser_${(s.seq.series = (s.seq.series ?? 0) + 1)}`;
    if (!taken.has(id)) return id;
  }
}

/** `plan_<n>`, unique among stored plans. */
export function newPlanId(s: State): string {
  const taken = new Set(s.plans.map((x) => x.plan_id));
  for (;;) {
    const id = `plan_${(s.seq.plan = (s.seq.plan ?? 0) + 1)}`;
    if (!taken.has(id)) return id;
  }
}

export function newUserId(s: State): string {
  const taken = new Set(s.users.map((u) => u.id));
  for (;;) {
    const id = `u_${++s.seq.user}`;
    if (!taken.has(id)) return id;
  }
}

export const nowRfc3339 = (): string => formatInstant("UTC", Date.now());

/** Re-export so feature code needs one import for "abort the transaction". */
export { ApiError };
