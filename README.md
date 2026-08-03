# QueryProof

Ask a real Postgres database a question in plain English. An LLM picks the
relevant tables, writes SQL, the SQL runs under a read-only role, and a harness
grades the answer by executing it next to the reference query and comparing the
returned rows. No LLM judges anything, anywhere.

This is a measurement project, not a product: how far can one pinned model
(`claude-sonnet-5`) be pushed on [BIRD Mini-Dev](https://github.com/bird-bench/mini_dev)
(500 questions, 11 real databases), what moved the number, what didn't, and why
it stops where it stops. Every run, including every failed idea, has an entry
in [RUNS.md](RUNS.md) with a verdict and a committed JSON export in `runs/`.


Loom: https://www.loom.com/share/f578e364fb4e485494af0b4b94f789dd 
(If you do only one thing, watch the loom but the ReadMe has the details of the experiments and my judgements.)



**Headline: 72.4% (362 of 500).** The measured ceiling of this benchmark is
**77.6%**; the gap is explained below, question by question.

For context, BIRD's published GPT-4-turbo baseline on these same 500 questions
is **36.0%**.

## How every point was won

One loop, run over and over:

1. **Read the failures.** Every run stores every query it generated, so the
   last run's failures get read by hand and grouped by cause. No fix is built
   for a failure nobody looked at.
2. **Name the cause, write the hypothesis.** One mechanism, and the specific
   questions it should fix, named before anything is built.
3. **Build the cheapest fix.** Code where code can reach it, a prompt rule
   only where it can't.
4. **Run the questions the fix could touch.** A runner re-runs just those
   questions for cents instead of ten dollars, several times each, because
   the model is not deterministic and one pass proves nothing.
5. **Rerun all 500, with the old version beside it as a control, same
   sitting.** This is the step people skip, and it is where most changes here
   died.

**Ship rule: the named failures converted, and nothing that was passing
broke.** The headline number is not the gate. A change whose headline lands
inside the ±2.5-point noise band (the measured run-to-run wobble) still
ships if its targets converted and the control held (the empty-result probe
shipped exactly that way, 5 for 5 once targeted). A change that lifts the
headline but breaks passing questions does not ship. Win or lose, every run
gets an entry in [RUNS.md](RUNS.md) with a verdict.

## How it works

Two model calls per question; everything else is deterministic code.

```
question → pick tables (LLM) → add hint-named tables (code) → write SQL (LLM)
         → repair dialect (code) → execute read-only → answer
                    ↺ on a Postgres error: error fed back, up to 2 retries
                    ↺ on an empty result: probe stored values, retry once
```

1. **Pick tables** (model call 1). A condensed catalog of all 75 tables goes
   in; the ~2 relevant tables come out. This is what makes the hard setting
   affordable: the SQL prompt shrinks ~94%.
2. **Add what the hint names** (code). Every table owning a column the
   question's hint mentions, plus a bridge table when the picked ones don't
   join.
3. **Write the SQL** (model call 2). The chosen tables' schemas, read live
   from Postgres with identifiers quoted exactly, plus five real sample rows
   per table.
4. **Repair the dialect** (code). `NULLS LAST` onto bare `DESC`, `::text`
   onto a date column under `LIKE`, the two systematic Postgres/SQLite gaps.
5. **Execute** as a `SELECT`-only role. A crash sends the error back to the
   model (two retries); an empty result triggers one probe of the filtered
   column's actual stored values.

Grading, for evals only: the generated SQL and the reference SQL both
execute, and the answer is correct when they return the same rows.

The agent (version B, below) keeps steps 1, 2 and 4, and hands the writing
and running to the model as tools.

## Results

The hard setting: the question does *not* say which database it belongs to.
All 11 databases share one namespace: 75 tables from unrelated domains side
by side, some with near-identical names (`races` and `race` exist
simultaneously and belong to two different databases), so selecting the wrong
table is easy and nothing in the name warns you.

| Configuration | Accuracy | Cost / 500 |
|---|---|---|
| Baseline: all 75 tables in the prompt | **57.4%** | $15.70 |
| + LLM table selection (~2 tables sent) | **59.2%** | $6.31 |
| + five real sample rows per table | **61.0%** | $7.34 |
| + projection prompt rule + two dialect rewrites in code | **65.6%** | $7.56 |
| + code adds the tables the question's hint names | **68.8%** | $8.71 |
| + aggregation prompt rules + probe on empty + error repair | **72.4%** | $9.53 |

Noise: **±2.5 points**, measured from 3 repeat runs of one configuration (the
model has no determinism knob). Every comparison is read against that band;
anything smaller is called a tie. Denominator: all 500 questions, zero voided,
in every run above.

Two ways to run the same 500 questions. **Easy**: the question says which of
the 11 databases it belongs to, so the model only sees that database's tables
(this is the setting BIRD's published baselines use). **Hard**: it doesn't
say, and all 75 tables are candidates. The table above is the hard way.

Comparing the two produced two surprises. Hiding the database costs nothing:
the hard baseline (57.4%) ties the easy one (58.4%), because with every table
in the prompt the model finds the right ones on its own. And the
table-selection step bought cost, not accuracy: +1.8 points is a tie, but
sending ~2 tables instead of 75 cuts the bill 2.5×. The only thing that
reliably kills accuracy is a shortlist *missing* a table the answer needs.

## What moved the number

- **Five real sample rows per table: +3.2.** BIRD's human-written column
  descriptions at the same token budget: +0.8, a tie. The failures were never
  about what a column *means*; they were about what it *holds*. A query
  filtering `segment = 'premium'` scores zero against a table storing
  `'Premium'`; no description says that, a sample row does.
  ([run-2026-07-31-152120-exp-rows-full](RUNS.md#run-2026-07-31-152120-exp-rows-full),
  [run-2026-07-31-152439-exp-desc-sql-full](RUNS.md#run-2026-07-31-152439-exp-desc-sql-full))
- **Two dialect repairs, in code: exactly +7 questions.** BIRD's reference
  queries are a Postgres port of SQLite SQL, patched with `NULLS LAST` on
  their side only; generated SQL never got the patch. Two rewrites apply it.
  The +7 is exact, no noise band needed: replaying the previous run's frozen
  SQL with only the rewrites flips 7 wrong→right and 0 right→wrong.
  ([run-2026-08-01-rewrites-replay](RUNS.md#run-2026-08-01-rewrites-replay))
- **Code adds the tables the question's hint names: +3.2.** Sixteen failures
  shared one cause: the hint names a column, the picker LLM never sent the
  table owning it. Telling the picker to do that lookup fixed 5 of 16; a
  hundred lines of code doing the lookup manually with code fixed 15, and
  were verified free against stored runs before any money was spent. LLM
  instructions are suggestions; code is a guarantee.
  ([run-2026-08-01-141455-exp-union-full](RUNS.md#run-2026-08-01-141455-exp-union-full),
  [run-20260801-202519-picker-v4-recall-stage1](RUNS.md#run-20260801-202519-picker-v4-recall-stage1),
  [run-2026-08-01-union-test-offline](RUNS.md#run-2026-08-01-union-test-offline))
- **Three aggregation prompt rules + a probe + error repair: +3.6**, targets
  named before the run. The probe re-reads a column's actual stored values
  when a query returns nothing (the hint says `'Brasil'`, the data stores
  `'Brazil'`). It went 5 for 5 on its named targets after measuring as a tie
  when applied blindly. Repair retries a crashed query with the error fed
  back; nearly free, rescued 3.
  ([run-2026-08-01-150902-exp-v5-bundle-full](RUNS.md#run-2026-08-01-150902-exp-v5-bundle-full))

## What lost: measured, logged, kept

Twelve full-500 experiments ran in a single day alone; every one below has
its run and verdict in the log. What was tried → what happened:

**Explain the data to the model better**
- Human-written column descriptions → +0.8, a tie.
  ([run-2026-07-31-152439-exp-desc-sql-full](RUNS.md#run-2026-07-31-152439-exp-desc-sql-full))
- Lists of each column's stored values → a tie. (Sample rows won instead:
  the model needs to *see* the data, not read about it.)
  ([run-2026-07-31-152223-exp-values-sql-full](RUNS.md#run-2026-07-31-152223-exp-values-sql-full),
  [run-2026-07-31-152329-exp-values-picker-full](RUNS.md#run-2026-07-31-152329-exp-values-picker-full))

**Tell the model what to do**
- Tell the picker to look up hint-named columns itself → fixed 5 of 16
  targets. The code version fixed 15.
  ([run-20260801-202519-picker-v4-recall-stage1](RUNS.md#run-20260801-202519-picker-v4-recall-stage1),
  [run-2026-08-01-union-test-offline](RUNS.md#run-2026-08-01-union-test-offline))
- A rule about how to count → the model *obeyed* it, the score didn't move:
  most of those questions were also wrong somewhere else.
  ([run-2026-07-31-180211-exp-rows-v3-full](RUNS.md#run-2026-07-31-180211-exp-rows-v3-full))
- A rule against returning extra columns → 62% → 57%. Told not to *select*
  the sorting column, the model stopped *sorting*. (A redesigned version
  shipped later.)
  ([run-2026-07-31-122519-hard-none-dev](RUNS.md#run-2026-07-31-122519-hard-none-dev))
- Ten targeted rules at once → converted 8 questions, broke about as many.
  ([run-2026-08-01-155140-exp-v6-bundle-full](RUNS.md#run-2026-08-01-155140-exp-v6-bundle-full))
- Only the two cleanest of those rules → converted 2, broke 4. Every rule is
  right for one question and wrong for its twin.
  ([run-2026-08-01-181519-ids-v7-exposed](RUNS.md#run-2026-08-01-181519-ids-v7-exposed))

**Let the model check its own work**
- Review its own SQL before answering → a tie. Combined with sample rows it
  *cancels* the gain.
  ([run-2026-07-31-152802-exp-self-full](RUNS.md#run-2026-07-31-152802-exp-self-full),
  [run-2026-07-31-153049-exp-stack-full](RUNS.md#run-2026-07-31-153049-exp-stack-full))
- Answer 5 times, ship the majority → a tie at 2.5× the cost. On 79% of
  questions all five answers were identical, including 110 identically
  *wrong*. Self-agreement is not correctness.
  ([run-2026-07-31-181111-exp-vote5-full](RUNS.md#run-2026-07-31-181111-exp-vote5-full))

**Fix the plumbing**
- Widen table selection to include join partners → selection fixed exactly
  as designed, accuracy flat: the rescued questions failed at the next step.
  ([run-2026-07-31-152021-exp-expand-full](RUNS.md#run-2026-07-31-152021-exp-expand-full))
- Retry crashed queries with the error message → every retry then *ran*,
  but only 1 of 11 became *correct*. Crashing was never the real problem.
  (Shipped later anyway: nearly free, can't hurt.)
  ([run-2026-07-30-194223-hard-llm-repair-full](RUNS.md#run-2026-07-30-194223-hard-llm-repair-full))

The pattern across all of it: the model mostly does what you ask. Asking was
rarely the bottleneck.

## Why it stops at 72.4%

**112 of the 500 questions are out of reach: the ceiling is 388/500, 77.6%.**
93 are impossible: the reference query is broken or answers in a format the
question never asks for, and no honest system can match it. 19 more are
measured dead ends: matchable one at a time, but every rule that fixes one
breaks a mirror question that reads the same way (measured, prompt v6).

| Why | Questions | Example |
|---|---|---|
| The reference SQL is wrong | 52 | A missing pair of parentheses applies the "male patients" filter to half a condition. It returns 75 rows. The answer is 6. |
| It picks an unstated format | 30 | Asked which month peaked, the reference answers `04`. We answer `201304`. Same month, graded wrong. |
| The question is genuinely ambiguous | 11 | Two honest readings, different numbers; the reference picked one. |
| Other | 4 | |
| Later proved *not* impossible, moved out (erratum) | **−4** | Four of the above scored correct in committed runs; they were luck-flippers, misfiled. |
| A fix loses as much as it wins (measured) | 19 | The reference counts 258 ban rows where the question asks how many cards; twin questions count distinct. |
| **Out of reach** | **112** | |

This claim was attacked before it was published. An unrelated outside audit
of the same 500 questions found 18.3% broken references; this project's
independent count is 18.6%. Reviewers instructed to *refute* a sample of the
"reference is wrong" verdicts confirmed 12 of 14 (the 2 that fell were
demoted to "ambiguous"). And when 4 questions filed as impossible later
scored correct in real runs, the counts were corrected with a dated erratum
rather than quietly edited.

**The 26 questions between 72.4% and the ceiling** (21 winnable, 5 that pass
in other runs) were each read by hand: every one is listed with its reason
and record in [docs/remaining-failures.md](docs/remaining-failures.md).
Three classes, each with a measured reason it stays:

- **The question reads two ways, and the answer key secretly picked one.**
  *"The driver who ranked second"*: the table has both a `rank` column and
  a `position` column. Either reading is fair; only one matches the key;
  pick the other and score zero. A rule forcing one side was tried three
  times and always lost, because the key itself doesn't always pick the
  same side; every rule fixes one question and breaks its twin.
- **Rule slips: the noise band itself.** The prompt already says exact
  columns, exact order, no invented filters; the model follows each rule on
  ~90% of rolls and slips on a different question each run. Harder rules,
  voting, and agent-side verification all measured flat. These flips *are*
  the ±2.5.
- **One selection miss** (0.2 points): one question needs a table the picker
  never sends. Left standing rather than re-tuning selection around it.

## The agent: same questions, model holds the controls

Everything above is a pipeline: code decides the steps, the model fills in
two blanks. The obvious objection is that half the remaining failures look
like "you'd know if you could *look at the data*." So version B hands the
loop to the model: three tools. `inspect_column` (see what a column
actually stores: its 20 most frequent values; code writes the lookup, so
it can't be gotten wrong), `run_sql` (rehearse its own draft query and see
the rows come back), `submit_sql` (hand in). Up to 10 loops per question,
same table selection, same grading.

**Measured on the same 500: 356/500 (71.2%) and 350/500 (70.0%) across two
runs, against the pipeline's 362/500 (72.4%); all inside the ±2.5 band.
Three runs, one plateau.** Cost lands in the pipeline's class only because of
prompt caching (~$13 vs $9.53 per run).

What the two agent runs settle, per question:

- **Some questions can only be answered by looking at the data first.** The
  question doesn't tell you the exact value to filter on: the spelling, the
  format, which of two near-identical columns actually holds it. No prompt
  written in advance can know that; something has to peek at the table before
  writing the query. The agent peeks, and it stably converts 7 such questions
  the pipeline never gets.
- **Where looking backfires: questions the data can't decide.** These 13
  losses are not run-to-run luck; luck was filtered out (questions that
  flipped between the agent's own two runs don't count). All 13 failed *both*
  runs with the *same* wrong reading, while the pipeline passes them. Asked
  about loans "that were approved," the agent checked the status column,
  found `'A'`, filtered on it (both runs), and the answer key ignores the
  word "approved" entirely. Seeing the data made it *more* committed to the
  reading the key didn't pick. That is why these are agent-only losses: the
  pipeline passes them by never seeing the evidence that argues for the
  wrong reading. And it is why they're not fixable: a rule saying "ignore
  what you see" is already in the prompt and loses to the data, and obeying
  it would also forfeit the 7 questions the agent wins *by* trusting what it
  sees.
- The behavior was disciplined: 490 of 500 loops looked at the data before
  answering, median 2 passes, and the 10-call budget was almost never spent.

So the agent trades lookup questions for convention questions, and this
benchmark has more of the second. The pipeline stays the headline; the agent
stays in the repo as the measured answer to "why not just let the model
explore?": because it was built, run twice, and it ties.

## Why the numbers can be trusted

- **The grading is mechanical.** Both queries execute and the rows are
  compared by code; no model or human ever judges an answer, so the score
  cannot be flattered. The comparison follows BIRD's own rule, so the
  numbers are comparable to theirs ([KNOWN_ISSUES.md](KNOWN_ISSUES.md) lists
  every deliberate divergence).
- **Ties are called ties.** Every gain is read against the measured ±2.5
  noise band, including two steps that once rode the headline and were
  dropped when the band said so.
- **Nothing was dropped.** Every run's denominator is all 500 questions.
  A question where the API itself failed would be excluded *and reported*;
  that mechanism never fired.
- **Every claim is re-checkable.** Each run's full configuration and raw
  results are committed ([RUNS.md](RUNS.md), `runs/`); re-grading a stored
  run needs no API key. You don't have to take my word for any number here.

## Run it

```bash
npm run validate-gold                  # execute all 500 reference queries -> gold/
PICKER=llm npm run eval:hard           # the headline configuration: 72.4%
PICKER=llm npm run eval:agent          # the agent on the same 500
npm run eval:easy                      # easy setting (question names its database)

npm run diff -- runs/<a>.json runs/<b>.json   # per-question: what a change broke
npm run replay -- runs/<file>.json            # dialect rewrites on stored SQL, no model
npm run rescore -- runs/<file>.json           # re-grade a stored run, no model
TAG=x PICKER=llm EVAL_IDS=bird-0058 npm run eval:ids  # named questions only, cents
```

The headline configuration is the default; reproducing an older row means
switching its later steps off; the exact flags per row are in
****[CLAUDE.md](CLAUDE.md). Needs Docker Postgres with the BIRD dump loaded and
`DATABASE_URL`, `DATABASE_URL_RO`, `ANTHROPIC_API_KEY` in `.env`.
