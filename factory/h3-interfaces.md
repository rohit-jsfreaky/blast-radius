# Stage 3 interfaces between builder-a and builder-b (written by builder-a, rev follows in the room)

Files. builder-a: stage-3/src/{policies.ts, series.ts, store.ts (types+counters), schedule.ts, fixture.ts, routes.ts (availability/explain/export/import), server.ts, public/**}.
builder-b: reservations.ts, moves.ts, tables.ts, history.ts (new).

## Data model (store.ts, builder-a, committed first)
- `Terms` = { policy_version, slot_minutes, reservation_duration_minutes, cancellation_cutoff_minutes, opening_hours, capacities: {tableId: n} }  (a snapshot of the selected policy WITHOUT effective_from; policy 0 = fixture config + table capacities).
- `Restaurant` gains `manager_user_ids: string[]`, `policies: Policy[]` (published order; Policy = Terms + effective_from), `revision: number` (restaurant revision counter, 0 after reset).
- `Reservation` gains `revision` (1 at creation), `accepted_terms: Terms`, `history: HistoryEntry[]`, `series_id: string|null`, `series_index: number|null`, `exception: boolean`.
- `HistoryEntry` = { seq, at, event: "created"|"changed"|"cancelled", changes: [{field, from, to}], revision, accepted_terms }.
- `State.series: Series[]` = { series_id, user_id, restaurant_id, revision, interval_weeks, references: string[] } (occurrence i = references[i]).
- `bumpRestaurantRevision(s, restaurantId)`: call ONCE per successful write (create, real amend, cancel, moves batch). Series adoption bumps once for the whole adoption (createBooking must not bump).

## builder-a provides (policies.ts / schedule.ts)
- `policyFor(restaurant, "YYYY-MM-DD"): Terms` — greatest effective_from <= date, ties greatest version, policy 0 before any.
- `resolveStart(restaurant, local): {start_ms, end_ms, terms}` — now uses the policy of the local start date (duration, grid, hours); end = start + terms duration.
- `capacityOf(terms, tableIds): number` (sum of terms.capacities).
- series.ts: `markException(s, rec)` (sets rec.exception, bumps its series revision once) and `bumpSeries(s, seriesId)` for cancel; for moves collect the affected series ids in a Set and call bumpSeries once each, and set rec.exception=true on each really-changed occurrence (never for cancel).

## builder-b provides
- tables.ts: take `terms` (capacities) instead of restaurant.tables capacity: `allOptions(r, terms)`, `freeOptions(s, r, party, startMs, endMs, terms)`, `setCapacity(terms, ids)`. (builder-a calls freeOptions from availability with the slot date's terms.)
- reservations.ts: export `createBooking(s, restaurant, userId, {table_ids, party_size, starts_at_local}, nowMs): Reservation` — full ordinary booking incl. policy, overlap, revision 1, accepted_terms, history `created` entry; pushes onto s.reservations; does NOT record idempotency and does NOT bump the restaurant revision. Used by series for occurrences 1..n-1 (party size and table_ids taken from the anchor). Errors are the ordinary booking errors.
- history.ts: `createdEntry(rec)` for seeded reservations (builder-a's fixture.ts calls it), `appendHistory(...)`.
- reservations.ts/moves.ts: revision, accepted_terms, history, GET history/decision, expected_revision, stale_revision, cutoff on OLD accepted terms, restaurant revision bump, series hooks above.
