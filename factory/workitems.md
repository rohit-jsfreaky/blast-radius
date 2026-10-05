# Work items

Written by @coordinator. One row per item. `quote` = the requirement text the item covers, verbatim.

| id | owner | quote (verbatim) | families (F) | changes earlier items | handoff |
|---|---|---|---|---|---|
| WI1.1 | builder-a | "Deliver an HTTP service, a `Dockerfile` and a `RUN.md`" ; §3 runtime contract (listen, /health, /_test/reset); §5 errors; §6 signup/login/bearer; §8 GET /restaurants, GET /restaurants/{id} | (map pending) | - | H1.1 |
| WI1.2 | builder-a | "`GET /availability`" §8 and §9 Time and DST | (map pending) | - | H1.1 |
| WI1.3 | builder-a | §10 Export and import | (map pending) | - | H1.1 |
| WI1.4 | builder-b | `POST /reservations` §8 with §7 Idempotency | (map pending) | - | H1.2 |
| WI1.5 | builder-b | `GET /reservations`, `GET /reservations/{reference}`, `POST /reservations/{reference}/cancel`, `PATCH /reservations/{reference}` | (map pending) | - | H1.2 |
| WI1.6 | builder-b | §11 "Atomic reservation moves" | (map pending) | WI1.4, WI1.5 | H1.2 |
| WI2.1 | builder-a | "The following screens must be reachable by URL." ; "Signup and login" data-testids; "Product and visual direction" | (see families.md) | WI1.1 | H2.1 |
| WI2.2 | builder-a | "Search and availability grid — `/`" and "The availability grid gains combination cells" and "If search A starts before search B but finishes after it" | | | H2.1 |
| WI2.3 | builder-a | "Booking form", "Confirmation", "If another client takes a table after the form opens" , "If a booking response is lost" , "Existing clients after an upgrade" | | | H2.1 |
| WI2.4 | builder-a | "Lookup — `/lookup`" | | | H2.1 |
| WI2.5 | builder-b | "The restaurant fixture gains one field" ; "Slots gain `available_options`" | | WI1.2 | H2.2 |
| WI2.6 | builder-b | "The body takes `table_ids` instead of `table_id`" ; "`PATCH /reservations/{reference}` accepts `table_ids` under the same rules. Cancelling frees every table in the set." | | WI1.4, WI1.5 | H2.2 |
| WI2.7 | builder-b | "Atomic reservation moves from stage 1 also accept `table_ids` per move." | | WI1.6 | H2.2 |
| WI2.8 | builder-b | "A stage-2 service must accept an export produced by the same team's stage-1 service." ; "Concurrent requests must produce the same results as executing them one at a time in some order" | | WI1.3 | H2.2 |
| WI3.1 | builder-a | "`POST /restaurants/{id}/policies` requires an idempotency key" ; "`GET /restaurants/{id}/policies` is public" | | | H3.1 |
| WI3.2 | builder-a | "`explain` is optional. Its only accepted value is `true`" ; "Availability and booking decisions use the selected policy" | | WI1.2, WI2.5 | H3.1 |
| WI3.3 | builder-a | "`POST /series` adopts an existing reservation as occurrence zero of a recurring agreement." | | | H3.1 |
| WI3.4 | builder-a | "A stage-3 service must accept exports produced by the same team's stage-1 or stage-2 service." | | WI1.3 | H3.1 |
| WI3.5 | builder-b | "Every reservation response gains `revision` (1 at creation) and `accepted_terms`" ; "## Reservation history" ; "`PATCH` optionally accepts `expected_revision`" | | WI1.4, WI1.5 | H3.2 |
| WI3.6 | builder-b | "## Combined-table history" | | WI2.6 | H3.2 |
| WI3.7 | builder-b | "## Collective moves under policies and agreements" | | WI1.6, WI2.7 | H3.2 |
| WI4.1 | builder-a | "`POST /restaurants/{id}/replans` requires a manager and an idempotency key." ; "Among feasible plans minimize, in order:" | | | H4.1 |
| WI4.2 | builder-a | "`POST /restaurants/{id}/replans/{plan_id}/apply`, body `{}`, requires a manager and an idempotency key." ; "Closures thereafter exclude singles and pairs from availability" | | WI1.2, WI2.5, WI3.2 | H4.1 |
| WI4.3 | builder-b | "`POST /series/{series_id}/amend` is an owner-only idempotent write." | | WI3.3 | H4.2 |
| WI4.4 | builder-b | "Seating repairs may move series occurrences. They preserve their exception flags, scheduled dates, identities and accepted terms." | | WI3.3 | H4.2 |
| WI4.5 | builder-b | "A stage-4 service must accept exports produced by the same team's stages 1–3." ; "A restaurant revision starts at 0 after reset and increments once for each successful new booking, real amendment, cancellation, policy publication or plan application." | | WI3.4 | H4.2 |
