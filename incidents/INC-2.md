# INC-2 — reset/import accept a seeded booking whose party exceeds its table set's capacity

status: closed
stage: 2
found-by: sweep of INC-1 (stage-2 sweep of the seeded-input family)
symptom: POST /_test/reset seeding party 3 on a capacity-2 table, or party 7 on a pair of summed capacity 6, returns 204; POST /_test/import with the same returns 204.
evidence: checks/sweep/S2/inc1-seed-capacity.mjs.calibration.json
defect-commit: d01c189699aba28db2d86c330da533fc6700ffeb
fix-commit: 73657b45c2c51fdf91c4f75e64b3f6497b6d1861

## Origin
kind: L
id: L1.17
quote: "with the same fields as a `POST /reservations`"
traced: stage-2/src/fixture.ts checkIntegrity (lines 69-78) → git blame (copy-following) d01c189 (builder-a, the INC-1 fix that introduced checkIntegrity in stage 1; carried into stage 2 by the copy d2e3dfe, WI2.1) and f52bf75 (builder-b, WI2.6, Origin INC-1 F12 S8 D15) → neither adds a capacity rule.
why this origin: same birth as INC-1 — the reset/import boundary was given only the invariants someone listed, not every rule POST /reservations enforces. The INC-1 sweep (mine) listed reference, ids, table membership, owner and overlap but did not probe capacity, so this sibling was missed in stage 1 and carried into stage 2. Stage 1 has the same gap (probe FAILs on stage-1/ too); stage 1 is frozen, so the fix lands in stage 2.
family rule: data entering through reset or import must satisfy every invariant the API guarantees for data it creates; here: party_size ≤ capacity of the single table or the pair's summed capacity.

## Family and sweep
| sibling | kind | owner | probe | calibrated on (known-bad) | result on rev | action |
|---|---|---|---|---|---|---|
| reset/import: party over single or pair capacity (original) | L1.17 at reset+import | builder-b | checks/sweep/S2/inc1-seed-capacity.mjs | 64f99e9 → FAIL | FAIL on 64f99e9; PASS on 73657b4 | REJECT INC2.1 → FIXED 73657b4 |
| reset: undeclared pair, >2 tables, both fields, member overlap, bad `combinable` entries, cancelled seed frees | F12 at reset | builder-b | checks/sweep/S2/inc1-seed-pairs.mjs | d2e3dfe → FAIL | PASS on 64f99e9 | CLEARED |
| stage-1 export imports into stage 2 (receipts, tokens, defaults) | F17 / F10 | builder-b | checks/sweep/S2/f17-stage1-upgrade.mjs | d2e3dfe → FAIL | PASS on 64f99e9 | CLEARED |
| INC-1 regression set (9 probes) on stage-2 | L1.41 at reset/import | builder-a | checks/sweep/INC-1/seed-overlap.mjs | 16984d6 → FAIL | PASS on 64f99e9 (all 9) | CLEARED |

## Close
siblings checked: 4 · failing found: 1 · fixed: 1 · cleared: 3
regression set: checks/sweep/S2/*.mjs and ui-*.py (libs excluded)
forward risk: stage 3 policies change capacities per date — a seeded/imported booking must fit the capacity of the policy it was accepted under (accepted_terms), and reset/import must check it.
closed: 2026-10-05 on rev 73657b4 (stage-2 regression 25/25 green)
