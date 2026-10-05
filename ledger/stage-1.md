# Stage 1 verification ledger

Requirement readings are taken from the coordinator's complete four-part handoff. Family IDs refer to `factory/families.md`. **skip-risk** marks clauses likely to be missed.

| ID | requirement / chosen reading | families | probe |
|---|---|---|---|
| L1.1 | Diners can search availability, book, receive a reference, cancel/amend including multi-booking changes; restaurant capacities/hours/cutoffs apply; HTTP API only. | F1,F2,F7,F8,F9 | end-to-end API matrix |
| L1.2 | Two confirmed reservations never overlap on one table, including concurrent requests. | F2,F6 | concurrent create/move collision |
| L1.3 | Occupancy is half-open `[start,start+duration)`; exactly-adjacent bookings do not overlap. | F2 | 19:00/20:30 boundary |
| L1.4 | Retries and rejected writes create neither duplicates nor partial bookings. | F3,F6 | failed/retry state diff |
| L1.5 | **skip-risk** Deliver service, Dockerfile and RUN.md with no-manual-setup build/run command. | — | clean Docker build/run |
| L1.6 | Harness judges only container HTTP behavior; image honors `-e PORT` plus port mapping. | — | isolated container HTTP probe |
| L1.7 | Runtime has no outbound network and all dependencies/seed assets are in the image. | — | network-disabled container start |
| L1.8 | Limits: 2 vCPU, 2GiB, healthy within 60s, 50 in flight, normal request ≤5s/reset ≤10s, ephemeral disk. | F6 | resource/load probe |
| L1.9 | Listen on `0.0.0.0`, PORT default 8080. | — | default/override listener |
| L1.10 | `GET /health` returns `200 {"status":"ok"}` once service/store can serve, within 60s. | — | readiness probe |
| L1.11 | Reset accepts JSON fixture and returns 204, atomically replacing all state; repeated reset works, no auth. | F6,F10 | reset replacement/repeat |
| L1.12 | JSON requests/responses use `application/json; charset=utf-8`; response timestamps RFC3339 explicit offset. | F1,F8 | headers/timestamp regex |
| L1.13 | **skip-risk** Unknown body fields and unknown query parameters are ignored, never errors. | F4 | additive-field/query probe |
| L1.14 | Opaque IDs max 64 chars, including reset fixture IDs. | F11,F4 | 64/65 ID fixture probe |
| L1.15 | Restaurants/tables are reset-only; model fields govern local time, grid, duration, cutoff, weekday hours and capacity. | F1,F7,F9 | fixture-driven variations |
| L1.16 | Weekdays are exactly mon..sun; opens/closes are same-day 24-hour HH:MM with closes later; missing weekday is closed. | F1,F9 | weekday/closed/hours fixtures |
| L1.17 | Seed users can immediately log in with supplied passwords; seeded confirmed reservation includes create fields plus id/reference/user_id. | F5,F8,F10 | seed login/reservation |
| L1.18 | **skip-risk** Any calendar date is allowed: create does not reject a past start solely for being past, though cutoff still applies to changes/cancel. | F7,F9 | past create then cutoff |
| L1.19 | Every 4xx/5xx has `{error:{code,message}}`; specified status/code used; wording unrestricted. | F4 | error-shape/status matrix |
| L1.20 | 400 malformed only unparseable JSON/body wrong type; 401 bad/missing token; 403 unauthorized permission; 404 absent/not visible; 409 reuse; 422 missing/rule violation. | F4,F5 | error taxonomy matrix |
| L1.21 | Correct JSON type but bad format/range is 422 unless endpoint-specific error. | F4 | invalid-date/range matrix |
| L1.22 | **skip-risk** party_size (strings/booleans included) and non-bare local starts are endpoint-specific 422; other wrong body types remain 400. | F4,F9 | type-precedence matrix |
| L1.23 | Integer query values must be decimal digits; `1e9`,`4.0`,`+4` are 422. | F4 | query spelling probe |
| L1.24 | Idempotency-Key valid length is 1..255; otherwise 422 wherever accepted. | F3,F4 | 0/1/255/256 keys |
| L1.25 | Requests never yield 5xx including under concurrency. | F4,F6 | malformed/load sweep |
| L1.26 | Signup 201 exposes user_id/display_name/token; login 200 does likewise. | F5,F8 | signup/login contract |
| L1.27 | Signup duplicate email=409 email_taken; short password/bad local@domain=422; wrong/unknown login=401. | F4,F5 | auth negative matrix |
| L1.28 | Auth exceptions are health/reset/signup/login and three public GETs; every other endpoint requires Bearer token. | F5 | auth surface matrix |
| L1.29 | Tokens never expire; same account permits multiple simultaneous valid tokens. | F5,F10 | two-login token probe |
| L1.30 | Password storage uses secure hash (not plaintext). | F5,F10 | export plaintext absence + login |
| L1.31 | Only POST reservations and POST moves require idempotency; scope is user. | F3 | user/path key isolation |
| L1.32 | Replay equality is user+method+path+parsed JSON value; whitespace/key order irrelevant; same key on another path is distinct. | F3 | canonical JSON/path probe |
| L1.33 | **skip-risk** After JSON-object parse/auth, idempotency precedes endpoint validation/resource checks; changed body returns 409 even if otherwise invalid. | F3,F4 | invalid reused-body precedence |
| L1.34 | No/empty key=400; first success=201; replay=200 identical JSON; changed=409; failed 4xx leaves key reusable. | F3,F6 | receipt lifecycle |
| L1.35 | Concurrent identical unused-key calls have exactly one 201, remainder 200 same body, exactly one effect. | F3,F6 | 50-way replay race |
| L1.36 | Successful replay returns original result after later cancel/change and makes no state change. | F3,F8 | stale replay probe |
| L1.37 | Restaurant listing public response contains id/name/timezone; details includes configured fields/tables and unknown=404. | F5,F9 | public restaurant probes |
| L1.38 | Availability requires restaurant_id/date/party_size (missing=422); date is restaurant-local; response fields as shown. | F1,F4,F9 | availability shape/missing |
| L1.39 | Availability generates open-grid slots only when duration fits; eligible free confirmed-only tables in fixture order; empty slots remain; closed day empty. | F1,F2,F9 | grid/capacity/order/closed matrix |
| L1.40 | Create resolves bare local starts in restaurant timezone and returns all shown reservation fields. | F1,F8,F9 | create shape/offset |
| L1.41 | Reference is immutable globally unique 6..12 `[A-Z0-9]`. | F8,F10 | format/uniqueness/amend |
| L1.42 | Create: overlap=409 table_unavailable; off-grid=422 not_on_slot_grid; outside/end after close=422 outside_opening_hours; overcapacity=422 party_exceeds_capacity; invalid party=422; nonexistent=422 invalid_local_time; bad restaurant/table/membership=404. | F1,F2,F4,F9 | create failure matrix |
| L1.43 | List returns caller-only confirmed and cancelled, starts_at descending, common shape; empty list exact. | F5,F8 | list ordering/empty |
| L1.44 | Get by reference is 404 for non-owner (no existence leak). | F5 | cross-user get |
| L1.45 | Cancel returns current state; repeat cancellation=200; frees table immediately; owner missing=404; cutoff=409 cutoff_passed. | F2,F5,F7,F8 | cancel matrix |
| L1.46 | Patch accepts any subset of table/start/party, requires no idempotency, reuses create validation and current-start cutoff; cancelled=409 reservation_cancelled. | F4,F7,F9 | patch subset/error matrix |
| L1.47 | Successful patch atomically releases old/reserves new; failed patch preserves old occupancy; identity/reference remain. | F2,F6,F8 | patch state-diff |
| L1.48 | **skip-risk** Spring gaps absent from availability and booking them is 422 invalid_local_time. | F1 | Berlin/NY spring fixtures |
| L1.49 | **skip-risk** Fall repeated time appears once and resolves first (pre-change) occurrence; second cannot be booked. | F1 | Berlin/NY fallback offset |
| L1.50 | **skip-risk** Duration is absolute: fallback 01:30 +90 real minutes renders 02:00, not 03:00; IANA offsets apply at mandated 2026 transitions. | F1 | absolute-duration DST matrix |
| L1.51 | Export/import are unauthenticated; export 200 has track tablekeeper, format_version 1, opaque state accepted unchanged. | F10 | export schema + cross-container import |
| L1.52 | Import atomic replacement 204; repeat restore no duplication; malformed JSON follows errors; missing/wrong track/version/invalid state=422 with no state change. | F4,F6,F10 | import invalid/replacement probe |
| L1.53 | **skip-risk** Export is atomic immutable read snapshot; no source process/file/volume/port/network dependency; control calls ≤10s. | F6,F10 | source write/snapshot + timeout |
| L1.54 | Export/import preserves hashes/login, tokens, config, reservations/references, receipts/original bodies/responses, ids/status/timestamps; failed keys reusable. | F3,F5,F8,F10 | post-import auth/replay test |
| L1.55 | Import removes destination credentials/data; reset clears imported state; no abrupt-restart persistence required. | F6,F10 | replacement/reset state test |
| L1.56 | Moves requires auth/key; moves list 1..8 distinct string references; bad shape/duplicates=422; non-owner/unknown=404; cross-restaurant=422; no token=401. | F3,F4,F5,F6 | moves shape/ownership matrix |
| L1.57 | Move items merge ordinary patch fields; omitted values stay; unknown fields ignored; identity/owner/created_at immutable; cancelled=409. | F4,F8,F9 | move merge/no-op/identity |
| L1.58 | **skip-risk** Move cutoff comes before other per-booking errors; non-occupancy errors use ordinary amendment codes in input order. | F4,F7,F9 | move precedence order |
| L1.59 | Resulting/internal-unlisted overlap=409; unchanged listed bookings retain occupancy. | F2,F6 | swap/collision/unlisted tests |
| L1.60 | **skip-risk** Moves are all-or-nothing including retry keys; success 201 reservations in input order including unchanged; replay 200 original after changes/cancel; batch receipts/results export/import. | F3,F6,F8,F10 | move atomic/replay/roundtrip |
| L1.61 | No batch UI is required. Chosen reading: HTTP-only moves are sufficient. | — | route/API-only review |
