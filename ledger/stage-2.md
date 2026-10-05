# Stage 2 verification ledger

Stage 1 remains fully applicable (L1.1–L1.61, F1–F11). The additions below are incrementally numbered; items marked **skip-risk** are priority probes.

| ID | requirement / reading | families | probe |
|---|---|---|---|
| L2.1 | **skip-risk** Stage-2 is a standalone copy/extension of accepted stage-1; stage-1 is unchanged and all Stage-1 HTTP behaviors regress. | F1-F11 | stage-1 export/import regression |
| L2.2 | `/`, `/signup`, `/login`, `/lookup` are URL-reachable HTML screens; JSON convention does not govern these routes. | F12 | browser route/content probe |
| L2.3 | **skip-risk** Out-of-order A/B searches leave grid, labels and form describing B only. | F13 | delayed-fetch browser test |
| L2.4 | 409 taken shows booking-error, refreshes availability, preserves choice/inputs, and shows no confirmation. | F13,F2 | competing-client browser test |
| L2.5 | **skip-risk** Lost post-commit response shows only nonempty booking-uncertain; unchanged retry has same key/body; success clears error/uncertain and displays original reference; confirmed rejection is booking-error. | F3,F13 | intercepted-response retry |
| L2.6 | Applies to combined bookings; no polling/live/cross-tab/reload recovery; server is authoritative. | F3,F13 | browser recovery constraints |
| L2.7 | UI exposes all named data-testid attributes; auth error conditional; current user display/logout on every signed-in screen. | F12,F5 | DOM contract matrix |
| L2.8 | **skip-risk** Presentation-quality warm hospitality UI has distinct states, human labels, consistent hierarchy/system. | F12 | visual review screenshots |
| L2.9 | 375px and desktop: no horizontal scroll; visible labels/focus/contrast; considered empty/loading/errors; consistent navigation. | F12 | browser accessibility/layout |
| L2.10 | Search testids and value semantics; slot testid per table/time; data-available exactly matches API; no-slots replaces grid. | F12,F9 | API/DOM equivalence |
| L2.11 | Available slot opens form; unavailable does nothing; signed-out available selection gives auth error or login. | F12,F5 | click state matrix |
| L2.12 | Booking form testids/summary/pre-fill; success retains form; identical submit returns same confirmation only; field edit makes new request. | F3,F8,F12 | idempotent UI flow |
| L2.13 | Confirmation testids: reference exactly reference, details human restaurant/table/local time. | F8,F12 | DOM confirmation check |
| L2.14 | Lookup testids/state; status exact; cancel absent when cancelled; errors for not found/refused. | F5,F7,F12 | lookup/cancel browser flow |
| L2.15 | **skip-risk** Stage-1 export imports to stage 2; pre-upgrade session/reference/retry survive import without reload; retained retry yields original confirmation. | F3,F5,F10,F13 | live upgrade probe |
| L2.16 | Model permits declared unordered two-table pairs only, no triples, non-transitive; pair capacity sums capacities. | F2,F9,F14 | fixture/model validation |
| L2.17 | Seeds default confirmed unless cancelled and accept table_id or table_ids. | F2,F8,F10,F14 | seed state matrix |
| L2.18 | Availability retains singles exactly and adds options: all eligible free singles then declared pairs, exact fixture/combinable order and pair member order. | F2,F9,F14 | availability reference enumeration |
| L2.19 | Create accepts table_ids or legacy table_id singleton, never both; response always table_ids and table_id iff singleton. | F3,F8,F9,F14 | create compatibility/shape |
| L2.20 | Pair invalid/triple=422 combination_not_allowed; any occupied member=409; over sum=422 party_exceeds_capacity; duplicate id=422 validation_failed. | F2,F4,F9,F14 | pair error matrix |
| L2.21 | Patch uses same table_ids rules and cancel frees every table. | F2,F7,F9,F14 | patch/cancel matrix |
| L2.22 | Combination grid cells use ordered `slot-a+b-HH:MM`, availability truth; confirmation/lookup table labels and summary name every table; singles unchanged. | F12,F14 | browser combination flow |
| L2.23 | Moves accept table_ids; no table can overlap any resulting booking; UI recovery/original receipts cover combinations. | F2,F3,F6,F14 | move combination atomicity |
| L2.24 | **skip-risk** Concurrent creates/amendments/moves are serializable and all listed invariants hold at every read. | F2,F3,F6,F14 | 50-way race/reference |
| L2.25 | Stage-1 public/single-table routes, errors, idempotency, DST, auth, export/import and resource guarantees still apply unless explicitly changed. | F1-F11 | inherited official stage-1 suite |
