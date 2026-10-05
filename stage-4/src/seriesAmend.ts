// Owned by builder-b: POST /series/{series_id}/amend, a collective clock-time change of the later occurrences of a recurring agreement.
// Each real change is an ordinary amendment (reservations.ts planAmend/applyPlan); the whole operation is one transaction.
import { fail, notFound, validation } from "./errors.ts";
import { bumpRestaurant, bumpSeries } from "./history.ts";
import { lookup, readKey, record } from "./idempotency.ts";
import { applyPlan, planAmend } from "./reservations.ts";
import type { Router } from "./router.ts";
import { seriesBody } from "./series.ts";
import { findOverlap, restaurantById, transact } from "./store.ts";
import type { Reservation, State } from "./store.ts";
import { asObject, isInt } from "./validate.ts";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function register(router: Router): void {
  router.add("POST", "/series/:id/amend", { auth: true }, (ctx) => {
    const user = ctx.user!;
    const key = readKey(ctx.headers);
    const body = asObject(ctx.json());
    return transact((s: State) => {
      const replay = lookup(s, user.id, ctx.method, ctx.path, key, body);
      if (replay !== null) return { status: 200, body: replay };
      const ser = s.series.find((x) => x.series_id === ctx.params.id && x.user_id === user.id) ?? notFound("no such series");
      const { expected_revision: expected, from_index: from, local_time: time } = body;
      if (!isInt(expected) || expected < 1) validation("expected_revision must be a positive integer");
      if (!isInt(from) || from < 0 || from > ser.occurrences.length - 1) validation("from_index must be a whole number within the series");
      if (typeof time !== "string" || !HHMM.test(time)) validation("local_time must be HH:MM from 00:00 to 23:59");
      if (expected !== ser.revision) fail(409, "stale_revision", "the series changed since that revision");

      const now = Date.now();
      // Eligible: index >= from_index, still confirmed, not a diner exception. Their dates are still the scheduled ones
      // (only an individual change moves a date, and that marks the exception).
      const eligible = ser.occurrences
        .filter((o) => o.index >= (from as number) && !o.exception)
        .sort((a, b) => a.index - b.index)
        .map((o) => s.reservations.find((r) => r.reference === o.reference) as Reservation)
        .filter((r) => r.status === "confirmed");
      // Non-occupancy errors first, in index order; plans are pure so nothing is touched yet.
      const plans = eligible.map((rec) => {
        const restaurant = restaurantById(s, rec.restaurant_id)!;
        return planAmend(s, rec, restaurant, { starts_at_local: `${rec.starts_at_local.slice(0, 10)}T${time}` }, now);
      });
      const changed: Reservation[] = [];
      plans.forEach((p, i) => {
        if (p === null) return;
        applyPlan(eligible[i], restaurantById(s, eligible[i].restaurant_id)!, p, now);
        changed.push(eligible[i]);
      });
      // Occupancy: each changed booking against every other confirmed booking (changed ones are already applied) and every applied closure.
      for (const r of changed) {
        if (findOverlap(s, r.restaurant_id, r.table_ids, r.start_ms, r.end_ms, r.reference)) fail(409, "table_unavailable", "the table is taken for an overlapping time");
      }
      if (changed.length > 0) {
        bumpRestaurant(restaurantById(s, ser.restaurant_id)!);
        bumpSeries(s, changed.map((rec) => ({ rec, exception: false })));
      }
      const response = seriesBody(s, ser);
      record(s, user.id, ctx.method, ctx.path, key, body, 201, response);
      return { status: 201, body: response };
    });
  });
}
