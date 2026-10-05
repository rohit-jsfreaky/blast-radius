# Factory record

Kept by @coordinator. Times from the shell clock only.

## Run
start: Mon Oct 5 17:43 IST 2026 (shell clock)
end: 19:59 IST (shell clock)

## Stages
| stage | plan sent | done | accepted rev | defects (checks / sweep) | cards | notes |
|---|---|---|---|---|---|---|
| 1 | 17:47 | 18:28 | 5014e13 | 1 / 5 | INC-1 (family 9) | GATE PASS, SWEEP CLEAR; ledger probed 11/61 (limitation) |
| 2 | 18:32 | 19:06 | fe88890 | 0 / 1 (INC-2) | INC-2 (family 4) | GATE PASS official-s2-c, SWEEP CLEAR |
| 3 | 19:10 | 19:36 | 7417cd3 | 0 / 1 (INC-3) | INC-3 (family 4) | GATE PASS official-s3-b, SWEEP CLEAR |
| 4 | 19:36 | 19:59 | 0c0b41e | 0 / 0 | none new | GATE PASS official-s4-a, SWEEP CLEAR 45/45 |

## Open REJECTs
(none)

## Contests and decisions
(none)

## Restarts and blockers
(none)

## Event log
- 17:43 run start; all five seats confirmed in room; specs for stages 1-4 read; decisions D1-D8 written.
- 17:47 STAGE PLAN 1 sent to verifier+investigator; HANDOFF H1.1 (builder-a: WI1.1-1.3) and H1.2 (builder-b: WI1.4-1.6) pasted in full (4 parts each). Waiting: investigator family map (due 17:57), builders READY.
- 18:17 READY H1.1 (builder-a 0f3508c) and H1.2 (builder-b 3a65422); family map F1-F11 received (c9fab94); ledger L1.1-L1.61 (4abc780). VERIFY H1.V1 sent to verifier.
- 18:19 OPEN REJECT R1.1 | L1.41 | owner builder-a | seeded reference format not validated | fix commit pending
- 18:22 R1.1 fixed 46f360c (round 1). INC-1 (family: reset/import boundary skips invariants, 9 siblings): REJECT INC1.1-INC1.5 to builder-a (seed overlap, foreign table, dup ids, unknown user). Open until fixed.
- 18:23 INC-1 closed (family 9, 5 failing, all fixed on d01c189). Waiting verifier full suite/official checks.
- 18:28 STAGE 1 DONE rev 5014e13. 18:32 STAGE PLAN 2 + H2.1 (builder-a UI WI2.1-2.4) + H2.2 (builder-b API WI2.5-2.8) sent.
- 18:31 READY H2.2 builder-b 8df6fc9. ledger L2.1-25 (602ef52); family map stage 2 (95471b0). Waiting READY H2.1 (UI).
- 18:44 READY H2.1 builder-a f1e0296; builder-b f52bf75 (INC-1 risk applied). VERIFY H2.V1 sent.
- 18:56 GATE PASS stage 2 @64f99e9 (official-s2-b). OPEN REJECT INC2.1 | L1.17 sibling of INC-1 | builder-b | seeded/imported party exceeds capacity. UI family probes pending (investigator).
- 19:06 STAGE 2 DONE rev fe88890. 19:10 STAGE PLAN 3 + H3.1 (builder-a WI3.1-3.4) + H3.2 (builder-b WI3.5-3.7) sent.
- 19:15 READY H3.1 + H3.2 on 1c39408. VERIFY H3.V1 sent (D23 400-vs-422 to be ruled).
- 19:30 GATE PASS stage 3 @542cd39 (official-s3-a). OPEN REJECT INC3.1 | L1.17 sibling | builder-a | unknown manager_user_ids accepted at reset/import. Awaiting fix + SWEEP CLEAR.
- 19:36 STAGE 3 DONE rev 7417cd3. STAGE PLAN 4 + H4.1 (builder-a WI4.1-4.2) + H4.2 (builder-b WI4.3-4.5) sent.
- 19:44 READY H4.1 + H4.2 on ad9619b. VERIFY H4.V1 sent.
- 19:48 GATE PASS stage 4 @0c0b41e (official-s4-a); limitation: verifier's independent exhaustive planner comparator not finished. Awaiting SWEEP CLEAR (asked investigator to include independent brute force).
- 19:59 STAGE 4 DONE rev 0c0b41e. FINAL REPORT posted.

## Known limitations
- Ledger probe coverage is partial in every stage (stage 1: 11/61 probed locally, rest ruled by the requirement text: evidence/stage-1/ledger-limitations.md).
- Stage 4: the verifier's own exhaustive planner comparison was not finished; the investigator's independent brute-force reference matched 783 previews.
- builder-b ran local Node smoke tests only; the official harness is the only independent run for its items.
- UI: cancel on lookup is one click (no confirm step); a pair whose summed capacity is below the party size has no grid cell (row hidden).
- Several sweep probes were calibrated on a coarse known-bad (pre-feature copy).
