# Run log

Append-only. One entry per eval run, written when the run finishes. **Never edit
a past entry** — locking the number is the entire point of this file. A run with
no entry here did not happen.

The numbers are the same ones evalite exported to `runs/<id>.json`. This file is
the readable mirror, plus the judgement the export cannot hold.

## Verdicts

- **kept** — valid run, beat the previous best by more than the noise band. The
  approach stays.
- **rejected** — valid run, did not beat the previous best. The number stands as
  evidence; the approach is abandoned. A rejected run is not a failed run.
- **void** — the run is not evidence: wrong configuration, crashed mid-run, a
  model other than `claude-sonnet-5`, or responses served from a cache. The
  number is discarded and never compared to anything.

A number that changed by less than the noise band did not change. Two numbers
measured under different modes are never compared to each other.

## Entry format

```
## YYYY-MM-DD — <what changed>
approach:      mode=hard picker=llm repair=on prompt=v2 model=claude-sonnet-5
question set:  dev-slice (100) | full (500 validated)
accuracy:      00.0% (n/denominator)
table recall:  00.0%
noise band:    ±0.0 points (3 trials, YYYY-MM-DD)
verdict:       kept | rejected | void
note:          what changed since the last run, and what the number says
export:        runs/YYYY-MM-DD-<id>.json
```

---

## Rate-limit ceiling for this key

Measured 2026-07-30 from the Phase 4a smoke-test response headers, per D12b.
Authoritative for this key and model; published tier tables are not. Re-measure
if the key or the tier changes.

### Superseded 2026-07-30 — `gpt-5.6-terra`, OpenAI key

Kept for the record. The project moved to `claude-sonnet-5` before any eval run
existed, so no number here was ever compared against; these figures describe a
key the project no longer uses.

```
x-ratelimit-limit-requests:      500        per minute
x-ratelimit-limit-tokens:        500,000    per minute
x-ratelimit-reset-requests:      120ms
x-ratelimit-reset-tokens:        3ms
```

| Configuration | Prompt tokens | Questions/min at the ceiling | Binds on |
|---|---|---|---|
| EASY, 5 tables | 352 | ~500 | requests |
| Baseline, all 75 tables | 8,611 | ~58 | tokens |

### Current — 2026-07-30, `claude-sonnet-5`, Anthropic key

Re-measured after the provider switch, same way: one Phase 4a smoke call for the
headers, then Phase 4b's `ask` twice on the same question for the prompt sizes.
The tier is Build, and Sonnet 5 draws on its own bucket rather than sharing the
Sonnet 4.x one.

```
anthropic-ratelimit-requests-limit:        5,000       per minute
anthropic-ratelimit-input-tokens-limit:    5,000,000   per minute
anthropic-ratelimit-output-tokens-limit:   1,000,000   per minute
anthropic-ratelimit-tokens-limit:          6,000,000   per minute  (input + output)
```

Input and output are throttled separately here, so there are two token ceilings
rather than one. Measured at prompt v1 on `bird-0000`, EASY with its evidence and
baseline without, `EFFORT=medium`:

| Configuration | Input tokens | Output tokens | Latency | Questions/min | Binds on |
|---|---|---|---|---|---|
| EASY, 5 tables | 811 | 105 (14 thinking) | 4.5s | ~5,000 | requests |
| Baseline, all 75 tables | 14,886 | 118 (21 thinking) | 3.7s | ~336 | input tokens |

Both are one easy question — a hard one thinks more, which raises output tokens
and latency together. Treat the output column as a floor.

**D12's concurrency figures do not survive either measurement, and the second
does not simply relax the first.** The ceiling went up ~10x while the prompts
got bigger, so the EASY and baseline cases now bind on different limits. See D12
in `docs/decisions.md`.

---

## 2026-07-30 — First dev-slice run

```
approach:      mode=easy picker=none repair=off prompt=v1 model=claude-sonnet-5 effort=medium concurrency=50
question set:  dev-slice (100)
accuracy:      58.0% (58/100)
table recall:  not measured (Phase 6a)
noise band:    ±2.5 points (3 trials, 2026-07-30, measured two runs later)
verdict:       kept
note:          First number on the harness. 2 Postgres errors, 0 voids.
               184,623 in / 12,492 out — $0.49.
export:        runs/2026-07-30-152701-easy-dev.json
```

## 2026-07-30 — Sabotage check (Phase 5c)

```
approach:      mode=easy picker=none repair=off prompt=v1 model=claude-sonnet-5 effort=medium concurrency=50
question set:  dev-slice (100)
accuracy:      98.0% — comparator forced to true, meaningless by design
table recall:  not measured (Phase 6a)
noise band:    n/a
verdict:       void
note:          Grader check, not a measurement: compareRows forced to return
               true, accuracy jumped 58% -> 98%. The two holdouts are Postgres
               execution errors, which `correct = execution.ok && compareRows`
               can never lift — exactly the expected shape. The grader is wired
               in. Sabotage reverted immediately; `git diff` clean, `npm test`
               green.
export:        runs/2026-07-30-152736-easy-dev.json
```

## 2026-07-30 — Noise floor, 3 trials (Phase 5c)

```
approach:      mode=easy picker=none repair=off prompt=v1 model=claude-sonnet-5 effort=medium concurrency=50 trials=3
question set:  dev-slice (100), each question 3x
accuracy:      52% / 57% / 57% per trial
table recall:  not measured (Phase 6a)
noise band:    ±2.5 points on the dev slice over 3 trials; 10 of 100 questions
               flip between trials
verdict:       kept
note:          The band every later dev-slice comparison is read against. A
               difference under ~5 points between two dev-slice runs proves
               nothing. Generated SQL text differs across trials on 74 of 100
               questions — real model variance, not cache. 0 voids, $1.49.
export:        runs/2026-07-30-152816-easy-dev.json
```

## 2026-07-30 — eval:easy, voided: vite clobbers DEV

```
approach:      intended mode=easy slice=full; actually ran the dev slice
question set:  dev-slice (100), mislabeled as full
accuracy:      57.0% — discarded
table recall:  not measured (Phase 6a)
noise band:    n/a
verdict:       void
note:          Wrong configuration. The eval read `DEV=1` that vite itself sets
               inside every worker (vite owns MODE, DEV, PROD, BASE_URL), so the
               full run silently filtered to the dev slice. Caught because the
               run records its config: the suite name said slice=dev while the
               filename said full. Env vars renamed EVAL_MODE / EVAL_DEV — see
               the D8 amendment in docs/decisions.md.
export:        runs/2026-07-30-152905-easy-full.json
```

## 2026-07-30 — EASY on all 500 ⭐ the first accuracy number

```
approach:      mode=easy picker=none repair=off prompt=v1 model=claude-sonnet-5 effort=medium concurrency=50
question set:  full (500 validated)
accuracy:      55.4% (277/500)
table recall:  not measured (Phase 6a)
noise band:    ±2.5 points (dev slice, 3 trials, same day)
verdict:       kept
note:          The EASY yardstick (D15: run once, never tuned). By difficulty:
               simple 97/148 (66%), moderate 131/250 (52%), challenging 49/102
               (48%). 8 Postgres errors, 0 voids. The four dev-slice numbers
               (58, 52, 57, 57) bracket it — the slice predicts the full set.
               Triage: 0 table missing / 8 never valid / 92 comparator suspect
               / 123 valid but wrong. Three comparator suspects re-executed by
               hand were genuinely wrong answers of the same shape (single-row
               aggregates) — the bucket is noisy on BIRD because most answers
               are one number, not because the grader is wrong.
               925,970 in / 67,356 out (12,173 thinking) — $2.53.
export:        runs/2026-07-30-153025-easy-full.json
```

## 2026-07-30 — Bake-off wiring smokes (LIMIT=3), two runs

```
approach:      mode=hard picker=bakeoff prompt=v1 pickerPrompt=picker-v1 model=claude-sonnet-5 effort=medium limit=3
question set:  dev-slice, first 3 ids only
accuracy:      wiring smoke — number meaningless by construction (LIMIT stamps the run name)
verdict:       void
note:          Two runs. The first caught a real bug before money was spent at
               scale: the API rejects maxItems on array schemas, so every llm
               variant question 400'd in ~700ms; cap moved to the prompt and
               resolveNames. Second smoke: 3/3 both variants, recall and picker
               tokens recorded per row.
export:        runs/2026-07-30-191137-pickers-dev.json (broken llm variant)
               runs/2026-07-30-191210-pickers-dev.json (clean)
```

## 2026-07-30 — Picker bake-off, keyword vs LLM (Phase 6c) ⭐ first HARD numbers

```
approach:      mode=hard picker=bakeoff prompt=v1 pickerPrompt=picker-v1 model=claude-sonnet-5 effort=medium concurrency=50
question set:  dev-slice (100), both pickers in one evalite.each run (D9)
accuracy:      keyword 45.0% | llm 56.0%
table recall:  keyword 60.0% | llm 85.0%
noise band:    ±2.5 points (dev slice, 3 trials, 2026-07-30)
verdict:       kept
note:          First HARD-mode numbers. The gaps dwarf the band: +11 accuracy,
               +25 recall for the llm picker. Accuracy stays under recall in
               both, as it must. The llm picker sends 2.1 tables on average vs
               keyword's fill-to-10, and hard+llm (56%) lands inside the EASY
               dev-slice range (52–58) — with a good picker, not knowing the
               database label costs almost nothing on the slice. Triage, llm:
               13 table missing / 1 never valid / 12 comparator suspect /
               18 valid but wrong. keyword: 32 / 0 / 12 / 11. Pickers see the
               question only (D20). 0 voids. Cost $2.04 ($0.79 + $1.25);
               llm picker adds ~4.5k input tokens per question.
               Which picker gets the Batch D full run is Julian's call —
               the slice evidence says llm, by 10x the band.
export:        runs/2026-07-30-191255-pickers-dev.json
```
