// Owned by builder-b: atomic reservation moves. Per-item rules are exactly PATCH's (reservations.ts), applied all-or-nothing.
import { fail, notFound, validation } from "./errors.ts";
import { lookup, readKey, record } from "./idempotency.ts";
import type { Router } from "./router.ts";
import { applyBooked, checkCutoff, checkNotCancelled, checkShape, resolveBooking } from "./reservations.ts";
import { findOverlap, restaurantById, toPublic, transact } from "./store.ts";
import type { Reservation, State } from "./store.ts";
import { asObject, isObj } from "./validate.ts";
import type { Obj } from "./validate.ts";

export function register(router: Router): void {
  router.add("POST", "/reservation-moves", { auth: true }, (ctx) => {
    const user = ctx.user!;
    const key = readKey(ctx.headers);
    const body = asObject(ctx.json());
    return transact((s: State) => {
      const replay = lookup(s, user.id, ctx.method, ctx.path, key, body);
      if (replay !== null) return { status: 200, body: replay };

      const moves = body.moves;
      if (!Array.isArray(moves) || moves.length < 1 || moves.length > 8) return validation("moves must contain 1 to 8 objects");
      const items: Obj[] = [];
      const refs = new Set<string>();
      for (const m of moves) {
        if (!isObj(m) || typeof m.reference !== "string") return validation("each move needs a string reference");
        if (refs.has(m.reference)) return validation("references must be distinct");
        refs.add(m.reference);
        items.push(m);
      }
      // Existence/ownership first (404), then one restaurant (422), then each booking in input order.
      const recs: Reservation[] = items.map((m) => {
        const r = s.reservations.find((x) => x.reference === m.reference && x.user_id === user.id);
        return r ?? notFound("no such reservation");
      });
      if (recs.some((r) => r.restaurant_id !== recs[0].restaurant_id)) return validation("all bookings must belong to the same restaurant");
      const restaurant = restaurantById(s, recs[0].restaurant_id)!;
      const now = Date.now();
      const resolved = items.map((m, i) => {
        checkNotCancelled(recs[i]);
        checkCutoff(recs[i], restaurant, now);
        checkShape(m, false, false);
        return resolveBooking(restaurant, m, recs[i]);
      });
      // Apply all to the draft, then every resulting booking must be free of every other confirmed booking.
      recs.forEach((r, i) => applyBooked(r, restaurant, resolved[i]));
      for (const r of recs) {
        if (findOverlap(s, restaurant.id, r.table_id, r.start_ms, r.end_ms, r.reference)) fail(409, "table_unavailable", "the table is taken for an overlapping time");
      }
      const response = { reservations: recs.map(toPublic) };
      record(s, user.id, ctx.method, ctx.path, key, body, 201, response);
      return { status: 201, body: response };
    });
  });
}
