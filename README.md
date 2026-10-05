# Blast Radius — a software factory that finds the whole family

**When our band finds one bug, it traces where the bug was born and re-checks everything born
there.** Built in BAND Desktop for the WeAreDevelopers × BAND Dark Factory hackathon, track
**tablekeeper**, by Rohit Kashyap (solo).

**[Live demo](https://blast-radius-tablekeeper.onrender.com) (log in: ada@example.com / correct horse; first load may take ~50 s) · [FACTORY.md](FACTORY.md) · [The numbers](#the-numbers) · [The best catch](#the-best-catch) · [Limits](#limits) · [room.json](room.json)**

Most factories fix the one place a check found. But one sentence of the spec, one handoff or one
shared function usually feeds many places, so the same mistake sits in the siblings until a hidden
check finds it. Our fifth seat, the **investigator**, takes every defect, finds its origin with
`git blame` and the commit trailers every builder must write, and sweeps every sibling born from
that origin with a probe it first sees failing on a known-bad version.

## Judge it in 90 seconds

1. `python -m harness run --track tablekeeper --repo . --stage 4 --mode isolated` → `claimed stage: 4`
2. Open `incidents/INC-1.md`: one REJECT, traced to spec line L1.41, a family of 9 siblings, 5 of them
   failing that nobody had reported, all fixed, every probe in `checks/sweep/INC-1/`.
3. `cd tools && python -m blast report` → the sweep numbers below, from the files.
4. `python tools/metrics.py` → `evidence/metrics.json`, the source of every number on this page.
5. Run the app: see `stage-4/RUN.md`, then open http://localhost:8080.

## The numbers

All from `evidence/metrics.json` (made by `tools/metrics.py`) and `blast report`.

| | |
|---|---|
| Stages claimed (official harness, isolated) | **4 / 4** (`evidence/stage-4/official-s4-a/report.json`) |
| Sealed holdout exam (169 cases written from the spec before the run, never shown to the band) | stage 1 **35/35** · stage 2 **66/66** · stage 3 **129/129** · stage 4 **168/169** |
| Defects found | **8** — **7 by the investigator's sweep**, 1 by the verifier |
| Siblings checked · failing found · fixed | 17 · 7 · 7 |
| A closed family coming back later | **0** |
| Probes · calibrated on a known-bad | 51 · 45 |
| Wall clock, dispatch to final report | **2 h 16 min** (17:43 → 19:59 IST) |
| Commits per seat | builder-a 34 · coordinator 17 · investigator 12 · builder-b 10 · verifier 8 |
| Human messages in the room | 3 (the dispatch + 2 wake-ups, see [Limits](#limits)) |

## The best catch

At stage 1 the verifier rejected one thing: a seeded booking reference `bad` was accepted by
`POST /_test/reset`. A normal factory fixes that line. Our investigator traced it to spec line L1.41
and saw the real rule underneath: **data entering through reset or import never went through the
checks the API applies**. It swept 9 siblings and found **5 more that nobody had reported**: two seeded
bookings overlapping on one table, a booking on another restaurant's table, duplicate restaurant ids,
duplicate user ids, and a booking for a user who doesn't exist. All fixed, all probes kept.

The family then went forward as a RISK. At stage 2 the same sweep caught a seeded party bigger than
its tables (INC-2); at stage 3 it caught unknown managers accepted on import (INC-3). **All 8 defects
of the run trace to that one origin.**

## How to read this repo

`mandates/` the five seats · `room.json` the whole room, unedited · `stage-1/ … stage-4/` the app,
written by the band · `factory/` work items, handoffs, decisions, shared code, families, the record ·
`ledger/` requirement items · `checks/` probes + calibration · `incidents/` incident cards ·
`evidence/` every number's source · `tools/` blast (origin + family + card check), hooks, metrics.

## Limits

- **Two wake-up messages.** In Band, a seat wakes only when a message names it; there is no timer.
  Twice, a seat ended its turn before posting its result, which left the room idle with nothing to
  wake it. With limited model usage left, we sent one wake-up message each time (19:22 and 19:46)
  instead of rerunning the whole factory. They contain no hints or instructions about the work — they
  only ask the seat to finish and report. The mandates now tell every seat never to end a turn
  without its result line.
- **Holdout 168/169.** HO-4-09 (planning at the size limit) failed at its own setup: the service
  refused the case's seed with "two confirmed reservations overlap on one table". We have not settled
  whether the case's seed or the service is wrong; it is counted as a failure.
- **Work split.** builder-a carried most of the stage code (it copies each stage folder forward, which
  counts those lines as its own); builder-b owned a smaller set of features each stage.
- **Ledger coverage.** At stage 1 the verifier probed 11 of 61 ledger items itself (recorded in
  `factory/record.md`); the official checks, the sweeps and the holdout cover the rest.
- **Not measured:** model spend in dollars (seats ran on subscriptions), a solo-agent baseline and the
  generic run on the other track: "—".
- **Earlier attempts.** Two judged-run attempts were stopped before this one (commits blocked by a
  permission check; a stalled seat). This repository is a fresh run from one dispatch.

## Built with

BAND Desktop · Claude Code (claude-sonnet-5-5 ×3, claude-opus-5-5 for the investigator) · Codex
(gpt-5.6-terra, the verifier) · Docker · the kickoff harness. AI use: the seats wrote all code under
`stage-N/` and the factory files they own. Claude Code, outside the room, wrote the factory tools
(`tools/`), the sealed holdout, the mandates with Rohit, and this README.
