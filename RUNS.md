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

## 2026-07-30 — HARD baseline rehearsal, dev slice (Phase 6d)

```
approach:      mode=hard picker=none repair=off prompt=v1 model=claude-sonnet-5 effort=medium concurrency=15
question set:  dev-slice (100)
accuracy:      59.0%
table recall:  100% — structural: all 75 tables are always sent
noise band:    ±2.5 points (dev slice, 3 trials, 2026-07-30)
verdict:       kept
note:          The rehearsal before the pre-approved full baseline: pipeline,
               recorded config (hard/none/off/v1/medium, 75 tables per prompt),
               and a sane number, all confirmed. 59% sits at the top of the
               EASY dev-slice range (52-58) — sending all 75 tables costs
               nothing on the slice. 2 pg errors, 0 voids.
               1,494,456 in / 13,629 out (2,622 thinking) — $3.13.
export:        runs/2026-07-30-193533-hard-none-dev.json
```

## 2026-07-30 — HARD baseline on all 500 ⭐ README row 1

```
approach:      mode=hard picker=none repair=off prompt=v1 model=claude-sonnet-5 effort=medium concurrency=15
question set:  full (500 validated)
accuracy:      54.6% (273/500)
table recall:  100% — structural: all 75 tables are always sent
noise band:    ±2.5 points (dev slice, 3 trials, same day)
verdict:       kept
note:          The improvement table's first row (ADR 0003): no table
               selection at all. By difficulty: simple 96/148 (65%), moderate
               133/250 (53%), challenging 44/102 (43%). 11 Postgres errors,
               0 voids. Statistically identical to EASY's 55.4% — with the
               whole catalog in the prompt, not knowing which database the
               question belongs to costs nothing; the 75-table prompt's cost
               is dollars, not accuracy. Triage: 0 table missing / 11 never
               valid / 94 comparator suspect / 122 valid but wrong.
               7,473,114 in / 75,863 out (19,673 thinking) — $15.70.
export:        runs/2026-07-30-193710-hard-none-full.json
```

## 2026-07-30 — HARD + llm picker on all 500 ⭐ README row 2

```
approach:      mode=hard picker=llm repair=off prompt=v1 pickerPrompt=picker-v1 model=claude-sonnet-5 effort=medium concurrency=50
question set:  full (500 validated)
accuracy:      55.4% (277/500)
table recall:  86.0%
noise band:    ±2.5 points (dev slice, 3 trials, same day)
verdict:       kept
note:          The improvement table's second row. Against the baseline's
               54.6%: +0.8 points — inside the band, a tie on accuracy. What
               the picker actually bought is cost: $6.31 vs $15.70 per run
               (2.7M vs 7.5M input tokens), sending 2.1 tables on average
               instead of 75. Recall fell to 86% (55 questions had a needed
               table missing) yet accuracy held — on recall hits the smaller
               prompt answers better, which offsets the misses exactly.
               By difficulty: simple 94/148, moderate 137/250, challenging
               46/102. 10 pg errors, 0 voids. Triage: 55 table missing /
               5 never valid / 67 comparator suspect / 96 valid but wrong.
export:        runs/2026-07-30-194011-hard-llm-full.json
```

## 2026-07-30 — Repair wiring smoke (LIMIT=3)

```
approach:      mode=hard picker=llm repair=on limit=3, dev slice
accuracy:      wiring smoke — number meaningless by construction
verdict:       void
note:          repair=on stamped in the suite name and on every row, attempts
               recorded. No pg error among the 3, so the live retry stayed
               idle — the stopping conditions are covered by src/answer.test.ts.
export:        runs/2026-07-30-194201-hard-llm-repair-smoke.json
```

## 2026-07-30 — HARD + llm + self-repair on all 500 ⭐ README row 3

```
approach:      mode=hard picker=llm repair=on prompt=v1 pickerPrompt=picker-v1 model=claude-sonnet-5 effort=medium concurrency=50
question set:  full (500 validated)
accuracy:      54.8% (274/500)
table recall:  85.4%
noise band:    ±2.5 points (dev slice, 3 trials, same day)
verdict:       kept
note:          The improvement table's third row, and a clean negative result.
               Against row 2's 55.4%: -0.6 points — inside the band, a tie.
               What repair actually did: 11 questions retried, and the final
               Postgres error count fell 10 -> 0 — every repaired query now
               *executes*. But executing is not correct: 1 of the 11 ended
               correct (on attempt 3), the other 10 moved from "never valid"
               to "valid but wrong". Repair fixes executability, and
               executability was never the bottleneck — only ~2% of questions
               fail to execute. Attempts: 489x1 / 10x2 / 1x3, so the loop
               cost almost nothing ($6.38 vs $6.31). Fixed on attempt 2: 0;
               on attempt 3: 1. Triage: 61 table missing / 0 never valid /
               70 comparator suspect / 95 valid but wrong. 0 voids.
export:        runs/2026-07-30-194223-hard-llm-repair-full.json
```

---

## 2026-07-31 — Comparator reversed to BIRD's set comparison (D23)

Duplicate rows stopped being a difference. Every full run below was re-graded
from its stored SQL by `npm run rescore` — no model calls, no new eval runs, the
same static database. The entries above are untouched and remain the record of
what multiset grading gave; the numbers below supersede them.

**The exports still hold the old verdicts.** `runs/*.json` records the `correct`
flag as it was scored at run time. Re-scoring reads the SQL out of the export
and re-executes it; it does not rewrite the file. A number read straight out of
an export predating 2026-07-31 is a multiset number.

### Noise band, re-derived under the new rule

```
approach:      mode=easy picker=none repair=off prompt=v1 model=claude-sonnet-5 effort=medium trials=3
question set:  dev-slice (100), each question 3x — the stored Phase 5c run, re-graded
accuracy:      55.0% / 60.0% / 60.0% per trial   (was 52 / 57 / 57)
noise band:    ±2.5 points — unchanged
verdict:       kept
note:          The band had to be re-derived: a band measured under the old
               comparator is not the band the new numbers are read against. It
               came out identical, so every "inside the band" call below stands
               for the same reason it did before.
export:        runs/2026-07-30-152816-easy-dev.json (re-graded, not re-run)
```

### HARD baseline on all 500 — README row 1, re-scored

```
approach:      mode=hard picker=none repair=off prompt=v1 model=claude-sonnet-5 effort=medium
question set:  full (500 validated)
accuracy:      57.4% (287/500)   — was 54.6% (273/500)
table recall:  100% — structural, unchanged by grading
noise band:    ±2.5 points (dev slice, 3 trials, re-derived 2026-07-31)
verdict:       kept
note:          +2.8 points from grading alone. By difficulty: simple 101/148
               (68%), moderate 140/250 (56%), challenging 46/102 (45%).
               15 questions gained, 1 lost — and the loss is not a regression:
               bird-0003 sums a float column to ~4.0e8, Postgres parallelizes
               the aggregate, and 50 identical executions return 5 distinct
               values straddling the comparator's 6-decimal rounding. That
               question is a coin flip run to run, under either comparator.
export:        runs/2026-07-30-193710-hard-none-full.json (re-graded)
```

### HARD + llm picker on all 500 — README row 2, re-scored

```
approach:      mode=hard picker=llm repair=off prompt=v1 pickerPrompt=picker-v1 model=claude-sonnet-5 effort=medium
question set:  full (500 validated)
accuracy:      59.2% (296/500)   — was 55.4% (277/500)
table recall:  86.0% — unchanged by grading
noise band:    ±2.5 points (dev slice, 3 trials, re-derived 2026-07-31)
verdict:       kept
note:          +3.8 points, the largest gain of the four — the smaller prompt
               produces more of the duplicate-row near-misses that set
               comparison now forgives. Against the re-scored baseline's 57.4%:
               +1.8 points, still inside the band, still a tie on accuracy.
               The picker's result is unchanged in kind: it bought cost, not
               accuracy. By difficulty: simple 101/148, moderate 144/250,
               challenging 51/102. 20 gained, 1 lost (bird-0003, as above).
export:        runs/2026-07-30-194011-hard-llm-full.json (re-graded)
```

### HARD + llm + self-repair on all 500 — README row 3, re-scored

```
approach:      mode=hard picker=llm repair=on prompt=v1 pickerPrompt=picker-v1 model=claude-sonnet-5 effort=medium
question set:  full (500 validated)
accuracy:      58.8% (294/500)   — was 54.8% (274/500)
table recall:  85.4% — unchanged by grading
noise band:    ±2.5 points (dev slice, 3 trials, re-derived 2026-07-31)
verdict:       kept
note:          +4.0 points. Against row 2's re-scored 59.2%: -0.4 points, a
               tie. Self-repair remains a clean negative result under the new
               grading — it fixes executability, which was never the
               bottleneck. By difficulty: simple 100/148, moderate 143/250,
               challenging 51/102. 21 gained, 1 lost.
               Two re-scoring passes of this run gave 295 and 294: bird-0003
               flipped between them. Every number in this section carries ±0.2
               points from that one question — see the baseline entry above for
               why it is not stable under any comparator.
               Confidence heuristic, re-measured on this run: flagged (empty
               result or repaired) 40 questions -> 2.5% correct, unchanged;
               everything else 460 questions -> 63.7% correct, up from 59.3%.
export:        runs/2026-07-30-194223-hard-llm-repair-full.json (re-graded)
```

### EASY on all 500 — the yardstick, re-scored

```
approach:      mode=easy picker=none repair=off prompt=v1 model=claude-sonnet-5 effort=medium
question set:  full (500 validated)
accuracy:      58.4% (292/500)   — was 55.4% (277/500)
noise band:    ±2.5 points (dev slice, 3 trials, re-derived 2026-07-31)
verdict:       kept
note:          +3.0 points. Against the re-scored HARD baseline's 57.4%: +1.0,
               inside the band. Not knowing which database a question belongs
               to still costs nothing when the whole catalog is in the prompt —
               the finding survives the grading change intact. Re-scored under
               ADR 0002: the yardstick is re-graded, never re-tuned.
               By difficulty: simple 100/148, moderate 140/250, challenging
               52/102. 16 gained, 1 lost (bird-0003, as above).
export:        runs/2026-07-30-153025-easy-full.json (re-graded)
```

## 2026-07-31 — prompt v2: an output-contract rule for the extra-column failure

```
approach:      mode=hard picker=none repair=off prompt=v2 model=claude-sonnet-5 effort=medium concurrency=15 trials=3
question set:  dev-slice (100)
accuracy:      57.0% (171/300 over 3 trials) — 58.0 / 55.0 / 58.0
table recall:  100% — structural: all 75 tables are always sent
noise band:    ±1.5 measured here over 3 trials; read against the published ±2.5
verdict:       rejected
note:          v1 with two rules added: return exactly the columns asked for,
               and never select a column you only sorted, grouped, or filtered
               by. Aimed at the largest failure bucket — 78 of 227 baseline
               failures return the wrong number of columns.

               Against v1 on the same slice, re-graded under the current
               comparator on the same day: 62.0% -> 57.0%. Down 5 points, and
               v2's best trial (58.0) sits below v1's single run. v1 is one
               trial, so "5 points worse" overstates it; the defensible claim is
               that v2 did not help and may have hurt.

               By difficulty: simple 60/93 (64.5%), moderate 81/150 (54.0%),
               challenging 30/57 (52.6%). 7 pg errors (2.3%, v1 had 2.0%), 0
               voids. 4,507,968 in / 50,218 out (14,313 thinking) — $9.52.

               The rule did not move the failure it was written for. Column-count
               mismatches went 13.0% -> 15.0%, inside noise either way. What did
               move is empty results: 3.0% -> 6.7%.

               Per-question diff (both runs re-graded, no model calls): only 5
               of 100 questions changed consistently — 4 regressions, 1 gain.
               Nine questions answered differently across v2's own three
               identical trials, which is the slice's built-in wobble and the
               reason a 2-point effect is not visible on 100 questions.

               Reading the 4 regressions gives the mechanism. bird-0472 is the
               clear case: told not to *select* the column it sorted by, the
               model stopped *sorting*. It rewrote "order by salary, take the
               top" as "where salary = (SELECT MAX(salary))", which returns zero
               rows whenever the two conditions do not coincide. bird-0388
               dropped a join it needed. The other two — a lowercase string
               literal, a school name pulled from the wrong table — are ordinary
               variance, not the rule.

               Why no prompt fixes this bucket: the reference queries do not
               agree with each other. bird-0004 and bird-0057 exclude the sorted
               column; bird-0088 includes it; bird-0078 answers only half of a
               two-part question. The "correct" column set is not derivable from
               the question, so a rule that is followed consistently is
               guaranteed to be wrong somewhere. The bucket was also smaller
               than it looked: of the 78 column-count failures, 38 have the
               wrong row count too and were never column-limited. The real
               ceiling was 40 questions (8% of the set), not 34% of failures.

               Treated as a measurement limit, not a tuning target. v2 is not
               promoted; src/prompts/v2.ts stays in the repo as the evidence
               behind this entry.
export:        runs/2026-07-31-122519-hard-none-dev.json
```

## 2026-07-31 — Batch E wiring smokes (LIMIT=3), six runs

```
approach:      mode=hard picker=llm limit=3, one smoke per new experiment axis:
               PICKER_PROMPT=picker-v2 | EXPAND=on | SQL_CONTEXT=rows,values,desc |
               PICKER_CONTEXT=values,desc | CHECK=probe | CHECK=self
accuracy:      wiring smokes — numbers meaningless by construction (LIMIT stamps the run name)
verdict:       void
note:          Every axis stamps the suite name and every exported row; 0 voids,
               18/18 questions scored. EXPAND visibly fires (4 tables sent vs
               the picker's 1-2). CHECK=self confirmed all 3; CHECK=probe never
               triggered on 3 questions (no empty result among them) — its flow
               is covered by src/check.test.ts. Extras cost, measured while
               building: SQL-prompt rows ~10.0k / values ~3.4k / desc ~11.8k
               tokens across all 75 tables (per-question cost scales with
               tables sent); picker extras add ~3.0k (values) and ~11.3k (desc)
               tokens to every picker call — desc-picker will run ~$17, not the
               ~$9 estimated.
export:        runs/2026-07-31-1513*-exp-smoke-*.json (six files)
```

---

## 2026-07-31 — Batch E: test everything, one change per run

Ten single-change runs against a same-day control, all full-500, all read
against the published ±2.5 band. Verdict rule pre-registered before any run:
kept only if the change beats the control by more than the band. The eleven
runs below cost $105 against the ~$86 estimate; the overage is desc-picker
($21 measured vs $9 estimated) and the voided first control (~$6).

## 2026-07-31 — Batch E control, first attempt: voided, store collision

```
approach:      mode=hard picker=llm repair=off prompt=v1 pickerPrompt=picker-v1 model=claude-sonnet-5 effort=medium concurrency=25
question set:  full (500 validated)
accuracy:      none — the export is empty
verdict:       void
note:          Ran concurrently with the picker-v2 run to halve wall-clock.
               Both processes share .evalite/evalite.db, both were assigned
               run id 25, and this one's export lost the race: suites: [].
               The model calls happened (~$6) and are unrecoverable as
               evidence. evalite's store is single-process — every later run
               in the batch ran sequentially. The picker-v2 run that shared
               the store carries its full 500 rows, every row stamped with
               its own config, and survives (next entry).
export:        runs/2026-07-31-151521-hard-llm-full.json (empty by design of the failure)
```

## 2026-07-31 — Batch E run 1: picker-v2, the over-include rule

```
approach:      mode=hard picker=llm repair=off prompt=v1 pickerPrompt=picker-v2 model=claude-sonnet-5 effort=medium concurrency=25
question set:  full (500 validated)
accuracy:      58.4% (292/500)
table recall:  87.0%
noise band:    ±2.5 points (dev slice, 3 trials, re-derived 2026-07-31)
verdict:       rejected
note:          Replaced "Fewer is better when you are confident" with "Include
               every table that might be needed — a missing table makes the
               query impossible, an extra one only costs tokens." The picker
               ignored it: 2.11 tables sent on average vs the control's 2.10,
               recall 87.0% vs 86.2%. Accuracy +0.6 vs control — a tie. Diff:
               18 gained, 15 lost — ordinary variance, not a mechanism. The
               under-selection is not steered by that prompt line; whatever
               sets the picker's appetite, it is not being told which way to
               err. Pre-registered verdict rule from PLAN-picker-v2.md
               applied; the plan file is deleted with this entry. $6.36.
export:        runs/2026-07-31-151524-exp-picker-v2-full.json
```

## 2026-07-31 — Batch E run 0: the control ⭐ every Batch E number reads against this

```
approach:      mode=hard picker=llm repair=off prompt=v1 pickerPrompt=picker-v1 model=claude-sonnet-5 effort=medium concurrency=50
question set:  full (500 validated)
accuracy:      57.8% (289/500)
table recall:  86.2%
noise band:    ±2.5 points (dev slice, 3 trials, re-derived 2026-07-31)
verdict:       kept
note:          Same configuration as README row 2, re-run same-day so every
               Batch E delta is measured against today's model behavior, not
               yesterday's. Against the stored re-scored 59.2%: -1.4 points,
               inside the band — no drift. Triage: 57 table missing / 4 never
               valid / 69 comparator suspect / 81 valid but wrong. 0 voids.
               Avg 2.10 tables sent. $6.33.
export:        runs/2026-07-31-151918-hard-llm-full.json
```

## 2026-07-31 — Batch E run 2: join-partner expansion

```
approach:      mode=hard picker=llm expand=on repair=off prompt=v1 pickerPrompt=picker-v1 model=claude-sonnet-5 effort=medium concurrency=50
question set:  full (500 validated)
accuracy:      58.2% (291/500)
table recall:  95.0%
noise band:    ±2.5 points (dev slice, 3 trials, re-derived 2026-07-31)
verdict:       rejected
note:          After the picker chooses, add every table sharing a distinctive
               column name (shared by ≤4 tables); 5.63 tables sent on average.
               Recall jumped 86.2% -> 95.0% — the offline prediction (94.8%)
               was exact — and accuracy moved +0.4, a tie. This is the
               pre-registered negative shape: the missing-table failures were
               hard for reasons beyond the missing table. Triage says where
               the gain went: table missing 57 -> 19, but comparator suspect
               69 -> 95 and valid-but-wrong 81 -> 88 — handed the right
               tables plus extras, the model writes join-multiplied or
               wrong-join queries at almost the same rate it used to write
               impossible ones. Recall was never the binding constraint. $6.97.
export:        runs/2026-07-31-152021-exp-expand-full.json
```

## 2026-07-31 — Batch E run 3: five sample rows per table ⭐ beat the band

```
approach:      mode=hard picker=llm sqlContext=rows repair=off prompt=v1 pickerPrompt=picker-v1 model=claude-sonnet-5 effort=medium concurrency=50
question set:  full (500 validated)
accuracy:      61.0% (305/500)
table recall:  85.4%
noise band:    ±2.5 points (dev slice, 3 trials, re-derived 2026-07-31)
verdict:       kept
note:          Five real rows per table, every column cast to text so dates
               and codes are spelled exactly as a correct literal would spell
               them, appended as comments under each CREATE TABLE. +3.2 vs
               control — past the band, barely. Diff: 34 gained, 18 lost.
               Comparator-suspect failures (right shape, wrong values)
               69 -> 59 — seeing real values fixes value-blindness, which the
               failure analysis predicted was the second-largest lever. One
               trial; the margin over the band is 0.7 points, so a repeat
               would be cheap insurance before promoting to the README. $7.34.
export:        runs/2026-07-31-152120-exp-rows-full.json
```

## 2026-07-31 — Batch E run 4: distinct-value lists in the SQL prompt

```
approach:      mode=hard picker=llm sqlContext=values repair=off prompt=v1 pickerPrompt=picker-v1 model=claude-sonnet-5 effort=medium concurrency=50
question set:  full (500 validated)
accuracy:      59.2% (296/500)
table recall:  86.4%
noise band:    ±2.5 points (dev slice, 3 trials, re-derived 2026-07-31)
verdict:       rejected
note:          Every text column with ≤20 distinct values gets them listed
               under its CREATE TABLE. +1.4 vs control — a tie. The weaker
               sibling of run 3: value lists only cover short-list columns
               (114 of 329 text columns), while sample rows show every column
               including the long-tail ones the failures actually filter on.
               Rows subsume values; no reason to ship both. $6.58.
export:        runs/2026-07-31-152223-exp-values-sql-full.json
```

## 2026-07-31 — Batch E run 5: distinct-value lists in the picker prompt

```
approach:      mode=hard picker=llm pickerContext=values repair=off prompt=v1 pickerPrompt=picker-v1 model=claude-sonnet-5 effort=medium concurrency=50
question set:  full (500 validated)
accuracy:      58.6% (293/500)
table recall:  88.8%
noise band:    ±2.5 points (dev slice, 3 trials, re-derived 2026-07-31)
verdict:       rejected
note:          Same value lists, shown to the picker instead. Recall +2.6,
               accuracy +0.8 — both inside noise, at nearly double the cost
               ($11.91 vs $6.33; the lists add ~3k input tokens to every
               picker call). $11.91.
export:        runs/2026-07-31-152329-exp-values-picker-full.json
```

## 2026-07-31 — Batch E run 6: BIRD column descriptions in the SQL prompt

```
approach:      mode=hard picker=llm sqlContext=desc repair=off prompt=v1 pickerPrompt=picker-v1 model=claude-sonnet-5 effort=medium concurrency=50
question set:  full (500 validated)
accuracy:      58.6% (293/500)
table recall:  85.6%
noise band:    ±2.5 points (dev slice, 3 trials, re-derived 2026-07-31)
verdict:       rejected
note:          The number D5 owed. BIRD's database_description CSVs (first
               sentence, 160-char cap, name-echo descriptions dropped) as
               comments under each CREATE TABLE. +0.8 vs control — a tie,
               confirming D5's hypothesis: descriptions say what a column
               means, the failures need what a column holds. Only ~2% of
               descriptions name actual values. Run 3 is the same token
               budget spent on the thing that works. $7.15.
export:        runs/2026-07-31-152439-exp-desc-sql-full.json
```

## 2026-07-31 — Batch E run 7: BIRD descriptions in the picker prompt — voided

```
approach:      mode=hard picker=llm pickerContext=desc repair=off prompt=v1 pickerPrompt=picker-v1 model=claude-sonnet-5 effort=medium concurrency=50
question set:  full (500 validated), 465 scored
accuracy:      57.6% (268/465) — never comparable: 35 voids
verdict:       void
note:          Descriptions add ~11.3k input tokens to every picker call; at
               concurrency 50 that blew through the 5M/min input-token
               ceiling and 35 questions 429'd past all five SDK retries
               (D12b: any void voids the run). $20.97 spent — the batch
               estimate said $9; the smoke-measured projection ($17) was
               known before launch and accepted, the voids were not. A clean
               re-run needs CONCURRENCY≈15 and ~$21 more; not taken, because
               the scored subset sits dead on the control and both sibling
               experiments (runs 5, 6) were ties — the expected information
               value does not cover the cost. Julian's call if the number is
               wanted anyway.
export:        runs/2026-07-31-152536-exp-desc-picker-full.json
```

## 2026-07-31 — Batch E run 8: probe-on-empty

```
approach:      mode=hard picker=llm check=probe check-v1 repair=off prompt=v1 pickerPrompt=picker-v1 model=claude-sonnet-5 effort=medium concurrency=50
question set:  full (500 validated)
accuracy:      60.2% (301/500)
table recall:  85.6%
noise band:    ±2.5 points (dev slice, 3 trials, re-derived 2026-07-31)
verdict:       rejected
note:          When a query runs and returns zero rows, the model writes one
               exploratory query, sees its result, and rewrites. Fired on 26
               of 500; 12 of the 26 ended correct — a 46% rescue rate on a
               bucket that historically scores ~2.5%. But the bucket is too
               small: +2.4 vs control, inside the band by 0.1 points. The
               mechanism works and the trigger is starved — exactly the
               inverse of self-repair, which had a big trigger and no
               mechanism. Cheapest experiment of the batch (+$0.17 over
               control). $6.50.
export:        runs/2026-07-31-152651-exp-probe-full.json
```

## 2026-07-31 — Batch E run 9: self-check every result ⭐ beat the band

```
approach:      mode=hard picker=llm check=self check-v1 repair=off prompt=v1 pickerPrompt=picker-v1 model=claude-sonnet-5 effort=medium concurrency=50
question set:  full (500 validated)
accuracy:      61.4% (307/500)
table recall:  86.0%
noise band:    ±2.5 points (dev slice, 3 trials, re-derived 2026-07-31)
verdict:       kept
note:          Every executed result goes back to the model — confirm or
               rewrite. Julian's idea, and the batch's best number: +3.6 vs
               control. It rewrote 83 of 490 ok results; 45% of rewrites
               ended correct. Diff: 35 gained, 16 lost — the 16 are answers
               it talked itself out of. Confirmed answers score 66% vs the
               run's 61.4% overall, so its own confidence carries signal.
               +$1.96 per run over control. One trial, 1.1 points past the
               band — same repeat-trial caveat as run 3. $8.29.
export:        runs/2026-07-31-152802-exp-self-full.json
```

## 2026-07-31 — Batch E run 10: stack the winners (rows + self-check)

```
approach:      mode=hard picker=llm sqlContext=rows check=self check-v1 repair=off prompt=v1 pickerPrompt=picker-v1 model=claude-sonnet-5 effort=medium concurrency=50
question set:  full (500 validated)
accuracy:      60.0% (300/500)
table recall:  85.0%
noise band:    ±2.5 points (dev band, 3 trials, re-derived 2026-07-31)
verdict:       rejected
note:          The two band-beating changes together, and the batch's most
               instructive negative: 60.0 lands below rows alone (61.0) and
               self-check alone (61.4), +2.2 over control — a tie. The
               winners did not compose. Plausible mechanism: with sample rows
               in the prompt the first answer is already better, so the
               self-check's rewrites skew toward breaking good answers
               (63 rewrites, 43% correct — its lowest hit rate). All three
               numbers (61.0 / 61.4 / 60.0) are mutually inside the band, so
               the honest reading is: at least one of these helps by a
               little, and one 500-question trial each cannot say which.
               Repeat trials on rows and self alone are the next experiment
               worth money. Diff vs control: 36 gained, 24 lost. $10.18.
export:        runs/2026-07-31-153049-exp-stack-full.json
```

---

# Batch F — 2026-07-31, sequential build toward the final number

Two moves, one run each, every run adding one change on top of the last so the
final number decomposes into attributable steps: run A adds a counting-
convention rule to the SQL prompt on the rows base; run B adds best-of-N with
an execution-based majority vote. No repeat trials — every number reads against
the existing ±2.5 band, as all Batch E numbers did.

## 2026-07-31 — Batch F run A wiring smoke (LIMIT=3)

```
approach:      mode=hard picker=llm sqlContext=rows limit=3, prompt=v3
verdict:       void
note:          Wiring only. prompt=v3 stamps the suite name and every exported
               row; 3/3 scored, 0 voids. The stamp now reads from
               generate-sql.ts (the single prompt switch point) instead of a
               second import in the eval file — two imports that must agree
               was how a run could get mislabeled.
export:        runs/2026-07-31-180141-exp-smoke-runa-full.json
```

## 2026-07-31 — Batch F run A: counting rule (prompt v3) on the rows base

```
approach:      mode=hard picker=llm sqlContext=rows repair=off prompt=v3 pickerPrompt=picker-v1 model=claude-sonnet-5 effort=medium concurrency=50
question set:  full (500 validated)
accuracy:      61.6% (308/500)
table recall:  84.6%
noise band:    ±2.5 points (dev slice, 3 trials, re-derived 2026-07-31)
verdict:       rejected
note:          v3 = v1 plus one rule: when counting over a join, count the
               matching rows; DISTINCT only when the question asks for unique
               entities. Written for the 17 rows-run failures where generated
               SQL used COUNT(DISTINCT) and gold counts plain rows. The model
               complied — COUNT(DISTINCT) answers fell 44 -> 27, and none of
               the 6 measured at-risk answers (gold itself DISTINCT, question
               silent) was lost. But only 2 of the 17 targets converted: the
               regex signature overstated the class, and most of those 17 are
               wrong in more ways than the counting convention. +0.6 vs the
               rows run (61.0) — a tie; +3.8 vs control is the rows base
               carrying it. Churn vs rows: 23 gained, 20 lost. The rule is
               harmless but unearned; run B builds on the rows base with
               prompt v1 unless Julian keeps v3. $7.44.
export:        runs/2026-07-31-180211-exp-rows-v3-full.json
```

## 2026-07-31 — Batch F run B wiring smoke (LIMIT=3)

```
approach:      mode=hard picker=llm sqlContext=rows vote=5 limit=3, prompt=v3
verdict:       void
note:          Wiring only. vote=5 stamps the suite name; voteAgreement,
               attempts=5 and the 5x usage sum land on every exported row.
export:        runs/2026-07-31-181031-exp-smoke-runb-full.json
```

## 2026-07-31 — Batch F run B: best-of-5 by execution agreement

```
approach:      mode=hard picker=llm sqlContext=rows vote=5 repair=off prompt=v3 pickerPrompt=picker-v1 model=claude-sonnet-5 effort=medium concurrency=50
question set:  full (500 validated)
accuracy:      62.4% (312/500)
table recall:  85.4%
noise band:    ±2.5 points (dev slice, 3 trials, re-derived 2026-07-31)
verdict:       rejected
note:          Five attempts per question, run sequentially; result sets
               grouped by the row comparator; the largest group ships, ties to
               the first seen, errors cannot vote. +0.8 vs run A (61.6) — a
               tie at 2.5x the cost ($18.85 vs $7.44). Why the 71.8%
               cross-run union did not transfer: 397 of 500 questions were
               unanimous 5/5 — at effort=medium the model repeats the same
               reading almost every time, so on 79% of the set there was
               nothing to arbitrate, and 110 of those unanimous questions are
               unanimously wrong. The union came from *different
               configurations* disagreeing, never from repetition of one.
               Two findings worth keeping: never-valid failures fell to 0
               (one clean attempt outvotes any error), and agreement is a
               real confidence signal — 72.3% correct when unanimous vs ~25%
               when split — which the product path could surface. If voting
               is ever revisited, diversity per attempt (different context
               per candidate) is the measured direction; N samples of one
               config is now a dead end. Diff vs run A: 17 gained, 13 lost.
export:        runs/2026-07-31-181111-exp-vote5-full.json
```
