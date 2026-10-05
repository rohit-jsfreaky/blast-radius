// Recurring reservations (stage 3): POST /series adopts a confirmed booking as occurrence 0 and books the rest, all or nothing.
// Per-booking bookkeeping after adoption (series revision, exception flags) lives in history.ts bumpSeries().
import { fail, notFound, validation } from "./errors.ts";
import { authenticate } from "./auth.ts";
import { lookup, readKey, record } from "./idempotency.ts";
import { createBooking } from "./reservations.ts";
import type { Router } from "./router.ts";
import { newSeriesId, read, restaurantById, toPublic, transact } from "./store.ts";
import type { Reservation, Series, State } from "./store.ts";
import { parseLocal } from "./time.ts";
import { asObject, isInt, reqString } from "./validate.ts";

const p2 = (n: number) => String(n).padStart(2, "0");

/** The anchor's local date + `days`, same clock time: `YYYY-MM-DDTHH:MM` (pure calendar arithmetic, no zone involved). */
export function shiftLocal(local: string, days: number): string {
  const p = parseLocal(local)!;
  const d = new Date(Date.UTC(2000, p.mo - 1, p.d));
  d.setUTCFullYear(p.y);
  d.setUTCDate(d.getUTCDate() + days);
  return `${String(d.getUTCFullYear()).padStart(4, "0")}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T${p2(p.h)}:${p2(p.mi)}`;
}

/** Series shape returned by create and by GET: current reservation states, occurrences in index order. */
export function seriesBody(s: State, ser: Series) {
  return {
    series_id: ser.series_id, revision: ser.revision, interval_weeks: ser.interval_weeks,
    occurrences: ser.occurrences.map((o) => {
      const rec = s.reservations.find((r) => r.reference === o.reference) as Reservation;
      return { index: o.index, reference: o.reference, exception: o.exception, reservation: toPublic(rec) };
    }),
  };
}

export function registerSeriesRoutes(router: Router): void {
  router.add("POST", "/series", { auth: true }, (ctx) => {
    const user = ctx.user!;
    const key = readKey(ctx.headers);
    const body = asObject(ctx.json());
    return transact((s: State) => {
      const replay = lookup(s, user.id, ctx.method, ctx.path, key, body);
      if (replay !== null) return { status: 200, body: replay };
      const anchorRef = reqString(body, "anchor_reference");
      const count = body.count, interval = body.interval_weeks;
      if (count === undefined || count === null) validation("count is required");
      if (!isInt(count) || count < 2 || count > 12) validation("count must be a whole number from 2 to 12");
      if (interval === undefined || interval === null) validation("interval_weeks is required");
      if (!isInt(interval) || interval < 1 || interval > 4) validation("interval_weeks must be a whole number from 1 to 4");
      const anchor = s.reservations.find((r) => r.reference === anchorRef && r.user_id === user.id) ?? notFound("no such reservation");
      if (anchor.status === "cancelled") fail(409, "reservation_cancelled", "the anchor reservation is cancelled");
      if (anchor.series_id) fail(409, "already_in_series", "that reservation already belongs to a series");
      const restaurant = restaurantById(s, anchor.restaurant_id)!;
      // The anchor must still be changeable under the terms it was accepted with.
      if (Date.now() >= anchor.start_ms - anchor.accepted_terms.cancellation_cutoff_minutes * 60_000) fail(409, "cutoff_passed", "too close to the start to adopt this booking");
      const seriesId = newSeriesId(s);
      const refs = [anchor.reference];
      for (let i = 1; i < (count as number); i++) {
        const local = shiftLocal(anchor.starts_at_local, i * (interval as number) * 7);
        // Ordinary booking rules for that date: its own policy, hours, DST, capacity and occupancy. The first failure (index order) aborts everything.
        const rec = createBooking(s, restaurant, user.id, { table_ids: [...anchor.table_ids], party_size: anchor.party_size, starts_at_local: local }, Date.now());
        rec.series_id = seriesId;
        refs.push(rec.reference);
      }
      anchor.series_id = seriesId;
      const ser: Series = {
        series_id: seriesId, user_id: user.id, restaurant_id: restaurant.id, revision: 1, interval_weeks: interval as number,
        occurrences: refs.map((reference, index) => ({ index, reference, exception: false })),
      };
      s.series.push(ser);
      restaurant.revision += 1;
      const response = seriesBody(s, ser);
      record(s, user.id, ctx.method, ctx.path, key, body, 201, response);
      return { status: 201, body: response };
    });
  });

  // Owner only; everyone else, signed in or not, gets the same 404.
  router.add("GET", "/series/:id", { auth: false }, (ctx) => {
    let userId: string | null = null;
    try { userId = authenticate(ctx.headers).id; } catch { userId = null; }
    const s = read();
    const ser = s.series.find((x) => x.series_id === ctx.params.id && x.user_id === userId);
    if (!ser) return notFound("no such series");
    return { status: 200, body: seriesBody(s, ser) };
  });
}
