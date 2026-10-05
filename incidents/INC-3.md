# INC-3 — reset/import accept manager_user_ids naming a user that does not exist

status: closed
stage: 3
found-by: sweep of INC-1 (stage-3 sweep of the seeded-input family)
symptom: POST /_test/reset with `manager_user_ids: ["u_nobody"]` returns 204; POST /_test/import of an export whose restaurant names an unknown manager returns 204.
evidence: checks/sweep/S3/inc3-manager-unknown-user.mjs.calibration.json
defect-commit: dccc1678
fix-commit: 29e0bce0b72eb46f41203b467b44d943c16ebb06

## Origin
kind: L
id: L1.17
quote: "with the same fields as a `POST /reservations`"
traced: stage-3/src/fixture.ts:57 (`manager_user_ids: arr(...).map((u) => id(u, ...))`) → git blame dccc167 (builder-a, "Reset and import enforce policies, revisions, histories and series") → checkIntegrity checks reservation user_id against users (INC1.5) but the new user reference `manager_user_ids` was not added to it.
why this origin: same birth as INC-1 and INC-2 — every reference into users that enters through reset/import must point at an existing user; INC1.5 fixed it for the one reference that existed then (reservation user_id), and the new reference introduced in stage 3 repeated the omission. Requirement for the new field: "Restaurants may now declare `manager_user_ids` in their reset fixture (default `[]`). Only these users may publish policies."
family rule: data entering through reset or import must satisfy every invariant the API guarantees for data it creates — here, every user reference names an existing user.

## Family and sweep
| sibling | kind | owner | probe | calibrated on (known-bad) | result on rev | action |
|---|---|---|---|---|---|---|
| reset/import: manager_user_ids names an unknown user (original) | user reference at reset+import | builder-a | checks/sweep/S3/inc3-manager-unknown-user.mjs | 542cd39 → FAIL | FAIL on 542cd39; PASS on 29e0bce | REJECT INC3.1 → FIXED 29e0bce |
| reset/import: manager_user_ids shape, seeded booking revision 1 under policy 0, imported invalid policy, revision 0, series naming unknown reservation | stage-3 state at reset+import | builder-a | checks/sweep/S3/inc-seed-stage3.mjs | dbc14c3 → FAIL | PASS on 542cd39 | CLEARED |
| reservation user_id names an unknown user (INC1.5) on stage 3 | user reference at reset | builder-a | checks/sweep/INC-1/seed-unknown-user.mjs | 16984d6 → FAIL | PASS on stage-3 at 542cd39 | CLEARED |
| stage-1/2 exports import into stage 3; stage-3 round trip keeps policies, series, histories, receipts | F10 / F17 | builder-a | checks/sweep/S3/f10-upgrade-and-roundtrip.mjs | dbc14c3 → FAIL | PASS on 542cd39 | CLEARED |

## Close
siblings checked: 4 · failing found: 1 · fixed: 1 · cleared: 3
regression set: checks/sweep/S3/*.mjs (lib.mjs excluded)
forward risk: stage 4 adds plans and closures — every table/booking/restaurant reference in an imported plan or closure must resolve, and a plan id must belong to its restaurant.
closed: 2026-10-05 on rev 29e0bce (regression 37/37 green on stage-3)
