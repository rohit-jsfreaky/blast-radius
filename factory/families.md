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

# Stage 2 family map (investigator, stage-2 start)

## Stage-1 families extended by stage 2
- F1 time: UI shows local times (`slot-{table}-{HH:MM}`, booking-summary, confirmation-details) — must use `starts_at_local`, never browser-zone conversion of `starts_at`; DST days in the grid (skipped/repeated hour) must render one cell per slot.
- F2 occupancy: a booking occupies EVERY table in its set; overlap check, availability (`available_table_ids` and `available_options`), cancel ("Cancelling frees every table in the set"), PATCH self-exclusion, moves ("No table may belong to overlapping resulting bookings"), seeded pairs, reset/import integrity check (INC-1 checkIntegrity).
- F3 idempotency: browser retry must reuse the same key AND same body; changing a field mints a new key; pending key survives export/import.
- F4 errors: new codes `combination_not_allowed` (unlisted pair, >2 tables), 422 for both `table_id`+`table_ids`, duplicate ids in the set → 422 `validation_failed`; wrong JSON type of `table_ids` → 400.
- F5 auth: browser token survives export/import ("A browser signed in before that export/import upgrade must remain signed in"); `current-user` on every screen.
- F6 atomicity: pair booking takes both tables or neither; moves with pairs all-or-nothing.
- F8 response shape: always `table_ids`; `table_id` only when the set has exactly one member — on create, replay, GET, list, cancel, PATCH, moves, seeded and imported stage-1 bookings.
- F9 bookability: capacity = sum of pair; pair must be in `combinable` (unordered); same rules on create, PATCH, moves, seeds.
- F10 durability: stage-1 export → stage-2 import (missing `combinable` = [], missing `table_ids` = [table_id], stage-1 receipts replay byte-identical — a stage-1 replay must not gain `table_ids` if the original lacked it).

## F12 — A booking holds a table SET of one or two members; every surface that reads or writes a table handles the set (single = set of one), with pair order = `combinable` order.
quotes: "`table_id` is still accepted and means a set of one." · "Responses always carry `table_ids`." · "`table_ids` within a pair is in `combinable` order." · "Each entry is an unordered pair of table ids in that restaurant. **Pairs only**" · "Combining is not transitive"
places: availability options; create; PATCH; cancel; moves; seeded reservations (`table_id` or `table_ids`); import; UI combination cells `slot-{t_a}+{t_b}-{HH:MM}`, booking-summary, confirmation-tables, reservation-tables.

## F13 — The data-testid contract is exact: names, presence rules ("present only when"), exact text, and `data-available` equals membership in the API's list for the searched party size.
quotes: "`auth-error` | Error message. Present only when there is one" · "`confirmation-reference` | Text is exactly the reference, no surrounding words" · "`reservation-status` | Text is exactly `confirmed` or `cancelled`" · "A cell is `true` exactly when its `table_id` is in that slot's `available_table_ids`" · "`reservation-cancel-button` | Cancels. Absent once cancelled"
places: signup/login/logout/current-user, grid cells (single + pair), no-slots, booking-form/summary/party-size/error, confirmation*, lookup*, every error element (auth-error, booking-error, reservation-error) — present only when there is an error, removed on success.

## F14 — Latest request wins: a response that is not for the newest request of its kind must not render.
quotes: "If search A starts before search B but finishes after it, the grid, table labels and booking form must describe B. A late response must not restore A's results."
places: search grid; availability refresh after 409; booking form opened from an old grid; lookup (two lookups out of order); restaurant detail fetch for table labels.

## F15 — Uncertain outcome: a lost response shows `booking-uncertain`, never error or confirmation; the unchanged form retries with the same key and body; success shows the ORIGINAL reference; the browser never manufactures success.
quotes: "If a booking response is lost, including after the booking commits, show nonempty `booking-uncertain` text" · "The unchanged form must retry with the same idempotency key and body." · "Submitting it again without changing a field must return the same `confirmation-reference`" · "These rules apply to combination bookings too."
places: single booking, pair booking, retry across export/import upgrade, 409 path (error + refresh + preserved inputs), resubmit after success.

## F16 — Product quality on every required route: 375px with no horizontal scroll, visible labels, visible focus, contrast, distinct states, consistent nav, considered empty/loading/error states.
quotes: "The required flows must remain clear and usable at a 375 CSS-pixel viewport and at conventional desktop widths, without horizontal page scrolling."
places: `/`, `/signup`, `/login`, `/lookup`, grid with many slots × tables (+ pairs), confirmation, error states.

## F17 — Upgrade compatibility: state, tokens, references and pending retries from the previous stage survive export/import into this stage, between browser requests, without reload.
quotes: "A stage-2 service must accept an export produced by the same team's stage-1 service." · "The form and pending retry identity must survive the upgrade."
places: import defaults for every new field; browser session token; lookup by old reference; pending retry; stage-1 idempotency receipts.

## F18 — Concurrency equals some serial order; invariants hold at every read.
quotes: "Concurrent requests must produce the same results as executing them one at a time in some order, and the requirements above hold at every read."
places: create (single/pair racing for a shared member), PATCH, cancel, moves, import vs writes. D2 synchronous handlers must have no `await` between read and commit in any new path.

# RISK list (stage 2)
- RISK INC-1 | reset/import must validate every API invariant | applies to "`combinable`" (pair members belong to the restaurant, exactly 2, distinct, no duplicate pair) and "Seeded `reservations` are `confirmed` unless they carry a `status` of `cancelled`, and may hold either `table_id` or `table_ids`" (pair must be declared, overlap on any member, both fields → reject)
- RISK F2/F12 | overlap per member | applies to "occupies both tables for its full duration" across create, PATCH self-exclusion, moves, cancel, seeds, availability
- RISK F8/F12 | `table_id` only for sets of one | applies to every reservation response incl. replays and imported stage-1 receipts
- RISK F9/F12 | unordered pair, non-transitive, summed capacity | applies to create, PATCH, moves alike
- RISK F10/F17 | stage-1 export must import; defaults for missing fields | applies to "A stage-2 service must accept an export produced by the same team's stage-1 service"
- RISK F13 | error elements present only when an error exists | applies to auth-error, booking-error, reservation-error
- RISK F14 | out-of-order | applies to search, lookup, post-409 refresh
- RISK F15 | same key+body retry incl. pairs and across upgrade | applies to "The form and pending retry identity must survive the upgrade."
- RISK F1 | UI local time from `starts_at_local` only | applies to cell ids `{HH:MM}` and summaries
- RISK F16 | 375px | applies to the grid with pair cells
