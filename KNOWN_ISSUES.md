# Known issues

Deliberate divergences from BIRD's evaluation, and decisions that would
otherwise read as bugs. Each is a settled choice with its reasoning, not an open
question.

## 1. Rows are compared as a set, matching BIRD — reversed 2026-07-31

**Choice.** Two results are equal iff they contain the same distinct rows. Row
order is ignored, column order is significant, column names are never consulted,
and a duplicated row is **not** a difference. This is BIRD's own rule.

**Why.** The README's central claim places this project's accuracy next to
BIRD's published baselines. A number produced by a stricter grader cannot be
placed there — it is lower for reasons that have nothing to do with the system
being measured, and no amount of footnoting fixes that.

**What it was, and what the reversal cost.** Until 2026-07-31 duplicates were
significant, on the reasoning that a join on a non-unique key returns every
correct row several times and that is the most common way LLM-written SQL is
wrong. That reasoning still holds. Set comparison scores those queries correct,
so the project has traded a real diagnostic for comparability, deliberately
(**D23**).

**Measured effect of the reversal.** Re-scoring the four full runs from their
stored SQL, with no new model calls: HARD baseline 54.6% → 57.4%, HARD + picker
55.4% → 59.2%, HARD + picker + repair 54.8% → 59.0%, EASY 55.4% → 58.4%. The
noise band re-derived under the new rule is ±2.5 points, unchanged. No
conclusion moved.

**The old numbers are not deleted.** Their `RUNS.md` entries stand as written;
the re-scored numbers are separate, later entries. A number is never edited
after the fact, including when the grader changes underneath it.



## 2. Reference queries that do not answer their own question stay in the set

**Choice.** A gold query whose SQL answers a different question than its English
prompt is scored as written, like every other question. It is not quarantined,
not rejected, and not excluded from the denominator.

**Example.** `bird-0032` asks "Among the events attended by more than 10 members,
how many of them are meetings?" — a count. Its gold SQL takes events with more
than 10 attendees, `EXCEPT`s away every event of type `Meeting`, and returns the
*names* of what remains: nine rows describing the events that are **not**
meetings. A correct answer to the English question scores 0.

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
Both readings are correct English; the gold SQL picks one, and on the next
question it picks the other. Measured over the 227 failures of the HARD baseline
run: gold used `DISTINCT` where the generated SQL did not **29** times, and the
generated SQL used it where gold did not **28** times. A blanket rule in either
direction wins one side and loses the other.

**Interaction with issue 1.** Under BIRD's set comparison this disagreement is
mostly invisible; under multiset comparison it is a full failure. So this bucket
is partly the price of the stricter comparator, and it is paid deliberately.

**Effect.** Largely resolved by the reversal in issue 1: under set comparison a
dedupe disagreement is invisible unless the two results differ for some other
reason as well. It is recorded here because the underlying ambiguity in the
questions is still there, and any future return to multiset grading brings the
whole bucket back.
