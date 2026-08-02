# Known issues

The grading decisions an outside reader could mistake for bugs — or for
tricks. Each is a settled choice, recorded with its reasoning and its measured
cost. Nothing here is an open question. Throughout, the *reference query* is
the SQL the benchmark ships as the correct answer to each question.

## 1. Rows are compared as a set, matching BIRD — reversed 2026-07-31

**Choice.** Two results are equal exactly when they contain the same distinct
rows. Row order is ignored, column order is significant, column names are never
consulted, and a duplicated row is **not** a difference. This is BIRD's own
rule.

**Why.** The README's central claim places this project's accuracy next to
BIRD's published baselines. A number produced by a stricter grader cannot be
placed there — it is lower for reasons that have nothing to do with the system
being measured, and no amount of footnoting fixes that.

**What it was, and what the reversal cost.** Until 2026-07-31 duplicate rows
counted as differences, on the reasoning that a join on a non-unique key
returns every correct row several times and that is the most common way
LLM-written SQL is wrong. That reasoning still holds. Set comparison scores
those queries correct, so the project has traded a real diagnostic for
comparability, deliberately (**D23**).

**Measured effect of the reversal.** Re-scoring the four full runs from their
stored SQL, with no new model calls: HARD baseline 54.6% → 57.4%, HARD + picker
55.4% → 59.2%, HARD + picker + repair 54.8% → 59.0%, EASY 55.4% → 58.4%. The
noise band re-derived under the new rule is ±2.5 points, unchanged. No
conclusion moved.

**The old numbers are not deleted.** Their `RUNS.md` entries stand as written;
the re-scored numbers are separate, later entries. A number is never edited
after the fact, including when the grader changes underneath it.



## 2. Reference queries that do not answer their own question stay in the set

**Choice.** A reference query that answers a different question than its
English prompt is scored as written, like every other question. It is not set
aside, not rejected, and not excluded from the denominator.

**Example.** `bird-0032` asks "Among the events attended by more than 10 members,
how many of them are meetings?" — a count. Its reference SQL takes events with
more than 10 attendees, `EXCEPT`s away every event of type `Meeting`, and
returns the *names* of what remains: nine rows describing the events that are
**not** meetings. A correct answer to the English question scores 0.

**Why not exclude them.** Two reasons, and the first is the serious one.

Excluding requires inspecting a question, and questions get inspected because
they failed. A question where the reference is equally defective but the
generated SQL happened to match it is never looked at, so it stays. The rule
would therefore only ever remove failures and never remove successes, and
accuracy would rise by construction. That is selection on the outcome, not a
correction.

Second, the published BIRD baseline this project cites was measured over all
500. Removing questions makes the two numbers describe different question sets
while still looking comparable — the failure mode this whole file exists to
prevent.

**Effect.** Some unmeasured share of the remaining failures cannot be won by any
prompt, tool, or model. The accuracy ceiling is below 100% and nothing in the
system will ever say so. Quote the defect rate as an estimate from a hand audit,
never as a subtraction from the denominator.

## 3. Deduplication is a coin flip the questions do not settle

**Choice.** No prompt rule instructs the model when to use `SELECT DISTINCT`.

**Why.** A question like "what are the budget categories of events at MU 215"
does not say whether to return each category once or once per matching event.
Both readings are correct English; the reference SQL picks one, and on the next
question it picks the other. Measured over the 227 failures of the HARD
baseline run: the reference used `DISTINCT` where the generated SQL did not
**29** times, and the generated SQL used it where the reference did not **28**
times. A blanket rule in either direction wins one side and loses the other.

**Interaction with issue 1.** Under BIRD's set comparison this disagreement is
mostly invisible; under the old duplicate-counting comparison it is a full
failure. So this bucket was partly the price of the stricter comparator, and
it was paid deliberately.

**Effect.** Largely resolved by the reversal in issue 1: under set comparison a
dedupe disagreement is invisible unless the two results differ for some other
reason as well. It is recorded here because the underlying ambiguity in the
questions is still there, and grading duplicates again would bring the whole
bucket back.

## 4. The reference queries are dialect-patched for Postgres; generated SQL gets the same patches by rewrite

**Finding (2026-08-01).** BIRD ships its reference queries three times — SQLite,
MySQL, Postgres — and this project grades against the Postgres port. Porting
changed the queries' meaning in two places, and BIRD's own maintainers patched
one of them: 60 of the 500 Postgres reference queries carry `NULLS LAST`, a clause
that appears in **zero** of the SQLite originals. It is there because SQLite
sorts NULLs last under `ORDER BY x DESC` while Postgres sorts them first, so
every unpatched `DESC LIMIT 1` used as a max silently returns a NULL row. The
second place is `LIKE` on a date column — legal in SQLite, where dates are
text, a hard 42883 error in Postgres.

The model was never told any of this. It writes SQLite-idiom SQL (the bulk of
public text-to-SQL training data is SQLite), so the reference side of the
comparison got a dialect patch and the generated side did not.

**Choice.** Two deterministic rewrites in `src/rewrites.ts` (`REWRITE=on`)
apply the same patches to generated SQL: every bare `DESC` gains `NULLS LAST`
before execution, and a query that dies with `42883 operator does not exist:
date ~~ unknown` gets `::text` on the column at the error's position and one
re-execution. Code, not a prompt rule — prompt v3 already measured how unevenly
the model follows a convention rule, and this asymmetry is the harness's fault,
not the model's.

**Measured effect.** Replayed over the stored SQL of the 61.0% run (no model
calls, so the counts are exact, not noisy): nulls-last fired on 67 queries and
flipped 5 wrong→right, the text cast fired on 2 and flipped both, zero losses
either way — 305/500 → 312/500 on identical SQL. The 11 currently-correct
answers where the reference also lacks `NULLS LAST` were re-executed and none
broke.

**What it is not.** Not a benchmark hack: the rewrite never sees the reference
query, never sees the question, and changes only what the SQL means across dialects — the
same correction BIRD applied to its own side. A stricter reading ("the model
should write portable SQL unaided") is available; it was rejected because the
README compares against BIRD's Postgres baselines, whose reference queries did
not have to write `NULLS LAST` unaided either.
