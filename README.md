# QueryProof

Ask a Postgres database a question in English; get SQL and rows back.

**72.4% correct on [BIRD Mini-Dev](https://github.com/bird-bench/mini_dev)** —
against the **36.0%** GPT-4-turbo baseline BIRD publishes for the same 500
questions, and measured in a harder setting than that baseline uses.

Correct means *the generated SQL ran and returned the same rows as the reference
SQL*. No LLM judges anything, anywhere.

> ### 112 of the 500 questions are out of reach
>
> **That is 22.4% of the benchmark, and it caps this project at 77.6%.** 93 are
> impossible — not a hard subset, impossible: the reference query is broken, or
> it answers in a format the question never asks for, and no honest system can
> match it. The other 19 are measured dead ends — each is matchable on its own,
> but the v6 experiment measured that every rule fixing one breaks a mirror
> question that reads the same way, so no configuration holds them.
>
> | Why | Questions | Example |
> |---|---|---|
> | The reference SQL is wrong | 52 | A missing pair of parentheses applies the "male patients" filter to half a condition. It returns 75 rows. The answer is 6. |
> | It picks an unstated format | 30 | Asked which month peaked, the reference answers `04`. We answer `201304`. Same month. |
> | The question is genuinely ambiguous | 11 | Two honest readings, different numbers; the reference picked one. |
> | Other | 4 | |
> | A fix loses as much as it wins — measured | 19 | The reference counts 258 ban rows where the question asks how many cards; twin questions count distinct. A rule picking either side trades wins for losses. |
>
> *Erratum (2026-08-01): four questions originally filed as impossible (0070,
> 0091, 0349, 0465) have since scored correct in committed runs, so they were
> flippers, not impossible — they moved to churn. The headline counts above are
> corrected; the per-row split still includes them.*
>
> **Checked, not claimed.** Every one of the 500 questions was re-graded by
> executing both queries. The 137 that no configuration ever solved were then
> classified one by one. For the "reference is wrong" verdicts, independent
> reviewers were sent to *refute* a sample — **12 of 14 survived**, and the two
> that fell were reclassified as ambiguity, not error. The 19 dead ends were
> measured directly: the v6 run gave each mechanism its own targeted rule and
> the per-question diff showed the losses ([RUNS.md](RUNS.md)).
>
> Independent work agrees. An audit of this same 500-question set found 18.3%
> with wrong reference SQL; a CIDR 2026 paper puts annotation errors across
> BIRD's dev set higher still.
>
> The remaining 21 winnable failures are listed one by one, with the reference
> query, ours, and — for 10 of them — a query that did match, in
> **[docs/winnable-failures.md](docs/winnable-failures.md)**.

Any accuracy number is easy to produce and hard to trust. What this repo ships is
the second part: a measured noise floor that every comparison is read against, an
append-only log of every run including the ones that lost, and a classified
breakdown of the failures that remain. Most of what was tried lost: twelve
single-change experiments ran on the full 500 questions on 2026-07-31 alone, and
nine of them are labelled *rejected* or *tie* in the log.

**The pipeline.** Eleven real databases live in one Postgres instance. An LLM
picks the relevant tables out of the 75; deterministic code then adds every
table owning a column the question's hint names, plus any bridge table a
disconnected join path needs; a second call writes the SQL from those tables'
schemas plus five real sample rows each, under a prompt that pins the SELECT
list to exactly what the question asks; two deterministic dialect repairs run
over the SQL before it executes (`NULLS LAST` onto bare `DESC`, `::text` onto a
date column that failed under `LIKE`); a query that comes back empty triggers
one probe of the column's actual stored values and a rewrite; a query that
errors gets up to two repair retries with the error fed back; every query runs
under a `SELECT`-only role. Model: `claude-sonnet-5`, pinned for every number
here.

> ### Changing the prompt: check both halves, or the change is unmeasured
>
> A prompt rule that fixes one question usually breaks the question that looks
> just like it. So every prompt change gets checked twice, and the second check
> is the one people skip.
>
> 1. **Does it fix the target?** Re-run the named questions a few times each —
>    the model is not deterministic, so one pass proves nothing.
> 2. **Does it break anything that already worked?** Re-run the questions the
>    new rule can touch, and run the old prompt over the same set in the same
>    sitting as a control. A failure only counts if the old prompt got that
>    question right minutes earlier.
>
> Both are cheap. `EVAL_IDS=id,id,...` runs exactly the ids you name, so the
> second check costs a few dollars instead of a full run's ten.
>
> **Measured twice, same result.** Prompt v6 added ten targeted rules and scored
> 71.0% against v5's 72.4% — it converted 8 named questions and broke about as
> many. Prompt v7 then isolated the two v6 rules that had looked clean: it
> converted 2 questions and broke 4 of the 74 it could touch, with the control
> run beside it. One of those two rules is the fix a question on the work list
> still needs — and it broke that question's mirror.
>
> **The prompt lever is exhausted.** Not because the rules are wrong: because
> each one is right for one question and wrong for its twin. Anything that moves
> accuracy from here has to read the data per question, not add another line to
> the prompt ([RUNS.md](RUNS.md), 2026-08-01).

## Results

**The hard setting** — the question does *not* say which database it belongs to.
All 11 share one namespace: 75 tables, with traps (`races` is Formula 1, `race`
is alien species).

| Configuration | Accuracy | Table recall | Cost / run |
|---|---|---|---|
| Baseline: all 75 tables in the prompt | **57.4%** | 100%¹ | $15.70 |
| + LLM table selection (~2 tables sent) | **59.2%** | 86.0% | $6.31 |
| + five real sample rows per table | **61.0%²** | 85.4% | $7.34 |
| + projection prompt rule + two dialect rewrites | **65.6%³** | 85.6% | $7.56 |
| + code adds the tables the question's hint names | **68.8%⁴** | 93.6% | $8.71 |
| + aggregation prompt rules + probe on empty + error repair | **72.4%⁵** | 93.4% | $9.53 |

Noise: **±2.5 points**, from 3 repeat runs of one configuration — the model has
no determinism knob, so every comparison is read against that band. Denominator:
all 500 validated questions, 0 quarantined and 0 voided in every run above.

Two earlier steps rode the previous headline and are off the shipped path now:
a counting-convention prompt rule (61.6%) and best-of-5 by execution agreement
(62.4%, at 2.5× the cost) — both ties, both kept in [RUNS.md](RUNS.md) as the
negative results they are.

Sample rows is one of twelve single-change experiments run on 2026-07-31 —
value lists and BIRD's human-written column descriptions in both prompts, a
picker prompt rewrite, join-partner expansion, probe-on-empty, self-check,
best-of-5 voting, a counting-convention prompt rule, and a stack of the
winners — full 500 questions each, ~$130 and one day total. Two beat the band:
sample rows and self-check (**61.4%** — tied with sample rows, and the two
*don't stack*: 60.0% together, so the simpler one ships). The other ten are
`rejected`, `tie`, or `void` in [RUNS.md](RUNS.md), each with its verdict, its
mechanism numbers, and its committed export. One of the ten came back:
probe-on-empty tied as a blind sweep, then shipped in the 72.4% bundle once
failure analysis named the exact questions it would fire on — see footnote ⁵.

**The easy setting** — the question names its database, which is how BIRD's
published baselines are measured — scores **58.4%**. That is the fairest
side-by-side with the 36.0% above. Grading follows BIRD's own rule, so the two
are comparable; the divergences that remain are listed in
[KNOWN_ISSUES.md](KNOWN_ISSUES.md).

¹ Structural: the baseline sends every table, so recall cannot miss.

² Read against a same-day re-run of the selection configuration (57.8%, inside
the band of the 59.2% above): +3.2, past ±2.5. Run-to-run wobble is exactly why
every step reads against a same-day control, never against a stored number.

³ +4.6 against the sample-rows run — past the band by margin, the only step
here that is. It is two changes measured in one run, but the split is known:
the rewrites account for **exactly +7 questions**, because replaying the
previous run's stored SQL with only the rewrites applied flips 7 wrong→right
and 0 right→wrong — same SQL both sides, so no noise band applies. The
remainder rides on the prompt rule ([RUNS.md](RUNS.md), Batch G).

⁴ +3.2 against the row above, past the band. Sixteen failures shared one
cause: the question's hint named a column (`cost`, `DisplayName`) and the
picker never sent the table that owns it. Two attempts to fix that by
instructing the picker had already failed — so about a hundred lines of code
do the lookup instead, and repair join paths missing their middle table.
Missing-table failures fell 49 → 23. Before any money was spent, the idea was
verified free: applied to the stored picks of three finished runs, it recalled
15 of the 16 ([RUNS.md](RUNS.md), 2026-08-01).

⁵ +3.6 against the row above, past the band. One combined run of every
remaining fix with a shared mechanism, its target questions named *before* the
run: three prompt rules (build a percentage over the whole population, compute
the hint's formula literally, aggregate at the unit the question names), a
probe that reads a column's actual stored values when a query returns nothing
— the hint says `'Brasil'`, the data stores `'Brazil'` — and up to two retries
on a Postgres error. Of the 32 questions gained, 16 are causally attributable:
10 named targets (the probe went **5 for 5** on its cluster), 3 probe bonuses,
3 repair rescues; the rest, and the 14 lost, are the run-to-run shimmer the
band exists for. Probe measured a *tie* standalone in the Batch E sweep — it
shipped only after failure analysis showed the five hint-value mismatches were
exactly its trigger ([RUNS.md](RUNS.md), v5 bundle).

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
   Reported as the negative result it is — and shipped anyway in the 72.4%
   configuration, where being nearly free is the point: it rescued 3 of the 15
   questions it retried there, and a loop that only fires on a crash cannot
   cost a right answer.

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

6. **The model won't do a mechanical lookup, even when told to.** The headline
   step's sixteen target failures all hinged on one lookup: the hint names a
   column, some table owns it, go find which. Two picker-prompt rewrites — one
   spelling out that exact step — fixed 5 and 6 of the 16. A hundred lines of
   code that just do the lookup fixed 15, converted 10 into correct answers,
   and set the headline. Instructions are suggestions; code is a guarantee.

## Why the numbers can be trusted

- **Execution-based grading, hand-written comparator.** Row order ignored,
  column order significant, column names never consulted, duplicate rows
  forgiven — BIRD's own rule, so the numbers above are comparable to theirs. The
  project graded duplicates as differences until 2026-07-31 and scored 2.8–4.2
  points lower for it; the reversal and what it cost are in
  [KNOWN_ISSUES.md](KNOWN_ISSUES.md).
- **A noise floor before any comparison.** Every "improvement" smaller than the
  measured ±2.5 band is called a tie, including the table-selection row above
  and both steps dropped from the previous headline.
- **Voids are not zeros.** A refusal or an exhausted rate-limit retry voids the
  question rather than scoring 0 — a missing answer and a wrong answer are
  different things. Every run above had zero voids.
- **Every number is traceable.** Each run's full configuration, verdict, and
  JSON export are committed: [RUNS.md](RUNS.md) is the append-only log,
  `runs/*.json` the evidence. A number without an entry does not ship.
- **Generated SQL cannot write.** It executes as a role with `SELECT` only — the
  role is the wall, not a regex.

## Where the baseline's other 43% went

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
**8% of the set**, not 34% of failures. Recorded then as a measurement ceiling,
not a tuning target ([RUNS.md](RUNS.md), 2026-07-31) — a verdict Batch G later
overturned; see below.

The same lesson repeated from the other direction. The largest greppable
signature in the remaining failures — 17 queries writing `COUNT(DISTINCT …)`
where the reference counts every joined row — got its own one-sentence prompt
rule. The model obeyed it: `COUNT(DISTINCT)` answers fell 44 → 27, and none of
the six answers measured as at-risk flipped. The score still did not move,
because only 2 of the 17 converted — the other 15 were also wrong somewhere
else, and fixing the count exposed the next error. A signature you can grep for
is a correlate, not a cause ([RUNS.md](RUNS.md), Batch F run A).

**What finally moved it: reading all 99 then-winnable failures by hand**
([docs/winnable-failures.md](docs/winnable-failures.md) — since cut down to
the 21 still open), which produced the two Batch G changes in the results
table.

The rejected column rule came back with the failure mode designed out. The
first version said *never return the column you sorted by*, and the model
responded by not sorting. The shipped version says what to do instead — the
sort expression *belongs in ORDER BY* — plus the column order the question
implies, measured over the full 500 instead of the dev slice: wrong-column-count
failures fell **79 → 47**, and empty results did not double this time.

The other change was not a model fix at all. The reference queries are BIRD's
*Postgres port* of SQL written for SQLite, and BIRD patched its own side of the
dialect gap: **60 of the 500 Postgres reference queries carry `NULLS LAST`,
a clause zero SQLite originals have** — added because SQLite sorts NULLs last
under `DESC` while Postgres sorts them first, so every unpatched
`ORDER BY x DESC LIMIT 1` used as a max returns a NULL row. The generated SQL
never got the same patch. Two deterministic rewrites apply it (`NULLS LAST` on
bare `DESC`; `::text` on a date column that `LIKE` crashed into) — code, not a
prompt rule, because Batch F measured exactly how unevenly the model follows
conventions. Replayed over frozen SQL they flip **+7 questions with zero
losses**, a count that is exact because nothing regenerates
([KNOWN_ISSUES.md](KNOWN_ISSUES.md) issue 4).

## The failures that remain, and why they stay

The 116 out-of-reach questions are the box at the top. Every other failure of
the headline configuration was read by hand, given a named mechanism, and each
mechanism was then built and measured. Three classes survived everything —
each with its receipt in the log.

**Convention coin-flips — no rule can know them.** The question reads two
honest ways; both queries run clean and return sensible rows; the reference
picked one side. `results` has both `rank` and `position`, and *"the driver
who ranked second"* grades against `rank` — the equally honest `position`
reading scores zero. Constructor points live in two tables; the reference
wants the standings table. Nothing in the data marks the winning side, and
legislating one is measured three times as a net loss: prompt v6 (ten rules,
broke as many as it converted), v7 (two "clean" rules: converted 2, broke 4),
and the agent's v2 discipline block, whose LIMIT rule converted nothing,
broke two passing questions in its own control run, and pushed its one target
into a new wrong answer before being cut ([RUNS.md](RUNS.md), 2026-08-01).

The agent experiment drew the line precisely. Given tools to inspect stored
values before answering, it converted the failures whose wrongness is *visible
in the data* — filter `type = 'Creature'`, get 0 rows, discover the sibling
`types` column holds the bare word. It converted none whose wrongness exists
only in the answer key — and sometimes diligence lost: asked about loans
*"that were approved"*, it inspected `loan.status`, correctly found `'A'`,
filtered on it — and the reference ignores the word "approved" entirely. A
lookup settles what the database knows; it cannot settle what the grader
prefers.

**Rule slips — the noise band itself.** The prompt already says exact columns,
exact order, no invented filters; the model follows each rule on ~90% of rolls
and slips on the rest, a different question each run. Every lever aimed at the
slip rate measured flat: harder rules (v6, net zero), best-of-5 voting (a tie
at 2.5× the cost), agent-side verify-before-submit (a tie). These flips are
why the band is ±2.5 points — not a defect left unfixed, but the variance
every comparison here is read against.

**One selection miss.** bird-0367 needs the `rulings` table and the picker
never sends it; no downstream stage can use a table it never sees. One
question — 0.2 points — left standing rather than re-tune selection around it.

So the closing claim is not "72.4% and stuck." It is: every failure with a
working mechanism has been converted and the mechanism shipped; every failure
still standing carries a measured reason — broken reference (97), mirror-
question convention (measured three times), stochastic slip (measured twice),
one recall miss. The receipts are the rejected runs in [RUNS.md](RUNS.md) and
the per-question entries in
[docs/winnable-failures.md](docs/winnable-failures.md).

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
headline configuration's sample rows, aggregation prompt, dialect rewrites,
table-addition code, and empty-result probe are not on the product path yet. Answers flagged **low confidence** (empty
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
PICKER=llm npm run eval:hard            # the headline configuration — table
                                        # selection + hint-named table additions,
                                        # sample rows, dialect rewrites, probe,
                                        # repair: 72.4%
CHECK=off REPAIR=off PICKER=llm npm run eval:hard  # without probe + repair
                                        # (the 68.8% row, prompt v4 import)
CHECK=off REPAIR=off UNION=off PICKER=llm npm run eval:hard  # also without the
                                        # table-addition code (65.6%, v4 import)

CHECK=off REPAIR=off SQL_CONTEXT=off REWRITE=off PICKER=none npm run eval:hard  # baseline (all 75 tables)
CHECK=off REPAIR=off UNION=off SQL_CONTEXT=off REWRITE=off PICKER=llm npm run eval:hard  # + table selection only
CHECK=off REPAIR=off UNION=off REWRITE=off PICKER=llm npm run eval:hard  # + sample rows (61.0%, prompt v1 import)
npm run eval:easy                                   # easy setting, all 500

npm run diff -- runs/<before>.json runs/<after>.json   # what a change broke
npm run replay -- runs/<file>.json                     # rewrites on stored SQL
npm run rescore -- runs/<file>.json                    # re-grade a stored run

TAG=name PICKER=llm EVAL_IDS=bird-0058,bird-0372 npm run eval:ids  # only those ids
```

`eval:ids` is what makes the two-sided prompt check at the top of this file
affordable: run the named questions under the new prompt, then the same ids
under the old one, and compare. The ids are stamped into the run name, so a
subset run can never be mistaken for an accuracy figure.

Sample rows, the dialect rewrites, the table-addition code, the empty-result
probe, and error repair are all on by default — the headline configuration is
what runs when nothing is specified. **Reproducing older numbers means
switching things off: `SQL_CONTEXT=off` for any number measured before
2026-07-31, `REWRITE=off` for any number before 2026-08-01, `UNION=off` for
every row below 68.8%, and `CHECK=off REPAIR=off` for every row except the
72.4% headline** — the 68.8% and 65.6% rows additionally need
`src/generate-sql.ts` importing prompt v4, and the 61.0% row prompt v1, the
same one-line switch every prompt change goes through. Every run stamps its
full configuration into its own name, so a run can never be silently
mislabeled — but the stamp catches the mistake afterwards rather than
preventing it.

The last three commands never call the model — a finished run holds the SQL it
generated, so re-grading, diffing, and replaying the rewrites are database
passes.

Needs Docker Postgres with the BIRD dump loaded, `DATABASE_URL`,
`DATABASE_URL_RO`, and `ANTHROPIC_API_KEY` in `.env` — see
[CLAUDE.md](CLAUDE.md) for the full environment.

## Version B: the agent

Version A (everything above) hand-writes the control flow: pick tables →
generate SQL → execute → retry on error. Version B hands the loop to the
model. Same table selection, same schema text, same grading — but instead of
one generation call, the model gets three tools and up to 10 calls per
question: `inspect_column` (a column's 20 most common stored values),
`run_sql` (execute and see the first rows), `submit_sql` (hand in). Code only
executes what it asks for and feeds the result back. A repeated identical
lookup is answered from memory; a submission that errors or returns empty goes
back to the model exactly once — the pipeline's repair and probe, rebuilt
inside the loop; the tenth pass forces a hand-in, so the loop always ends
holding a query.

**Measured on the same 500: 71.2% (356/500) against the pipeline's 72.4%
(362/500) — a tie inside the ±2.5 band.** $12.96 per run against $9.53;
prompt caching is what keeps a multi-call loop in the pipeline's cost class —
3.16M tokens read from cache at 0.1× the input rate, ~$4.5 that would
otherwise be on the bill.

The behavior numbers say more than the headline:

- **499 of 500** loops ended with the model submitting voluntarily. The
  10-pass cap bound once — and that answer was wrong anyway.
- **490 of 500** looked at the data at least once before answering. The 10
  that never looked went 10 for 10 — it skipped looking exactly where looking
  had nothing to add.
- **Median 2 passes**: one look, one answer. The 10-call budget was there and
  the model mostly declined it.

What looking bought is the line drawn in the failures section above: the agent
converted failures whose wrongness is visible in the data — 4 of the 8 named
lookup targets, plus the two questions prompt v7 had tried and failed to fix
with rules, won here by looking with no rule at all — and converted none
whose wrongness lives only in the answer key. Evidence-gathering does not beat
five static sample rows plus probe and repair at this plateau; it matches
them, which is its own finding.

The agent's own losses then got the pipeline treatment: every one read by
hand, two mechanical fixes built — the submission bounce above, and a prompt
discipline block (no filters, `ROUND`s, `LIMIT`s or inlined constants nobody
asked for) — and checked both ways per the protocol at the top of this file.
The control run caught the block's LIMIT sentence converting nothing,
breaking two passing questions, and pushing its own target into a new wrong
answer; it was cut before it could ship. What
remains (prompt `agent-v3`) converts 5 of the 8 addressed failures stably, at
the cost of one new loss — receipts in [RUNS.md](RUNS.md), 2026-08-01. The
full 500 under agent-v3 runs next; until that number is in the log, none is
claimed for it.

```bash
PICKER=llm npm run eval:agent     # the agent on all 500
```
