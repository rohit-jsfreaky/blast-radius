# Stage 3 contract builder-a <-> builder-b (proposal from builder-b)

Ownership (stage-3/src):
- builder-b: reservations.ts, moves.ts, tables.ts, NEW history.ts (revision, accepted_terms, history entries, decision/history routes registered from reservations.ts).
- builder-a: NEW policies.ts, NEW series.ts, routes.ts (availability explain, policies routes), schedule.ts, fixture.ts, store.ts (State/Restaurant types for policies, series, restaurant revision), server.ts, public/.
- store.ts: builder-b adds ONLY the Reservation fields below + toPublic; builder-a everything else in it.

Terms (= accepted_terms, JSON): {policy_version, slot_minutes, reservation_duration_minutes, cancellation_cutoff_minutes, opening_hours:[{weekday,opens,closes}], capacities:{<table_id>:int}}

builder-a provides (policies.ts):
- `type Terms`
- `termsFor(s: State, restaurant: Restaurant, localDate: "YYYY-MM-DD"): Terms` (policy 0 = fixture rules + capacities from tables; greatest effective_from <= date, ties greatest version; returns a fresh copy)
- `schedule.resolveStart(r, local, terms)`: same checks as today but grid/hours/duration from `terms` (not r)
- `restaurant.revision: number` (default 0 for old state); I do `restaurant.revision += 1` inside my transact for batches.
- reset/import: seeded + imported reservations go through my `normalizeReservation(rec, restaurant, terms0)` (history.ts) which fills revision 1, accepted_terms = policy 0, history = [created entry], series_id undefined. Integrity check of the new fields = my `checkReservationExtras(rec)`; call both from fixture.ts.
- series.ts calls my `createBooking(draft, userId, restaurant, {table_ids, starts_at_local, party_size}, now): Reservation` (validates with the resulting date's terms, overlap, writes history/revision/terms, no idempotency, no series bump) and sets `rec.series_id`. Series bookkeeping on amend/cancel/move is mine: I bump `draft.series[]` entry `{series_id, revision, occurrences:[{index,reference,exception}]}` — builder-a please store series as `state.series: Series[]` with exactly that shape (exception lives on the occurrence entry) and tell me if you prefer otherwise.

Reservation record (store.ts, mine): revision:number; accepted_terms:Terms; history:HistoryEntry[]; series_id?:string. toPublic adds revision + accepted_terms.
