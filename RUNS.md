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

---

## 2026-07-31 — Default set to the 61.0% configuration (wiring smoke, LIMIT=3)

```
approach:      mode=hard picker=llm limit=3, nothing else set
verdict:       void
note:          Not a measurement — the smoke that proves the new default
               resolves. Julian set the project default to the best measured
               configuration: prompt v1, llm picker, five sample rows per
               table, everything else off. Two code changes carry it:
               generate-sql.ts imports prompts/v1 (was v3), and SQL_CONTEXT
               now defaults to "rows" instead of empty, with SQL_CONTEXT=off
               to turn it back off.

               With no axis set, the suite name came back
               "prompt=v1 | sqlContext=rows", repair/check/vote all off —
               the intended default, and stamped on every row, so no run can
               read as a baseline when it is not one. 3/3 scored, 0 voids.

               The consequence to remember: every number measured before
               2026-07-31 was taken without sample rows, so reproducing one
               now requires SQL_CONTEXT=off. The stamp makes a mistake here
               visible after the fact; it does not prevent it.

               v3 stays in src/prompts/ as the evidence behind its own entry
               above. It was never promoted — a tie whose rule converted 2 of
               the 17 failures it was written for.
export:        runs/2026-07-31-204731-exp-default-check-full.json
```

---

# Batch G — 2026-08-01, the winnable-failures work list turned into fixes

Reading all 99 winnable failures by hand produced two findings and one prompt
paragraph. Finding one: the gold set is BIRD's *Postgres port*, and BIRD
patched its own side of the dialect gap — 60 of 500 gold queries carry
NULLS LAST that zero SQLite originals have — while the model keeps writing
SQLite-idiom SQL (`ORDER BY x DESC LIMIT 1` as a max picks a NULL row in
Postgres; `LIKE` on a date column is a hard 42883). Fixed in code, not prompt:
two deterministic rewrites (src/rewrites.ts, REWRITE axis, D24), measured for
free by replaying stored SQL. Finding two: output shape was the largest
failure mode — 79 of the rows run's 195 wrong answers returned the wrong
NUMBER of columns, because v1 said nothing about what belongs in the SELECT
list. Fixed in prompt v4 = v1 plus projection discipline, measured by one full
run. KNOWN_ISSUES.md issue 4 records the dialect finding.

## 2026-08-01 — Rewrites replayed over the rows run's stored SQL (no model calls)

```
approach:      npm run replay -- runs/2026-07-31-152120-exp-rows-full.json
               (stored SQL from the 61.0% run, re-executed as-is and under
               each rewrite, both sides compared to gold)
question set:  full (500 validated)
accuracy:      baseline 305/500 (61.0%) -> both rewrites 312/500 (62.4%)
noise band:    none applies — identical SQL both sides, the flip count is exact
verdict:       kept
note:          nulls-last fired on 67 queries: 5 flipped wrong->right
               (bird-0177 0235 0249 0454 0488), 0 lost — including all 11
               currently-correct answers where gold also lacks NULLS LAST,
               every one re-executed unchanged. text-cast fired on 2: both
               flipped (bird-0093 0096), 0 lost — it only ever touches a query
               that already died. +7/500 with zero losses, deterministic,
               free at measurement time. This is the evidence REWRITE=on
               ships on; the 62.4% here ties the rejected vote5 number at
               none of its 2.5x cost.
export:        printed by the script; source run file unchanged
```

## 2026-08-01 — Batch G wiring smoke (LIMIT=3)

```
approach:      mode=hard picker=llm rewrite=on prompt=v4 limit=3
verdict:       void
note:          Wiring only. prompt=v4 and rewrite=on stamp the suite name;
               rewrite and rewritesFired land on every exported row. 3/3.
export:        runs/2026-08-01-122859-exp-smoke-g1-full.json
```

## 2026-08-01 — Batch G: prompt v4 (projection) + dialect rewrites ⭐ new best

```
approach:      mode=hard picker=llm sqlContext=rows rewrite=on repair=off prompt=v4 pickerPrompt=picker-v1 model=claude-sonnet-5 effort=medium concurrency=50
question set:  full (500 validated)
accuracy:      65.6% (328/500)
table recall:  85.6%
noise band:    ±2.5 points (dev slice, 3 trials, re-derived 2026-07-31)
verdict:       kept
note:          +4.6 vs the rows run (61.0) — past the band, the first change
               to clear it by margin rather than by decimals. v4 = v1 plus
               one paragraph: SELECT exactly the asked-for columns, in the
               question's order; sort keys stay in ORDER BY; no context
               columns; hint-enumerated columns stay separate. The target
               moved as predicted: wrong-column-count failures 79 -> 47.
               Diff vs rows run: 37 gained, 14 lost, net +23 — and 35 of the
               37 gains are questions from docs/winnable-failures.md, so the
               work list converted at 35 of 99. nulls-last fired on 70
               questions in-run; text-cast fired 0 times (this generation
               happened to write ::text itself on the two date-LIKE
               questions — its evidence is the replay entry above, not this
               run). 0 voids. $7.56.

               Attribution: the replay puts the rewrites at exactly +7 on
               frozen SQL, so the prompt carries roughly the rest of the +23
               — "roughly" because regenerated SQL moves for both reasons at
               once. The 14 losses share no cause; ordinary churn at the
               band's scale.
export:        runs/2026-08-01-122927-exp-v4-rewrites-full.json
```

## 2026-08-01 — Default set to the 65.6% configuration (wiring smoke, LIMIT=3)

```
approach:      mode=hard picker=llm limit=3, nothing else set
verdict:       void
note:          Not a measurement — the smoke that proves the new default
               resolves. Default is now the Batch G configuration: prompt v4,
               llm picker, five sample rows, dialect rewrites on, everything
               else off. Two code changes carry it: generate-sql.ts imports
               prompts/v4 (was v1), and REWRITE defaults to on, with
               REWRITE=off to turn it back off.

               With nothing set, the suite name came back
               "prompt=v4 | sqlContext=rows | rewrite=on" — stamped on every
               row. 3/3 scored.

               The consequence to remember: reproducing any pre-Batch-G
               number now needs REWRITE=off, and the 61.0 run also needs the
               generate-sql import switched back to v1 — same reproduction
               rule as every earlier default change. v1, v2 and v3 stay in
               src/prompts/ as the evidence behind their own entries.
export:        runs/2026-08-01-123304-exp-default-check-g-full.json
```

## 2026-08-01 — picker-v3 (evidence in the picker), stage 1: recall only

```
approach:      picker=llm pickerPrompt=picker-v3 model=claude-sonnet-5 effort=medium concurrency=20
               recall-only measurement — 500 picker calls, no SQL generation, no accuracy number.
               Baseline for comparison: per-question tablesSent stored in the Batch G export
               (runs/2026-08-01-122927-exp-v4-rewrites-full.json, pickerPrompt=picker-v1).
question set:  full (500 validated)
table recall:  87.6% (438/500) vs baseline 85.6% (428/500); avg tables sent 2.01 vs 2.09
verdict:       rejected — as the pre-registered gate for a full stage-2 run
note:          D20's reserved experiment: picker-v3 is picker-v1 plus the BIRD
               evidence hint in the message, nothing else changed. The gate,
               set before the run: at least 12 of the 16 cluster-1 target
               questions (docs/winnable-failures.md, picker-missed-table
               failures) must flip to a recall hit. Six flipped: bird-0014,
               0039, 0041, 0045, 0266, 0356 — the ones whose evidence names
               the table or a distinctive column. Nine did not, though their
               evidence names a column of the missing table (cost, KCT,
               DisplayName, laps): reading the hint does not make the model
               do a column->owner lookup across 75 catalog lines.
               12 questions regressed hit -> miss against the single stored
               baseline sample; several look like the evidence narrowing the
               pick — the hint names two tables and the picker drops the
               middle table gold needs (0432 dropped molecule, 0070 budget,
               0439 schools). Part of the 12 is ordinary picker wobble; no
               recall noise band exists to split it.
               Net +2.0 recall at unchanged table count and unchanged cost.
               Not enough to earn stage 2 as-is. The measured follow-up:
               deterministic union — add every catalog table owning a column
               the evidence names verbatim — computable offline against this
               run's stored selections for $0 before any further model spend.
               2,268,114 in / 9,820 out (1,355 thinking) — $4.63.
export:        runs/20260801-200012-picker-v3-recall-stage1.json
               (smoke: runs/20260801-195847-picker-v3-recall-stage1.json, LIMIT=3, void)
```

## 2026-08-01 — picker-v4 (evidence + explicit lookup rules), stage 1: recall only

```
approach:      picker=llm pickerPrompt=picker-v4 model=claude-sonnet-5 effort=medium concurrency=20
               recall-only, 500 picker calls, no SQL generation. Baseline: the
               Batch G export's stored per-question selections (picker-v1).
question set:  full (500 validated)
table recall:  88.4% (442/500) vs baseline 85.6% (428/500); avg tables sent 2.05 vs 2.09
verdict:       rejected — gate unmet again (5/16 targets, needed 12)
note:          Julian's iteration on picker-v3's result, three changes bundled
               by his call: the "fewer is better" line removed, an explicit
               "include every table that has a column the hint names — scan
               the catalog for the owner" rule, and an explicit "the hint
               does not name every table, add join tables" rule.
               The instructions did not change the behavior they were aimed
               at. Column->owner lookup still does not happen: cost->expense
               (0058), KCT->examination (0127), DisplayName->users (0314)
               all still missed, with the rule verbatim in the prompt. The
               narrowing regressions persist: 10 hit->miss, same shape as
               v3's 12 (middle table the hint never names gets dropped —
               0070 budget, 0353/0388 cards, 0439 schools). And avg tables
               sent stayed flat at 2.05 despite two rules pushing toward
               more — the same non-steering picker-v2 measured in Batch E.
               v4 vs v3: 442 vs 438 recall, 5 vs 6 targets (0266 flipped
               back), 10 vs 12 regressions — the two prompts are the same
               result. Prompt wording has hit its ceiling on this picker;
               what the LLM will not do (mechanical column->owner lookup),
               code can: the deterministic evidence-column union, measurable
               offline against the three stored selection sets for $0.
               2,323,114 in / 11,193 out (2,643 thinking) — $4.76.
export:        runs/20260801-202519-picker-v4-recall-stage1.json
               (smoke: runs/20260801-202415-picker-v4-recall-stage1.json, LIMIT=3, void)
```

## 2026-08-01 — The union test: evidence-column union + FK bridge, measured offline for $0

```
approach:      no model calls — deterministic post-picker additions applied to
               the stored selections of three runs (Batch G picker-v1, the
               picker-v3 and picker-v4 stage-1 exports) and recall recomputed.
               Code: src/pickers/union.ts — every catalog table owning a
               column the evidence names whole-word (≤4 owners, underscores
               match spaces) plus tables named outright, then a foreign-key
               bridge when the picked set is disconnected.
question set:  full (500 validated), replayed
table recall:  picker-v1 85.6% -> 93.8% (469/500); targets 15/16 (0367 blocked
               by the ≤4-owner guard on "text", accepted). v3/v4 bases land
               at 467-468 — the prompt variants add nothing over v1+union.
verdict:       kept — gate met (>=12 of 16 targets), stage 2 authorized
note:          What two prompt rewrites could not make the model do (the
               column->owner lookup), ~100 lines of code do deterministically.
               Additions only, so per-question recall can never fall. Cost of
               the win: avg tables sent 2.09 -> 3.78 — the EXPAND caveat
               (recall without accuracy) stays open until stage 2. $0.
export:        (offline computation; script scripts/evidence-union-recall.ts)
```

## 2026-08-01 — UNION=on on the Batch G base ⭐ new best number

```
approach:      mode=hard picker=llm union=on prompt=v4 pickerPrompt=picker-v1 sqlContext=rows rewrite=on model=claude-sonnet-5 effort=medium
question set:  full (500 validated)
accuracy:      68.8% (344/500)
table recall:  93.6% (468/500); avg tables sent 3.75
noise band:    ±2.5 points (dev slice, 3 trials, re-derived 2026-07-31)
verdict:       kept
note:          +3.2 vs Batch G's 65.6% — past the band by 0.7 points, the
               same one-trial margin the rows run shipped with; a repeat
               trial is cheap insurance before promoting to the README.
               Diff vs Batch G: 27 gained, 10 lost, 463 unchanged. Triage:
               table missing 49 -> 23. Of the 16 cluster-1 targets, 14 now
               get their tables and 10 score correct (0014, 0039, 0045,
               0057, 0063, 0206, 0266, 0314, 0356, 0366); 4 have the tables
               and still write wrong SQL — those move to other clusters.
               The EXPAND objection did not materialize: EXPAND bought
               recall 95% with +0.4 accuracy because it added 3.5 blind
               tables everywhere; the union adds ~1.7 *named* tables and
               converted. Several of the 10 losses look like extra-table
               column confusion (frpm."School Name" picked over
               schools.school) — the known cost, net well worth it.
               UNION stays default-off until Julian sets the default; this
               run is the promotion case. 0 voids. $8.71.
export:        runs/2026-08-01-141455-exp-union-full.json
               (smoke: runs/2026-08-01-141430-exp-union-smoke-full.json, LIMIT=3, void)
```

## 2026-08-01 — v5 bundle: aggregation rules + probe + repair ⭐ new best

```
approach:      mode=hard picker=llm check=probe repair=on union=on prompt=v5 pickerPrompt=picker-v1 sqlContext=rows rewrite=on model=claude-sonnet-5 effort=medium
question set:  full (500 validated)
accuracy:      72.4% (362/500)
table recall:  93.4%
noise band:    ±2.5 points (dev slice, 3 trials, re-derived 2026-07-31)
verdict:       kept
note:          +3.6 vs the union run's 68.8% — past the band. One combined
               run of every fix left with a shared mechanism, each with its
               targets named in advance (the cluster analysis): v5 = v4 plus
               three prompt rules (percentage over the whole population ×100,
               compute the hint's formula literally, aggregate at the unit
               the question names); CHECK=probe with its trigger widened to a
               single-cell zero (a COUNT that matched nothing is [[0]], not
               []); REPAIR=on. Wiring change underneath: the check path now
               applies the dialect repairs to the SQL it adopts, so CHECK
               composes with REWRITE instead of throwing.

               Target attribution, 19 named in advance, 10 won: probe 5/5
               (0125 0229 0316 0337 0365 — every hint-literal mismatch),
               percentage 4/8 (0080 0345 0374 0196), formula 1/3 (0283),
               grain 0/2, repair 0/1. Probe overall: fired 21 times, +8/−4
               against the union run (bonus rescues 0015 0041 0090; loss
               0218 is gold's scalar-NULL convention — probing an
               empty-looking answer that was right, the known risk). Repair
               retried 15 questions.

               Where the +18 net came from — 32 gained, 14 lost, and the 32
               classify exactly:
                 10  named targets (0080 0125 0196 0229 0283 0316 0337 0345
                     0365 0374)
                  3  probe bonus — fired on questions never named, fixed them
                     (0015 0041 0090)
                  3  repair rescue — crashed, retried, right (0141 0144 0178)
                  3  churn back — the exact questions Batch G lost as random
                     churn, returned on their own (0433 0443 0451)
                 13  unattributed — generation churn and v5 side effects,
                     inseparable without repeat trials (0087 0105 0111 0169
                     0188 0202 0222 0227 0336 0358 0364 0442 0445)
               The 14 losses are the same wobble in the other direction. So
               16 of 32 gains are causally attributable (targets + probe +
               repair); the margin +3.6 > the ±2.5 band is what makes the
               headline claim, the attribution is what makes it explainable.
               0 voids. $9.53 (repair + probe add ~$0.8 over the union run's
               $8.71).

               generate-sql.ts imports v5 as of this run. Julian promoted
               the bundle to the default the same day: CHECK and REPAIR now
               default on for hard mode outside the bake-off, CHECK=off
               REPAIR=off reproduces the 68.8 or anything earlier.
export:        runs/2026-08-01-150902-exp-v5-bundle-full.json
               (smoke: runs/2026-08-01-150837-exp-smoke-v5-full.json, LIMIT=3, void)
```

## 2026-08-01 — Default set to the 72.4% configuration (wiring smoke, LIMIT=3)

```
approach:      mode=hard picker=llm limit=3, nothing else set
verdict:       void
note:          Not a measurement — the smoke that proves the new default
               resolves. Default is now the v5 bundle: prompt v5, llm picker,
               five sample rows, dialect rewrites, evidence-union additions,
               probe, repair. Three code changes carry it: generate-sql.ts
               imports prompts/v5 (was v4), CHECK defaults to probe and
               REPAIR to on for hard mode outside the bake-off, with
               CHECK=off REPAIR=off turning them back off.

               With nothing set but PICKER, the suite name came back
               "repair=on | prompt=v5 | union=on | sqlContext=rows |
               check=probe check-v1 | rewrite=on" — stamped on every row.
               3/3 scored.

               Reproduction rule from here: any pre-bundle number needs
               CHECK=off REPAIR=off, and the 68.8/65.6 rows also need the
               generate-sql import switched back to v4 (61.0 to v1). v1–v4
               stay in src/prompts/ as the evidence behind their entries.
export:        runs/2026-08-01-152040-exp-default-check-v5-full.json
```

## 2026-08-01 — Prompt v6 wiring smoke (LIMIT=3)

```
approach:      mode=hard picker=llm limit=3 prompt=v6, defaults otherwise
verdict:       void
note:          Not a measurement — proves the v6 import stamps. Suite name
               came back "repair=on | prompt=v6 | union=on | sqlContext=rows |
               check=probe check-v1 | rewrite=on". 3/3 scored, no crashes.
export:        runs/2026-08-01-155118-exp-smoke-v6-full.json
```

## 2026-08-01 — Prompt v6: ten targeted rules from the v5-bundle failure analysis

```
approach:      mode=hard picker=llm, prompt=v6, all other defaults (probe,
               repair, union, rewrites, rows). v6 = v5 + ten rules, each with
               named targets from the 40-still-failing analysis: hint dialect
               (SUM(cond) = row count; 0391 0480), population after "of" wins
               the denominator (0281), multiply by 100 before dividing (0462),
               percentage populations join INNER (0353 0372), row-vs-aggregate
               comparisons filter rows + DISTINCT (0075), "Rank X by Y"
               returns entity, Y, RANK() (0249 0250 0441), evidence
               value-format definitions are filters (0225), stored quantity
               columns read per row (0461), "average of each Y" is GROUP BY
               not a window (0319), group entities by key not name (0138).
               14 named targets. Deliberately excluded with evidence:
               keep-ties (gold votes 83:2 for LIMIT 1), 0218 (hint and gold
               contradict each other), 0236 (already-covered projection
               re-roll).
result:        71.0% (355/500)
verdict:       rejected
note:          −1.4 vs the v5 bundle's 72.4% — inside the ±2.5 band, a tie
               with a worse point estimate. Default stays v5; the import was
               reverted the same day. v6 stays in src/prompts/ as evidence.

               Targets: 8 of 14 converted (0281 0462 0372 0075 0249 0441
               0461 0138). Missed: 0391 0480 (dialect rule converted neither
               of its targets), 0353, 0250, 0225, 0319.

               Diff vs v5 bundle: 18 gained, 25 lost. The 18 gains: 8 named
               targets, 10 churn (0011 0013 0024 0058 0306 0351 0366 0432
               0449 0465 — including four from buckets judged unfixable,
               which flipped on re-rolls). Of the 25 losses, ~7 carry a new
               rule's fingerprint in the SQL:
                 0202  dialect rule misread wins (a numeric column) as a
                       condition — WHERE wins = 1
                 0222  row-level rule flattened a per-race SUM(points)=0
                       into WHERE points = 0
                 0102  DISTINCT push forced the ORDER BY column into SELECT
                 0080  English-population rule — the exact mirror of its
                       0281 win; gold follows the hint here and the English
                       there, so the pair is jointly unwinnable
                 0175  rank rule bled into a top-N question, adding the
                       measure column
                 0364  per-row rule produced a per-row window shape on a
                       single-number percentage
                 0093  percent push added ×100 to a rate
               The other ~18 losses are wobble — 8 of them (0087 0188 0202*
               0222* 0336 0358 0364* 0445) are the v5 bundle's own
               unattributed churn gains churning back out (*both readings
               apply). Rule ledger nets ≈ 0: the ten rules won 8 and broke
               ~7. The prompt lever is exhausted — at ten-plus rules, new
               rules break as many passers as they convert targets.
               0 voids. $10.44.
export:        runs/2026-08-01-155140-exp-v6-bundle-full.json
```
