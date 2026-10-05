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
