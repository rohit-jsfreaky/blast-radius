# FACTORY.md — Blast Radius

> When our band finds one bug, it finds the whole family. Every defect is traced to where it was
> born — a spec sentence, a handoff, a decision, a piece of shared code — and everything else born
> there is re-checked before the stage can close.

Numbers below come from `evidence/metrics.json` (`python tools/metrics.py`) and
`cd tools && python -m blast report`.

## The case study

| | |
|---|---|
| **The task** | Tablekeeper: a restaurant booking service + browser app, 4 stages, from one dispatch |
| **The band** | 5 seats: coordinator, builder-a, builder-b, verifier, investigator ([seats](#the-seats)) |
| **The key design decision** | Every commit carries its origin, so one defect becomes a family to sweep, not a one-off fix |
| **The verified result** | 4 of 4 stages claimed by the official harness (isolated) · 8 defects, 7 found by the sweep, all fixed · sealed holdout 35/35, 66/66, 129/129, 168/169 |
| **The cost** | 2 h 16 min wall clock (17:43 → 19:59 IST) · 81 commits by 5 seats · dollar spend not measured (subscriptions) |
| **The limitation** | 2 wake-up messages were needed when a seat ended its turn early (see [Limits](#limits)) |

## At a glance

| | |
|---|---|
| Human input | 1 dispatch for all four stages + 2 wake-up messages |
| Defects | 8 — verifier 1 · **investigator's sweep 7** |
| Origins | all 3 cards trace to spec lines (L1.41, L1.17): data entering through reset/import without the API's checks |
| Family recurrence after a card closed | 0 |
| Probes | 51, of which 45 were seen failing on a known-bad before they counted |
| Commits | builder-a 34 · coordinator 17 · investigator 12 · builder-b 10 · verifier 8 |
| Room | 2,114 events · 202 text messages · 3 from the human |

## Why this factory

A stage is graded on hidden checks, and the shipped ones are a small sample (the kickoff says about
83%, 41%, 11% and 21% of each stage). The same mistake usually lands in many places, because many
places are built from one spec sentence, one handoff, one decision or one shared function. Fix only
the place a check found, and the siblings stay broken until a hidden check finds them.

So we gave the band a seat whose only job is the family. It never writes product code. It reads the
blame, finds the origin, and proves every sibling either broken (a REJECT to its owner) or fine (a
probe that passes, after it was seen failing on a planted bug).

## The seats

| Seat | Harness · model · effort | Owns | Writes |
|---|---|---|---|
| coordinator | Claude Code · claude-sonnet-5-5 · low | work items, handoffs (pasted in full), the gate, the record | `factory/` only |
| builder-a | Claude Code · claude-sonnet-5-5 · medium | shared foundations, the user interface, assigned features | `stage-N/` |
| builder-b | Claude Code · claude-sonnet-5-5 · medium | assigned features end to end | `stage-N/` |
| verifier | Codex · gpt-5.6-terra · low | ledger, calibrated probes, the official checks (only seat that runs them), REJECTs, GATE | `ledger/ checks/ evidence/` |
| investigator | Claude Code · claude-opus-5-5 · medium | family map, incident cards, the sibling sweep, SWEEP CLEAR | `factory/families.md incidents/ checks/sweep/` |

The git hooks in `tools/hooks/` enforce the roles: a stage commit needs `Seat:`, `Work-Item:` and
`Origin:` lines, the work item must belong to the committing seat, the coordinator may only touch
`factory/`, and the verifier and investigator may never touch `stage-N/`.

## How one stage runs

1. Coordinator: STAGE PLAN to verifier + investigator; work items with verbatim spec quotes.
2. Investigator: FAMILY MAP — the cross-cutting rules of the stage and the RISKs carried from earlier families.
3. Coordinator: HANDOFF to each builder, complete spec text pasted in numbered parts.
4. Builders commit small, each commit tagged with its origin; post READY.
5. Coordinator: VERIFY handoff; verifier probes the ledger and runs the official checks.
6. Any defect → investigator opens a card → `blast origin` → family → a calibrated probe per sibling → REJECT per failing sibling.
7. GATE PASS + SWEEP CLEAR → STAGE DONE → the next stage starts from a copy of the accepted folder.

Real example: stage 1, 18:19 REJECT R1.1 (reference format at reset) → 18:22 INC-1, family of 9 →
REJECT INC1.1–1.5 → 18:23 all fixed on d01c189 → 18:28 STAGE 1 DONE.

## The best catch

`incidents/INC-1.md`. The verifier found one bad reference accepted by reset. The investigator
traced it (blame → commit trailers → handoff H1.1 → spec L1.41) and named the real rule: data entering
through reset or import must meet every invariant the API guarantees. Of 9 siblings, 5 were failing and
unreported (overlapping seeded bookings, a foreign table, duplicate restaurant ids, duplicate user ids,
an unknown user). The family went forward as a RISK and caught INC-2 at stage 2 (seeded party bigger
than its tables) and INC-3 at stage 3 (unknown managers on import). Every probe joined the regression
set; 45/45 were green at the end.

## Design choices and what they cost

| choice | why | cost |
|---|---|---|
| Origin trailers enforced by a git hook | the sweep needs blame to land on a spec line, not on "WI1.1" | a hook refuses untagged commits; builders write 2 extra lines per commit |
| A fifth seat just for families | review that only checks the reported spot leaves siblings | 12 commits and an Opus seat |
| Calibrated probes (seen failing on a known-bad) | a probe that never failed proves nothing | a scratch copy with a planted bug per sibling |
| Handoffs pasted in full | the guide requires it; a path is not a handoff | long room messages (the room still used 202 text messages) |
| Sealed holdout written before the run | to measure what the shipped checks never ask | 169 cases written outside the room |

## What we tried that failed (dev runs)

- Handoff files written through a shell lost their Windows backslashes → write with the file tool.
- One builder commit covered three work items with only a shared-code origin → one work item per commit, spec ids in `Origin:`.
- A builder found a bug in the other builder's code and told only that builder → any such bug goes to the investigator as a DEFECT.
- A probe marked CLEARED had never failed → `blast card check` refuses rows without their own calibration.
- Claude seats' commits were blocked by a permission check → the Claude seats run with permissions the hooks then police.
- A seat ended its turn with "I am continuing" → every mandate now says: never end a turn without your result line.

## How it catches and recovers from bad work

REJECT → FIXED loop (max 3 rounds per defect) · an incident card for every defect · the sibling sweep ·
a regression set that every later stage re-runs · the contest rule (a builder may dispute a REJECT with
the spec quote; the coordinator decides) · 2 retries per failed tool · 100 minutes per stage, then close
with what is proven · the last 30 minutes kept for the final report.

## Stand it up yourself

1. In Band Desktop, create five local agents named exactly as in [The seats](#the-seats), working
   directory = your result repository, instructions = the matching file in `mandates/`.
2. Make a result repository with `mandates/`, `tools/blast`, `tools/hooks`, the empty `factory/`,
   `ledger/`, `checks/`, `incidents/`, `evidence/` folders, then
   `git config core.hooksPath tools/hooks` and `git config core.autocrlf false`.
3. Send one message to `@coordinator`: the track, the spec paths, the result-repo path and the file
   map (our dispatch is the first message in `room.json`).
4. Read the results: `factory/record.md`, `incidents/`, `cd tools && python -m blast report`.

## Limits

- **Two wake-up messages.** In Band, a seat wakes only when a message names it; there is no timer.
  Twice, a seat ended its turn before posting its result, which left the room idle with nothing to
  wake it. With limited model usage left, we sent one wake-up message each time (19:22 and 19:46)
  instead of rerunning the whole factory. They contain no hints or instructions about the work — they
  only ask the seat to finish and report. The mandates now tell every seat never to end a turn
  without its result line.
- **Holdout 168/169**: HO-4-09 failed at its own setup (the service refused the case's seed as
  overlapping); not settled whether the seed or the service is wrong, counted as a failure.
- **Work split**: builder-a carried most stage code (folder copies count as its lines).
- **Stage 1 ledger**: the verifier probed 11 of 61 items itself; official checks, sweeps and holdout cover the rest.
- **Not measured**: dollar spend, a solo-agent baseline, the generic run on the other track.
