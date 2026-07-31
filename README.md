# QueryProof

Ask a Postgres database a question in English; get SQL and rows back — with a
measured, reproducible accuracy number behind every claim.

The pipeline: an LLM picks the relevant tables out of a 75-table database, a
second call writes the SQL, the query runs under a `SELECT`-only role, and on a
Postgres error the error text is fed back for a retry. Grading is
**execution-based only**: an answer is correct iff running its SQL returns the
same rows as the reference SQL. No LLM judges anything, anywhere.

Benchmark: [BIRD Mini-Dev](https://github.com/bird-bench/mini_dev) (500
questions over 11 real databases), loaded into a single Postgres instance.
Model: `claude-sonnet-5`, pinned for every number below.

## Results

**The hard setting** — the question does *not* say which database it belongs
to. All 11 databases share one namespace; 75 tables, with traps
(`races` is Formula 1, `race` is alien species).

| Configuration | Accuracy | Table recall | Cost / run |
|---|---|---|---|
| Baseline: all 75 tables in the prompt | **57.4%** | 100%¹ | $15.70 |
| + LLM table selection (~2 tables sent) | **59.2%** | 86.0% | $6.31 |
| + self-repair (2 retries on SQL errors) | **58.8%** | 85.4% | $6.38 |

For scale: BIRD's published GPT-4-turbo baseline on these same questions is
**36.0%** — and it gets told which database each question belongs to, which the
rows above do not. Grading matches BIRD's: rows compared as a set, so duplicate
rows are forgiven on both sides. Remaining divergences are listed in
[KNOWN_ISSUES.md](KNOWN_ISSUES.md).

Measured noise: **±2.5 points** (same configuration, 3 repeat runs — the model
has no determinism knob, so every comparison is read against this band).
Denominator: 500 validated questions, 0 quarantined, 0 rejected, 0 voided
answers in any run above.

¹ Structural: the baseline sends every table, so recall cannot miss.

**The easy setting** (the question names its database — the setting BIRD's
published baselines use, and the fairest side-by-side with the 36.0% above)
scores **58.4%**.

## What the table actually says

Three findings, all against intuition, all measured:

1. **Not knowing the database costs nothing — if you send everything.** Hard
   baseline 57.4% vs easy 58.4%: a tie inside the noise band. The model
   locates the right tables among 75 on its own; what it cannot survive is a
   *wrong shortlist*.

2. **Table selection bought cost, not accuracy.** +1.8 points is inside the
   band; 2.5× cheaper is real ($6.31 vs $15.70 per 500 questions). The picker
   sends 2.1 tables on average instead of 75 and holds 86% recall. Accuracy can
   never exceed recall — when the right table isn't in the prompt, no prompt
   tuning saves the query — so recall is measured independently, per run.

3. **Self-repair repairs the wrong thing.** Feeding Postgres errors back
   drove final execution errors from 10 to 0 — every retried query *runs*.
   But only 1 of 11 retried questions became *correct*; the rest moved from
   "crashes" to "runs and returns the wrong rows". Executability was never
   the bottleneck (~2% of questions), so the loop is nearly free ($0.07) and
   nearly useless. Reported as the negative result it is.

## Why the numbers can be trusted

- **Execution-based grading, hand-written comparator.** Row order ignored,
  column order significant, column names never consulted, duplicate rows
  forgiven — BIRD's own rule, so the numbers above are comparable to theirs.
  The project graded duplicates as differences until 2026-07-31 and scored
  2.8–4.2 points lower for it; the reversal and what it cost are in
  [KNOWN_ISSUES.md](KNOWN_ISSUES.md).
- **A noise floor before any comparison.** Every "improvement" smaller than
  the measured ±2.5 band is called a tie, including two of the three rows
  above.
- **Voids are not zeros.** A refusal or an exhausted rate-limit retry voids
  the question rather than scoring 0 — a missing answer and a wrong answer
  are different things. Every run above had zero voids.
- **Every number is traceable.** Each run's full configuration, verdict, and
  JSON export are committed: [RUNS.md](RUNS.md) is the append-only log,
  `runs/*.json` the evidence. A number without an entry does not ship.
- **Generated SQL cannot write.** It executes as a role with `SELECT` only —
  the role is the wall, not a regex.

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
generate SQL → execute → retry on error. **Version B hands the same five
tools to the model in a loop and lets it drive** — an agent instead of a
pipeline. It will be measured on the identical question slice, against
Version A's numbers and Version A's noise band, and ships next.
