# QueryProof

Ask a Postgres database a question in English; get SQL and rows back.

**59.2% correct on [BIRD Mini-Dev](https://github.com/bird-bench/mini_dev)** —
against the **36.0%** GPT-4-turbo baseline BIRD publishes for the same 500
questions, and measured in a harder setting than that baseline uses.

Correct means *the generated SQL ran and returned the same rows as the reference
SQL*. No LLM judges anything, anywhere.

Any accuracy number is easy to produce and hard to trust. What this repo ships is
the second part: a measured noise floor that every comparison is read against, an
append-only log of every run including the ones that lost, and a classified
breakdown of the failures that remain. Two of the three configurations below are
ties — and are labelled as ties.

**The pipeline.** Eleven real databases live in one Postgres instance. An LLM
picks the relevant tables out of the 75, a second call writes the SQL, the query
runs under a `SELECT`-only role, and on a Postgres error the error text is fed
back for a retry. Model: `claude-sonnet-5`, pinned for every number here.

## Results

**The hard setting** — the question does *not* say which database it belongs to.
All 11 share one namespace: 75 tables, with traps (`races` is Formula 1, `race`
is alien species).

| Configuration | Accuracy | Table recall | Cost / run |
|---|---|---|---|
| Baseline: all 75 tables in the prompt | **57.4%** | 100%¹ | $15.70 |
| + LLM table selection (~2 tables sent) | **59.2%** | 86.0% | $6.31 |
| + self-repair (2 retries on SQL errors) | **58.8%** | 85.4% | $6.38 |

Noise: **±2.5 points**, from 3 repeat runs of one configuration — the model has
no determinism knob, so every comparison is read against that band. Denominator:
all 500 validated questions, 0 quarantined and 0 voided in every run above.

**The easy setting** — the question names its database, which is how BIRD's
published baselines are measured — scores **58.4%**. That is the fairest
side-by-side with the 36.0% above. Grading follows BIRD's own rule, so the two
are comparable; the divergences that remain are listed in
[KNOWN_ISSUES.md](KNOWN_ISSUES.md).

¹ Structural: the baseline sends every table, so recall cannot miss.

## What the table actually says

Three findings, all against intuition, all measured:

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

## The demo

```bash
npm run demo        # http://localhost:3000
```

Question in; picked tables, SQL, rows, and attempt count out — the exact
configuration measured in row three. Answers flagged **low confidence** (empty
result, or a query that needed repair) were right 2.5% of the time on the
measured run; everything else 63.7%. That heuristic was validated against a
finished run before shipping — signals that didn't separate (thinking depth,
tables picked, result size) were cut.

The demo routes through the [Respan](https://respan.ai) gateway for caching,
fallback, and tracing. Eval runs deliberately do **not**: a cached repeat run
reports zero variance, which would fake the noise floor the numbers depend on.

## Running the evals

```bash
npm run validate-gold             # execute all 500 reference queries -> gold/
npm run eval:easy                 # easy setting, all 500
PICKER=none npm run eval:hard     # hard baseline (all 75 tables)
PICKER=llm  npm run eval:hard     # hard + table selection
PICKER=llm  npm run eval:hard:repair   # hard + selection + self-repair
```

Needs Docker Postgres with the BIRD dump loaded, `DATABASE_URL`,
`DATABASE_URL_RO`, and `ANTHROPIC_API_KEY` in `.env` — see
[CLAUDE.md](CLAUDE.md) for the full environment.

## Next: Version B

Version A (everything above) hand-writes the control flow: pick tables →
generate SQL → execute → retry on error. **Version B hands the same five tools to
the model in a loop and lets it drive** — an agent instead of a pipeline. It will
be measured on the identical question slice, against Version A's numbers and
Version A's noise band.
