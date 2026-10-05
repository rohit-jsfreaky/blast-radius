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
