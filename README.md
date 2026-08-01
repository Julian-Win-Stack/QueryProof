# QueryProof

Ask a Postgres database a question in English; get SQL and rows back.

**62.4% correct on [BIRD Mini-Dev](https://github.com/bird-bench/mini_dev)** —
against the **36.0%** GPT-4-turbo baseline BIRD publishes for the same 500
questions, and measured in a harder setting than that baseline uses.

Correct means *the generated SQL ran and returned the same rows as the reference
SQL*. No LLM judges anything, anywhere.

Any accuracy number is easy to produce and hard to trust. What this repo ships is
the second part: a measured noise floor that every comparison is read against, an
append-only log of every run including the ones that lost, and a classified
breakdown of the failures that remain. Most of what was tried lost: twelve
single-change experiments ran on the full 500 questions on 2026-07-31 alone, and
nine of them are labelled *rejected* or *tie* in the log.

**The pipeline.** Eleven real databases live in one Postgres instance. An LLM
picks the relevant tables out of the 75; a second call writes the SQL from those
tables' schemas plus five real sample rows each; the question is asked five
times and the answer the most attempts agree on ships; every query runs under a
`SELECT`-only role. Model: `claude-sonnet-5`, pinned for every number here.

## Results

**The hard setting** — the question does *not* say which database it belongs to.
All 11 share one namespace: 75 tables, with traps (`races` is Formula 1, `race`
is alien species).

| Configuration | Accuracy | Table recall | Cost / run |
|---|---|---|---|
| Baseline: all 75 tables in the prompt | **57.4%** | 100%¹ | $15.70 |
| + LLM table selection (~2 tables sent) | **59.2%** | 86.0% | $6.31 |
| + five real sample rows per table | **61.0%²** | 85.4% | $7.34 |
| + a counting-convention prompt rule | **61.6%³** | 84.6% | $7.44 |
| + best-of-5 by execution agreement | **62.4%³** | 85.4% | $18.85 |

Noise: **±2.5 points**, from 3 repeat runs of one configuration — the model has
no determinism knob, so every comparison is read against that band. Denominator:
all 500 validated questions, 0 quarantined and 0 voided in every run above.

Sample rows is one of twelve single-change experiments run on 2026-07-31 —
value lists and BIRD's human-written column descriptions in both prompts, a
picker prompt rewrite, join-partner expansion, probe-on-empty, self-check,
best-of-5 voting, a counting-convention prompt rule, and a stack of the
winners — full 500 questions each, ~$130 and one day total. Two beat the band:
sample rows and self-check (**61.4%** — tied with sample rows, and the two
*don't stack*: 60.0% together, so the simpler one ships). The other ten are
`rejected`, `tie`, or `void` in [RUNS.md](RUNS.md), each with its verdict, its
mechanism numbers, and its committed export.

**The easy setting** — the question names its database, which is how BIRD's
published baselines are measured — scores **58.4%**. That is the fairest
side-by-side with the 36.0% above. Grading follows BIRD's own rule, so the two
are comparable; the divergences that remain are listed in
[KNOWN_ISSUES.md](KNOWN_ISSUES.md).

¹ Structural: the baseline sends every table, so recall cannot miss.

² Read against a same-day re-run of the selection configuration (57.8%, inside
the band of the 59.2% above): +3.2, past ±2.5. Run-to-run wobble is exactly why
every step reads against a same-day control, never against a stored number.

³ +0.6 and +0.8 — each inside the ±2.5 band, logged as **ties** in
[RUNS.md](RUNS.md). They ride the headline because together they are the best
configuration measured, not because either step is proven on its own: one
500-question trial each cannot separate them from noise, and the honest
decomposition of 62.4 is "+3.2 from sample rows, the rest unproven".

## What the table actually says

Five findings, all against intuition, all measured:

1. **Not knowing the database costs nothing — if you send everything.** Hard
   baseline 57.4% vs easy 58.4%: a tie inside the noise band. The model locates
   the right tables among 75 on its own; what it cannot survive is a *wrong
   shortlist*.

2. **Table selection bought cost, not accuracy.** +1.8 points is inside the band
   — a tie. **$6.31 vs $15.70** per 500 questions is not: 2.5× cheaper, for the
   same accuracy.

   The risk is the picker leaving out a table the question needed — and then no
   prompt tuning saves the query, because accuracy can never exceed recall. So
   recall is measured independently on every run. It holds **86.0%**.

   <details>
   <summary>Why adding a second model call costs <em>less</em></summary>

   Sending all 75 tables means a **14,946-token** prompt on every question, to
   get one line of SQL back. Instead the picker reads a condensed catalog
   (**4,478 tokens**), names the ~2 tables the question needs, and the SQL
   call's prompt drops to **950 tokens — 94% smaller**. Two calls, 5,428 input
   tokens total instead of 14,946.

   The bill is almost entirely input: the answer is ~150 tokens, the schema is
   100× that, so even at output's 5× price the prompt dominates ~20:1.
   </details>

3. **Self-repair repairs the wrong thing.** Feeding Postgres errors back drove
   final execution errors from 10 to 0 — every retried query *runs*. But only 1
   of 11 retried questions became *correct*; the rest moved from "crashes" to
   "runs and returns the wrong rows". Executability was never the bottleneck
   (~2% of questions), so the loop is nearly free ($0.07) and nearly useless.
   Reported as the negative result it is.

4. **The model needs the data, not the documentation.** Five real rows under
   each `CREATE TABLE`: **+3.2**, the only prompt change that ever cleared the
   band. BIRD's human-written column descriptions, a similar token budget:
   +0.8, a tie. The failures were never about what a column *means* — they were
   about what it *holds*. A query filtering `segment = 'premium'` scores zero
   against a table that stores `'Premium'`, and no description says that; a
   sample row does. Join-partner expansion made the same point from the other
   side: it fixed table selection exactly as designed (missing-table failures
   57 → 19) and accuracy did not move — the rescued questions just failed at
   SQL-writing instead. Recall was never the binding constraint.

5. **Self-agreement is not correctness.** Best-of-5 voting — answer five times,
   execute all five, ship the majority result set — looked like the big lever:
   across the day's runs, *some* configuration answered 71.8% of questions
   correctly, so picking the right candidate per question had ~14 points of
   headroom. Measured: **+0.8, a tie, at 2.5× the cost.** On 79% of questions
   all five attempts returned identical rows — including 110 questions where
   they were unanimously wrong. The diversity that built the 71.8% union came
   from *different configurations* disagreeing, never from asking one
   configuration five times. What the vote left behind is a confidence signal:
   unanimous answers were right 72.3% of the time, split ones ~25%.

## Why the numbers can be trusted

- **Execution-based grading, hand-written comparator.** Row order ignored,
  column order significant, column names never consulted, duplicate rows
  forgiven — BIRD's own rule, so the numbers above are comparable to theirs. The
  project graded duplicates as differences until 2026-07-31 and scored 2.8–4.2
  points lower for it; the reversal and what it cost are in
  [KNOWN_ISSUES.md](KNOWN_ISSUES.md).
- **A noise floor before any comparison.** Every "improvement" smaller than the
  measured ±2.5 band is called a tie, including two of the three rows above.
- **Voids are not zeros.** A refusal or an exhausted rate-limit retry voids the
  question rather than scoring 0 — a missing answer and a wrong answer are
  different things. Every run above had zero voids.
- **Every number is traceable.** Each run's full configuration, verdict, and
  JSON export are committed: [RUNS.md](RUNS.md) is the append-only log,
  `runs/*.json` the evidence. A number without an entry does not ship.
- **Generated SQL cannot write.** It executes as a role with `SELECT` only — the
  role is the wall, not a regex.

## Where the other 43% goes

Every failure in the baseline run, classified by executing both queries — no
sampling, both SQL strings are in the committed export:

| Cause | Share of 227 failures |
|---|---|
| Right shape, wrong values | 41% |
| Wrong number of columns | 34% |
| Wrong number of rows | 19% |
| Query crashed | 5% |

**The second row is mostly not a model error.** Asked *"which year recorded the
most consumption,"* the model returns the year and the total it sorted by; the
reference returns the year alone. Same answer, different column count, graded
wrong.

The obvious fix — a prompt rule saying "return only the columns asked for, never
the one you sorted by" — was written, measured, and **rejected**: 62.0% → 57.0%
on the dev slice. It failed because the reference queries do not agree with each
other. Some exclude the sorted column, one includes it, and one answers only half
of a two-part question. A rule followed consistently is guaranteed to be wrong
somewhere. Worse, told not to *select* the column it sorted by, the model stopped
*sorting* — rewriting "order by salary, take the top" as an equality subquery
that returns zero rows. Empty results doubled.

It is also a smaller bucket than it looks: 38 of those 78 return the wrong row
count too and were never column-limited. The addressable share is 40 questions —
**8% of the set**, not 34% of failures. Recorded as a measurement ceiling, not a
tuning target ([RUNS.md](RUNS.md), 2026-07-31).

The same lesson repeated from the other direction. The largest greppable
signature in the remaining failures — 17 queries writing `COUNT(DISTINCT …)`
where the reference counts every joined row — got its own one-sentence prompt
rule. The model obeyed it: `COUNT(DISTINCT)` answers fell 44 → 27, and none of
the six answers measured as at-risk flipped. The score still did not move,
because only 2 of the 17 converted — the other 15 were also wrong somewhere
else, and fixing the count exposed the next error. A signature you can grep for
is a correlate, not a cause ([RUNS.md](RUNS.md), Batch F run A).

## Comparing two runs

Accuracy says whether a change won. It cannot say what the change *broke* — a
score is a net, and "62% → 57%" is equally consistent with four questions
breaking or with twenty breaking while sixteen were fixed.

```bash
npm run diff -- runs/<before>.json runs/<after>.json
```

Free, and no model calls: every run stores the SQL it generated, so both sides
re-execute against Postgres and are re-graded. On the rejected prompt above:

```
100 questions in both runs
  got worse:   4   wrong in every trial after, right in every trial before
  got better:  1
  unchanged:  86
  can't say:   9   the model disagreed with itself across identical trials
```

Four questions broke, not twenty. The tool then prints each broken query beside
the one that used to work and the reference — which is where the diagnosis in
the previous section came from.

Two rules make it trustworthy:

- **Both sides are re-graded now, by the same code.** The comparator changed on
  2026-07-31 and moved every number ~3 points. Comparing a stored verdict from
  before that against a fresh one credits the grader's change to the prompt's.
- **A regression must fail in every trial.** The model answers ~9% of questions
  differently across identical runs, so a single right-to-wrong flip is usually
  the dice. Those land in `can't say` and are never counted as evidence either
  way — which is the only reason the four above are worth reading.

## The demo

```bash
npm run demo        # http://localhost:3000
```

Question in; picked tables, SQL, rows, and attempt count out — the
table-selection configuration plus the self-repair loop from finding 3. The
headline configuration's sample rows, counting rule, and best-of-5 are not on
the product path yet. Answers flagged **low confidence** (empty
result, or a query that needed repair) were right 2.5% of the time on the
measured run; everything else 63.7%. That heuristic was validated against a
finished run before shipping — signals that didn't separate (thinking depth,
tables picked, result size) were cut.

A stronger flag is measured and waiting: run the query five times and surface
agreement — unanimous answers were right 72.3% of the time, split ones ~25%.
Best-of-5 lost as an accuracy play (a tie at 2.5× the cost) and survives as a
trust play.

The demo routes through the [Respan](https://respan.ai) gateway for caching,
fallback, and tracing. Eval runs deliberately do **not**: a cached repeat run
reports zero variance, which would fake the noise floor the numbers depend on.

## Running the evals

```bash
npm run validate-gold             # execute all 500 reference queries -> gold/
npm run eval:easy                 # easy setting, all 500
PICKER=none npm run eval:hard     # hard baseline (all 75 tables)
PICKER=llm  npm run eval:hard     # hard + table selection
TAG=rows PICKER=llm SQL_CONTEXT=rows npm run eval:exp   # + sample rows
TAG=vote5 PICKER=llm SQL_CONTEXT=rows VOTE=5 npm run eval:exp  # + best-of-5 (the headline row)
PICKER=llm  npm run eval:hard:repair   # hard + selection + self-repair

npm run diff -- runs/<before>.json runs/<after>.json   # what a change broke
npm run rescore -- runs/<file>.json                    # re-grade a stored run
```

The last two never call the model — a finished run holds the SQL it generated,
so re-grading and diffing are database passes.

Needs Docker Postgres with the BIRD dump loaded, `DATABASE_URL`,
`DATABASE_URL_RO`, and `ANTHROPIC_API_KEY` in `.env` — see
[CLAUDE.md](CLAUDE.md) for the full environment.

## Next: Version B

Version A (everything above) hand-writes the control flow: pick tables →
generate SQL → execute → retry on error. **Version B hands the same five tools to
the model in a loop and lets it drive** — an agent instead of a pipeline. It will
be measured on the identical question slice, against Version A's numbers and
Version A's noise band.
