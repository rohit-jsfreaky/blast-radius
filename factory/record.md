# Factory record

Kept by @coordinator. Times from the shell clock only.

## Run
start: Mon Oct 5 17:43 IST 2026 (shell clock)
end:

## Stages
| stage | plan sent | done | accepted rev | defects (checks / sweep) | cards | notes |
|---|---|---|---|---|---|---|
| 1 | 17:50 | | | | | |

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
