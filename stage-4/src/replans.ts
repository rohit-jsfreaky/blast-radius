// Seating changes after a table closure (stage 4): preview the best reassignment, then apply it atomically.
// The preview is an EXACT lexicographic optimum of (bookings moved, unused seats, option-rank vector) found by exhaustive search (F23).
import { fail, forbidden, notFound, validation } from "./errors.ts";
import { bumpRestaurant, bumpSeries, reassignBooking } from "./history.ts";
import { lookup, readKey, record } from "./idempotency.ts";
import type { Router } from "./router.ts";
import { newPlanId, restaurantById, toPublic, transact } from "./store.ts";
import type { Plan, PlanAssignment, Reservation, Restaurant, State } from "./store.ts";
import { allOptions } from "./tables.ts";
import { parseDate } from "./time.ts";
import { asObject, reqString } from "./validate.ts";

export const MAX_TABLES = 6;
export const MAX_PAIRS = 4;
export const MAX_CONSIDERED = 6;

const INSTANT = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(\.\d{1,9})?(Z|[+-]([01]\d|2[0-3]):([0-5]\d))$/;

/** An RFC 3339 instant WITH an explicit offset -> epoch ms, or null when it is not one. */
export function parseInstant(v: string): number | null {
  const m = INSTANT.exec(v);
  if (!m) return null;
  const d = parseDate(m[1]);
  if (!d) return null;
  const frac = m[5] ? Math.floor(Number(`0${m[5]}`) * 1000) : 0;
  const off = m[6] === "Z" ? 0 : (m[6][0] === "-" ? -1 : 1) * (Number(m[7]) * 60 + Number(m[8]));
  const base = new Date(Date.UTC(2000, d.mo - 1, d.d, Number(m[2]), Number(m[3]), Number(m[4])));
  base.setUTCFullYear(d.y);
  return base.getTime() + frac - off * 60_000;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const overlapsTime = (a: { start_ms: number; end_ms: number }, b: { start_ms: number; end_ms: number }) => a.start_ms < b.end_ms && b.start_ms < a.end_ms;

interface Cand { rank: number; ids: string[]; unused: number }

/**
 * The best feasible assignment for `considered` (sorted by reference), or null. Candidates per booking: every single table
 * then every declared pair (rank = position in that list), capacity from the booking's OWN accepted terms, never the closed
 * table, never conflicting with fixed bookings or applied closures; assignments may not clash with each other.
 */
export function bestPlan(s: State, r: Restaurant, closedTable: string, considered: Reservation[]): { picks: Cand[]; moved: number; unused: number } | null {
  const options = allOptions(r);
  const consideredRefs = new Set(considered.map((c) => c.reference));
  const fixed = s.reservations.filter((x) => x.status === "confirmed" && x.restaurant_id === r.id && !consideredRefs.has(x.reference));
  const cands: Cand[][] = considered.map((b) =>
    options.flatMap((o, rank) => {
      const cap = o.table_ids.reduce((n, id) => n + (b.accepted_terms.capacities[id] ?? 0), 0);
      if (cap < b.party_size || o.table_ids.includes(closedTable)) return [];
      if (fixed.some((f) => overlapsTime(f, b) && f.table_ids.some((t) => o.table_ids.includes(t)))) return [];
      if (r.closures.some((c) => o.table_ids.includes(c.table_id) && c.from_ms < b.end_ms && b.start_ms < c.to_ms)) return [];
      return [{ rank, ids: [...o.table_ids], unused: cap - b.party_size }];
    }));
  let best: { picks: Cand[]; moved: number; unused: number } | null = null;
  const cur: Cand[] = [];
  const better = (moved: number, unused: number): boolean => {
    if (!best) return true;
    if (moved !== best.moved) return moved < best.moved;
    if (unused !== best.unused) return unused < best.unused;
    for (let i = 0; i < cur.length; i++) if (cur[i].rank !== best.picks[i].rank) return cur[i].rank < best.picks[i].rank;
    return false;
  };
  const go = (i: number, moved: number, unused: number): void => {
    if (best && moved > best.moved) return;
    if (i === considered.length) {
      if (better(moved, unused)) best = { picks: [...cur], moved, unused };
      return;
    }
    for (const c of cands[i]) {
      let clash = false;
      for (let j = 0; j < i && !clash; j++) clash = overlapsTime(considered[j], considered[i]) && cur[j].ids.some((t) => c.ids.includes(t));
      if (clash) continue;
      cur[i] = c;
      go(i + 1, moved + (sameSet(c.ids, considered[i].table_ids) ? 0 : 1), unused + c.unused);
    }
    cur.length = i;
  };
  go(0, 0, 0);
  return best;
}

export function registerReplanRoutes(router: Router): void {
  router.add("POST", "/restaurants/:id/replans", { auth: true }, (ctx) => {
    const user = ctx.user!;
    const key = readKey(ctx.headers);
    const body = asObject(ctx.json());
    return transact((s: State) => {
      const replay = lookup(s, user.id, ctx.method, ctx.path, key, body);
      if (replay !== null) return { status: 200, body: replay };
      const r = restaurantById(s, ctx.params.id) ?? notFound("no such restaurant");
      if (!r.manager_user_ids.includes(user.id)) forbidden("only a manager of this restaurant may plan seating changes");
      const tableId = reqString(body, "table_id");
      const from = reqString(body, "from"), to = reqString(body, "to");
      const fromMs = parseInstant(from), toMs = parseInstant(to);
      if (fromMs === null || toMs === null) validation("from and to must be RFC 3339 instants with an explicit offset");
      if ((fromMs as number) >= (toMs as number)) validation("from must be earlier than to");
      if (!r.tables.some((t) => t.id === tableId)) notFound("no such table at this restaurant");
      const considered = s.reservations
        .filter((x) => x.status === "confirmed" && x.restaurant_id === r.id && x.start_ms < (toMs as number) && (fromMs as number) < x.end_ms)
        .sort((a, b) => (a.reference < b.reference ? -1 : a.reference > b.reference ? 1 : 0));
      if (r.tables.length > MAX_TABLES || r.combinable.length > MAX_PAIRS || considered.length > MAX_CONSIDERED) {
        fail(422, "planning_limit", "too many tables, pairs or affected bookings to plan");
      }
      const found = bestPlan(s, r, tableId, considered);
      if (!found) fail(409, "no_feasible_plan", "no seating arrangement keeps every affected booking");
      const assignments: PlanAssignment[] = considered.map((b, i) => ({
        reference: b.reference, table_ids: found!.picks[i].ids, changed: !sameSet(found!.picks[i].ids, b.table_ids),
      }));
      const plan: Plan = {
        plan_id: newPlanId(s), restaurant_id: r.id, restaurant_revision: r.revision,
        closure: { table_id: tableId, from, to, from_ms: fromMs as number, to_ms: toMs as number },
        assignments, moved_count: found!.moved, unused_seats: found!.unused, applied: false,
      };
      s.plans.push(plan);
      const response = {
        plan_id: plan.plan_id, restaurant_revision: plan.restaurant_revision,
        closure: { table_id: tableId, from, to }, assignments, moved_count: plan.moved_count, unused_seats: plan.unused_seats,
      };
      record(s, user.id, ctx.method, ctx.path, key, body, 201, response);
      return { status: 201, body: response };
    });
  });

  router.add("POST", "/restaurants/:id/replans/:plan_id/apply", { auth: true }, (ctx) => {
    const user = ctx.user!;
    const key = readKey(ctx.headers);
    const body = asObject(ctx.json());
    return transact((s: State) => {
      const replay = lookup(s, user.id, ctx.method, ctx.path, key, body);
      if (replay !== null) return { status: 200, body: replay };
      const r = restaurantById(s, ctx.params.id) ?? notFound("no such restaurant");
      if (!r.manager_user_ids.includes(user.id)) forbidden("only a manager of this restaurant may apply seating changes");
      const plan = s.plans.find((p) => p.plan_id === ctx.params.plan_id && p.restaurant_id === r.id) ?? notFound("no such plan");
      if (plan.applied) fail(409, "plan_already_applied", "this plan was already applied");
      if (plan.restaurant_revision !== r.revision) fail(409, "stale_plan", "the restaurant changed since this plan was made");
      const now = Date.now();
      const moved: Reservation[] = [];
      for (const a of plan.assignments) {
        const rec = s.reservations.find((x) => x.reference === a.reference) as Reservation;
        if (!a.changed) continue;
        reassignBooking(rec, r, a.table_ids, plan.plan_id, now);
        moved.push(rec);
      }
      r.closures.push({ table_id: plan.closure.table_id, from: plan.closure.from, to: plan.closure.to, from_ms: plan.closure.from_ms, to_ms: plan.closure.to_ms, plan_id: plan.plan_id });
      plan.applied = true;
      bumpRestaurant(r);
      bumpSeries(s, moved.map((rec) => ({ rec, exception: false })));
      const response = {
        plan_id: plan.plan_id, restaurant_revision: r.revision,
        reservations: plan.assignments.map((a) => toPublic(s.reservations.find((x) => x.reference === a.reference) as Reservation)),
      };
      record(s, user.id, ctx.method, ctx.path, key, body, 201, response);
      return { status: 201, body: response };
    });
  });
}
