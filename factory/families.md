# Families — rules that apply in many places

Written by @investigator at each stage start, and extended by every closed incident card.

<!-- One block per family:
## F<n> — <the rule in one sentence>
quotes: "<requirement text>" (L ids) ...
places: <every surface the rule applies to, with stage>
shared code: <S id that implements it, once one exists>
cards: <INC ids born in this family>
-->

# Stage 1 family map (investigator, stage-1 start)

## F1 — Local wall-clock ↔ instant conversion follows the restaurant's IANA zone: skipped times do not exist, repeated times resolve to the FIRST occurrence, durations are absolute minutes, offsets per zone and date.
quotes: "`starts_at_local` is wall-clock at the restaurant, with no offset and no `Z`. Resolve it against the restaurant's `timezone`." · "Always resolve to the first occurrence — the one before the clocks change." · "`reservation_duration_minutes` is **absolute time**, not wall-clock." · "Offsets must follow the IANA rules for the specified zone and date." · "Timestamps in responses are RFC 3339 with an explicit offset"
places (s1): GET /availability slot generation (skip nonexistent, repeated slot appears once, `starts_at` offset); POST /reservations resolve + 422 invalid_local_time; PATCH starts_at_local; reservation-moves starts_at_local; `ends_at` = start + absolute minutes rendered in local offset; `created_at` RFC 3339; seeded reservations in reset fixture; weekday of a local date (opening_hours lookup); slot grid anchored at `opens` local.
places (later): s2 combination availability; s3 policy selection by **local start date**, series occurrence dates (+i×7 days local, invalid_local_time rejects whole adoption), history `at`; s4 replan `from`/`to` instants with offsets, series amend local_time.
shared code: time module (D4) — to be declared S<n>.

## F2 — Occupancy is the half-open interval [start, start+duration) and no table may be held by two overlapping confirmed bookings, checked against every confirmed booking (seeded, created, amended, moved), never against cancelled ones.
quotes: "Two `confirmed` reservations must never occupy the same table at overlapping times, including during concurrent requests." · "Occupancy is the half-open interval `[starts_at, starts_at + reservation_duration)`." · "no overlapping confirmed reservation" · "Frees the table immediately"
places (s1): availability `available_table_ids`; POST create 409 table_unavailable; PATCH (must exclude the booking itself, release old + reserve new together); moves (overlap among resulting bookings AND with unlisted bookings; unchanged listed retain occupancy); cancel frees; seeded fixture reservations count.
places (later): s2 pairs occupy both tables, `available_options`; s3 explain `no_overlap`, per-booking duration from accepted terms (not current config); s4 closures behave as occupancy, replan conflicts.
shared code: occupancy/overlap helper (to be declared S<n>).

## F3 — Idempotent writes: per-user key, replay = same user+method+path+parsed-JSON body → 200 with the original body; different body → 409; failed 4xx keys are reusable; resolved after parse+auth, before validation; exactly one effect under concurrency; replay survives later changes and export/import.
quotes: "The key is scoped to **the authenticated user**." · "A replay means the same user sending the **same method, the same path and the same body**." · "idempotency is resolved before endpoint-specific field validation or current-resource checks" · "Key reused after the original request failed with 4xx | Treated as a first use" · "For concurrent identical requests with an unused key, exactly one returns 201." · "A successful replay returns the original response, even after the resource changes or is cancelled."
places (s1): POST /reservations; POST /reservation-moves; export/import of receipts.
places (later): s3 POST /restaurants/{id}/policies, POST /series; s4 POST replans, POST replans/{id}/apply (plus 409 plan_already_applied under other key), POST /series/{id}/amend. Every new idempotent path must reuse one shared helper with the path in the key.
shared code: idempotency module (to be declared S<n>).

## F4 — One error shape and one status/code precedence everywhere: 400 malformed_request only for unparseable body or wrong JSON type; 422 validation_failed for missing/invalid values; endpoint-specific codes take precedence; never 5xx.
quotes: "Every 4xx and 5xx response carries this body" · "Reserve 400 `malformed_request` for a body that does not parse or a field of the wrong type." · "invalid `party_size` values (including strings and booleans) ... are 422 `validation_failed`" · "An integer-valued **query parameter** is written as plain decimal digits" · "Requests must not produce 5xx responses, including under concurrent load."
places (s1): every endpoint incl. 404 for unknown routes, 401s, reset/import 422; body that is valid JSON but not an object; party_size special-case on create/PATCH/moves; query `party_size` digits-only on availability; date validity (`2026-02-30`).
places (later): s3 explain=true only, policy fields 1..1440 / 0..10080, booleans-not-integers; s3 series count/interval; s4 replan interval, series amend fields.
shared code: errors + validation module (to be declared S<n>).

## F5 — Auth and ownership: bearer required except the named public endpoints; another user's resource is 404 (not 403) and never leaks existence.
quotes: "Every other endpoint requires a bearer token, except `/health`, `/_test/reset`, the two above, and the three public endpoints" · "**404 if it is not the caller's** — do not leak the existence of other people's bookings." · "Unknown/another owner's reference gives 404 `not_found`"
places (s1): GET/cancel/PATCH reservation by reference, GET /reservations list (only caller's), moves; export/import/reset unauthenticated; malformed `Authorization` header → 401.
places (later): s3 history/decision (404 even without auth — exception), series GET, policies 403 for non-manager; s4 replans manager-only, series amend owner-only.

## F6 — Atomicity: a rejected or failed write changes nothing (no partial booking, no consumed key, no counter); multi-item writes are all-or-nothing.
quotes: "Retries and rejected requests must not create duplicate or partial bookings." · "A failed amendment leaves the original booking and its occupancy unchanged." · "Either every move commits or nothing changes: occupancy, reservation records and retry keys." · "atomically replaces the service's state" · "without changing the destination"
places (s1): create, PATCH, moves, import (422 must not change destination), reset.
places (later): s3 policy (no version allocated), series adoption (no partial series/counters/claims), history entries; s4 plan apply, series amend, revision counters.
shared code: copy-then-commit transaction (D6).

## F7 — Cutoff rule: an existing booking cannot be cancelled or changed when now ≥ starts_at − cutoff, measured against the CURRENT start, real clock "now", independent of past-start bookings being creatable.
quotes: "A booking cannot be cancelled or changed within this many minutes of its start" · "Now is within `cancellation_cutoff_minutes` of `starts_at`, or later" · "measured against the **current** start time" · "Each booking's existing cutoff applies." · "A booking must not be rejected solely because its start is in the past"
places (s1): cancel (but already-cancelled → 200 first?), PATCH, each move item (cutoff errors precede other changes for that booking); create must NOT apply cutoff.
places (later): s3 accepted-terms cutoff, series anchor; s4 series amend (old accepted cutoff); s4 replan explicitly ignores cutoff.

## F8 — Reservation response shape is one shape everywhere (create, replay, get, list, cancel, PATCH, moves, import) with RFC 3339 offsets and a stable reference/reservation_id that never changes.
quotes: "each entry has the same shape as the create response" · "`reference` is 6 to 12 characters of `A-Z0-9`, unique across all reservations, and never changes." · "`reference` and `reservation_id` survive a change." · "The booking's identity, owner and creation time never change."
places (s1): create, GET one, list (starts_at descending), cancel, PATCH, moves results, seeded reservations (fixture-supplied id/reference/user_id kept).
places (later): s2 table_ids/table_id conditional; s3 revision + accepted_terms; series occurrences.
shared code: one reservation serializer (to be declared S<n>).

## F9 — Bookability validation is identical for every path that puts a booking on a time/table: slot grid from opens, opening hours incl. end ≤ closes, capacity, invalid local time, restaurant/table membership.
quotes: "Validation is identical to `POST /reservations`" · "Each item accepts the ordinary PATCH fields" · "Non-occupancy errors use ordinary amendment codes and take precedence in input order"
places (s1): create, PATCH (merged fields), moves (per item), availability (same rule decides which slots exist), seeded reservations.
places (later): s2 pairs (combination_not_allowed, summed capacity); s3 per-date policy; series occurrences; s4 series amend.
shared code: one validateBooking (to be declared S<n>).

## F10 — State durability across export/import/reset: everything (users+hashes, tokens, fixture config, reservations, references, ids, timestamps, idempotency receipts incl. move batches) round-trips; reset/import replace, never merge; older-stage exports must load.
quotes: "Preserve accounts and hashed-password login, existing bearer tokens, fixture configuration, reservations, references, all completed idempotent request bodies and original responses." · "Identities, statuses and timestamps must not be regenerated." · "Import removes all previous destination data and credentials." · "Export/import preserves successful batch receipts as well as the resulting bookings."
places (s1): export, import, reset; any counter used to mint ids/references (must not collide after import).
places (later): s2 accepts s1 export; s3 accepts s1/s2 (policies, revisions, history, series default); s4 accepts s1–s3 (plans, closures, restaurant_revision).

## F11 — Opaque-ID limit of 64 characters applies to every ID, including fixture-supplied ones.
quotes: "IDs are opaque strings of at most 64 characters." · "This limit also applies to IDs supplied in reset fixtures."
places (s1): reset fixture user/restaurant/table/reservation ids (reject > 64 → 422?), generated reservation_id, token, path params.

# RISK list (stage 1)
- RISK F1 | first-occurrence + skipped-hour | availability, create, PATCH, moves each convert separately unless one time module is used; ends_at must be absolute (fall-back 01:30+90 → 02:00).
- RISK F2 | PATCH/moves must ignore the booking's own old occupancy but count unlisted bookings and seeded ones.
- RISK F3 | idempotency must key on user+method+path+parsed body for BOTH create and moves, resolve before validation, not store on 4xx.
- RISK F4 | 400 vs 422 split differs per endpoint (party_size string → 422; other wrong types → 400; query ints digits only).
- RISK F6 | moves and import must be all-or-nothing including retry keys.
- RISK F7 | cutoff applies to cancel/PATCH/move items but NOT to create of a past start.
- RISK F10 | reference/id counters must not collide with imported or seeded references.
# Carried toward stages 2–4
- RISK F1 | s3 policy by local start date; series +i weeks local; s4 replan instants.
- RISK F2 | s2 pairs occupy both tables; s3 duration from accepted terms; s4 closures as occupancy.
- RISK F3 | s3 policies, series; s4 replans, apply, series amend — five new idempotent paths.
- RISK F6/F10 | s3/s4 revision counters, history and series must be atomic and survive import of older-stage state.
