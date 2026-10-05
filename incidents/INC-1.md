# INC-1 — reset accepts a seeded reservation whose reference is not 6-12 of A-Z0-9

status: open
stage: 1
found-by: verifier REJECT R1.1
symptom: POST /_test/reset with a seeded reservation reference `bad` returns 204 and the service exposes `bad`.
evidence: evidence/h1v1-invalid-seed-reference.txt
defect-commit: 6debec92
fix-commit: 46f360cc6ee1ee1c2f5c8bcb0179e01b0914c2eb

## Origin
kind: L
id: L1.41
quote: "`reference` is 6 to 12 characters of `A-Z0-9`, unique across all reservations, and never changes."
traced: stage-1/src/fixture.ts:78 (`reference: str(r.reference, ...)`) → git blame 6debec92 (builder-a, Work-Item WI1.3, Origin L1.11 L1.14 L1.17 L1.51 ... S8) → WI1.1/WI1.3 via handoff H1.1 → L1.41 is not in the commit's Origin list.
why this origin: the reference rule was read as a rule for references the service mints (POST /reservations) and was never applied where references enter from outside (reset seed, import). The handoff H1.1 carried the full requirement text, so the handoff is not at fault; the sentence was skipped at the reset/import boundary.
family rule: data entering through reset or import must satisfy every invariant the API guarantees for data it creates — reference format and uniqueness, identifier uniqueness, table membership, owner existence, and no overlapping confirmed occupancy.

## Family and sweep
| sibling | kind | owner | probe | calibrated on (known-bad) | result on rev | action |
|---|---|---|---|---|---|---|
| reset: seeded reference format (original) | L1.41 at reset | builder-a | checks/sweep/INC-1/seed-ref-format.mjs | a03cf3d → FAIL | PASS on 16984d6 | FIXED 46f360c |
| reset: seeded duplicate references | L1.41 uniqueness at reset | builder-a | checks/sweep/INC-1/seed-ref-duplicate.mjs | a03cf3d → FAIL | PASS on 16984d6 | FIXED 46f360c (same fix commit) |
| import: reference format | L1.41 at import | builder-a | checks/sweep/INC-1/import-ref-format.mjs | a03cf3d → FAIL | PASS on 16984d6 | FIXED 46f360c (same fix commit) |
| import: duplicate references | L1.41 uniqueness at import | builder-a | checks/sweep/INC-1/import-ref-duplicate.mjs | scratch copy with uniqueness check removed → FAIL | PASS on 16984d6 | CLEARED |
| reset: two seeded confirmed bookings overlap on one table | F2 at reset | builder-a | checks/sweep/INC-1/seed-overlap.mjs | 16984d6 → FAIL | FAIL on 16984d6 | REJECT INC1.1 |
| reset: seeded booking on another restaurant's table | F9 at reset | builder-a | checks/sweep/INC-1/seed-table-foreign.mjs | 16984d6 → FAIL | FAIL on 16984d6 | REJECT INC1.2 |
| reset: duplicate restaurant id | F11 ids at reset | builder-a | checks/sweep/INC-1/seed-dup-restaurant.mjs | 16984d6 → FAIL | FAIL on 16984d6 | REJECT INC1.3 |
| reset: duplicate user id | F11 ids at reset | builder-a | checks/sweep/INC-1/seed-dup-user-id.mjs | 16984d6 → FAIL | FAIL on 16984d6 | REJECT INC1.4 |
| reset: seeded booking names an unknown user_id | L1.17 at reset | builder-a | checks/sweep/INC-1/seed-unknown-user.mjs | 16984d6 → FAIL | FAIL on 16984d6 | REJECT INC1.5 |

Not probed (reading only): newReference/newReservationId/newUserId in store.ts skip ids already taken, so minted ids cannot collide with seeded/imported ones.

## Close
siblings checked: 9 · failing found: 5 · fixed: 0 · cleared: 1 (+3 fixed by the original fix)
regression set: checks/sweep/INC-1/*.mjs (lib.mjs excluded)
forward risk: stage 2 seeded `table_ids`/`status` and `combinable` pairs; stage 3 `manager_user_ids`; stage 4 imported plans/closures — every new fixture or export field must be validated like the API path that creates it.
closed: —
