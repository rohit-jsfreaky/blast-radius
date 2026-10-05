# Blast Radius — sealed holdout exam (tablekeeper)

A private exam for the restaurant booking service the band builds in the WeAreDevelopers x
BAND Dark Factory hackathon. It stands in for the judges' hidden suite: the shipped checks
show only part of each stage, and this exam asks what they never ask. It is used **after**
a run to compare the factory with a solo agent and to run flip tests.

**Sealed.** The band never sees this folder. Before a run only its SHA-256 goes into the
result repo (`factory/holdout.sha256`). After the run the folder is copied to
`evidence/holdout/` and re-hashed; the hash must match. The hash script lives in the factory
repo (`factory/tools-src/holdout_hash.py`), not here.

## What is inside

| path | what |
|---|---|
| `cases/test_s1.py` … `test_s4.py`, `test_s2_browser.py` | the cases (pytest + httpx; Playwright for browser cases) |
| `cases/holdout_lib.py`, `browser_lib.py`, `conftest.py` | client, fixtures, time helpers, result capture |
| `cases/replan_ref.py` | exhaustive reference for stage-4 seating plans (3-level tie-break) |
| `selftest/test_replan_ref.py` | hand-worked unit tests of that reference (11) |
| `selftest/check_quotes.py` | checks every case quote is verbatim in the spec, ids unique |
| `spec-snapshot/` | the four spec files the cases quote (kickoff commit 803560d) |
| `runner/` | the runner image: same Dockerfile and pins as the official harness runner |
| `run_holdout.py` | builds, isolates, runs, scores, cleans up |
| `calibration/` | calibration outputs (left out of the hash) |

Every case has an id `HO-<stage>-<n>`, a docstring with the exact spec sentence it tests,
and one line saying why no shipped check covers it. Expected results come from the spec
text only.

## Case counts

| stage | cases | of which browser | weight note |
|---|---|---|---|
| 1 | 35 | 0 | hidden share 17% |
| 2 | 31 | 13 | 18 API + 13 browser |
| 3 | 63 | 0 | hidden share 89%, weighted up |
| 4 | 40 | 1 | hidden share 79%; replans checked against the exhaustive reference |
| **all** | **169** | **14** | |

Fixtures vary what the spec allows: Europe/Berlin and America/New_York DST days (2026 and
2027), Asia/Kolkata (+05:30), 15/20/30/45/60-minute grids, 45–120-minute durations,
non-sorted declared pairs, policies published out of date order, 6 tables / 4 pairs /
6 considered bookings. Populated export → import chains are in stages 1–4
(HO-1-26/27/28, HO-2-15/17/26/27, HO-3-54/55, HO-4-38/39).

## How to run

Needs Docker and any Python 3.9+ on the host (the runner script is stdlib only).

```
python run_holdout.py --folder <result>/stage-3 --stage 3 --out <new dir>
python run_holdout.py --image <tag> --stage 4 --out <new dir>
python run_holdout.py --folder <result>/stage-4 --previous-folder <result>/stage-3 --stage 4 --out <new dir>
```

- Builds the folder's Dockerfile, runs it with `-e PORT=8080 --cpus 2 --memory 2g` on a fresh
  `--internal` network (no outbound), waits up to 60 s for `/health`, then runs the cases of
  stages 1..N from the runner container on the same network (as harness isolated mode does).
- `--previous-folder` (optional) starts the earlier stage too and uses it as the export source
  for the upgrade cases (HO-2-15, HO-3-54, HO-4-39). Without it they export from the service
  itself. Those cases only use stage-1 (HO-4-39: stage-3) features on the source.
- Writes only into `--out`: `holdout.json` (summary + per case: id, stage, result, quote,
  why-not-shipped, failure, response excerpt), `summary.txt` (one line), `pytest.log`,
  `service.log`. Never writes inside the target folder. Removes its containers, network and
  built images; keeps only the cached runner image `blast-holdout-runner:<hash>`.
- `-k <expr>` passes a pytest selection (debugging only; a scored run uses no `-k`).
- Time: about 50 s for all four stages against a working service; about 3 minutes against
  an empty one (browser waits time out). The first run builds the runner image (~2.5 min).

Self-checks: `python selftest/check_quotes.py` and `python -m pytest selftest -q -p no:cacheprovider`.

## Calibration (4 Oct 2026)

See `calibration/` for the raw outputs.

1. **Kickoff scaffold** (copied to a temp folder, built, all four stages): **1/169 pass.**
   The only pass is HO-1-01 (health body and content type), which the scaffold really
   implements. Every other case fails (`calibration/scaffold/`, 172 s).
2. **Reference stub** (a throwaway stdlib implementation of stages 1–4 plus a minimal UI,
   written in a temp folder by the same author, never in this folder): **169/169 pass**
   (`calibration/reference-stub/`, 49 s). The same stub also passes **every shipped check**
   (stage 1 120/120, stage 2 25/25, stage 3 7/7, stage 4 6/6), so the exam and the official
   checks agree on a working service. The first stub run found 3 exam bugs (HO-4-28/31/32
   used a blocker that overlapped the old slot too); they were fixed before sealing.
3. **Mutations of that stub**: one realistic bug at a time, then both the holdout and the
   shipped checks run against it (`calibration/mutations-*.json`).

| bug put in | holdout cases that fail | shipped checks |
|---|---|---|
| duration counted in wall-clock time on DST nights | HO-1-08, 1-09, 3-41 | catch it (1) |
| explain drops `no_overlap` when capacity already fails | HO-3-02 | catch it (1) |
| no-op PATCH writes history and bumps revision | HO-3-07, 3-12, 3-30, 3-58 | all pass |
| replan uses today's capacities, not the booking's accepted terms | HO-4-08 | all pass |
| third tie-break read in reverse reference order | HO-4-07 | all pass |
| series amendment marks exceptions | HO-4-26, 4-27, 4-35 | all pass |
| UI lets a late search response overwrite a newer one | HO-2-19 | all pass |
| UI mints a new idempotency key on every submit | HO-2-21, 2-27 | catch it (1) |
| idempotency key not scoped by path | HO-1-13 | all pass |
| replan preview bumps the restaurant revision | 17 stage-4 cases | all pass |
| newest published policy wins whatever its effective date | HO-3-23 | all pass |
| history lists changed fields alphabetically | HO-3-06, 3-57 | all pass |
| batch moves checked against old positions (no swaps) | HO-1-29, 1-31, 1-34, 2-10, 2-17, 3-60, 3-62, 3-63 | all pass |
| import merges instead of replacing | HO-1-27 | all pass |

The holdout catches **14 of 14**; the shipped checks catch **3 of 14**. These are bugs the
same author chose, so this shows the exam bites where it was aimed, not how it compares
with the judges' hidden suite.

## Known limits (say them out loud)

- **Same author, same spec.** A Claude model wrote these cases from the same spec the
  builders read, so it can share their misreadings. It is a proxy for the hidden suite, not
  the hidden suite. The reference stub was written by the same author, so it passing shows
  the cases are consistent and passable, not that they are right.
- **Judgment calls** where the spec could be read another way: booleans in policy integers
  give 422 (spec: "booleans are not integers"; §5 would make other wrong types 400);
  `null`/missing `party_size` is 422; a malformed `Authorization` with no idempotency key is
  401 (auth before idempotency, §7); a no-op PATCH on a cancelled or in-cutoff booking is
  409; in history a single→pair change lists `from: ["<id>"]`; an unavailable combination
  cell may be absent or `data-available="false"`.
- **Browser cases assume a client-side retry.** Lost-response cases (HO-2-21/22/27) fail the
  booking request inside the browser with Playwright routing; a UI that books with a plain
  form navigation cannot show `booking-uncertain` and fails them (the spec requires it).
- **Concurrency cases are races.** A pass shows no anomaly in that run, not that none exists.
- **Dates.** Most cases use dates relative to today. Fixed DST dates are in 2026 and 2027;
  HO-3-40/41/42 and HO-4-34 need their 2027 anchors in the future (valid until March 2027).
- **Not covered:** visual quality and accessibility beyond the 375 px no-scroll check,
  planning limits above 6/4/6 (spec says "may"), cutoff on series amendments (needs a booking
  already inside its cutoff when adopted, which adoption forbids).
- Stage 1 has more cases than the ~25 target (35) and stage 3 more than ~45 (63).
