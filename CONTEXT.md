# QueryProof

A natural language interface to a Postgres database, and an eval harness that
measures how often it is right. This glossary fixes the vocabulary the project
uses to talk about questions, answers, and correctness.

## Language

### The question set

**Gold record**:
One BIRD Mini-Dev question, its evidence hint, its reference SQL, and the
identity `bird-NNNN` derived from its position in the source file.
_Avoid_: row, example, sample, test case

**Gold SQL**:
The reference query that ships with a gold record. Re-executed on every eval run
to produce the answer a generated query is judged against.
_Avoid_: expected query, ground truth query

**Validated**:
A gold record whose gold SQL ran without error and returned at least one row.
The set of validated records is the accuracy denominator.

**Quarantined**:
A gold record whose gold SQL ran without error but returned zero rows. Excluded
from the denominator, because every wrong answer that also returns nothing would
score as correct.
_Avoid_: skipped, ignored

**Rejected**:
A gold record whose gold SQL failed to execute at all.

**Dev slice**:
The frozen set of 100 gold record ids used for iteration, stratified on
`db_id` × `difficulty`. Fixed once; a slice that moves makes two runs
incomparable.
_Avoid_: sample, subset, holdout

### Correctness

**Correct**:
A generated query is correct when executing it returns the same rows as the gold
SQL. Nothing else is consulted — no model, no similarity, no human.
_Avoid_: passing, matching, accurate

**Same rows**:
Row order is ignored. Column order matters. Column names are never consulted.
Duplicate rows are a real difference — two results are compared as multisets, not
sets. Two numeric values are the same value when they agree to six decimal
places, whether Postgres returned them as a number or as a string; a date and a
text rendering of that same date are likewise the same value. Formatting is not
an answer.

**Table recall**:
Whether every table the gold SQL touches was present in the set of tables sent
to the model. Measured against the gold SQL, never against `db_id`.
_Avoid_: coverage, precision, hit rate

**Noise floor**:
The spread in accuracy across repeat runs of an unchanged configuration. A
difference between two configurations smaller than the noise floor is not a
difference.
_Avoid_: variance, error bars

### Asking

**Evidence**:
The hint BIRD ships alongside a question, naming the columns or the formula the
answer needs. Part of the question in eval runs.

**Mode**:
Which tables reach the prompt. **EASY** sends every table belonging to the
record's `db_id`. **HARD** sends whatever a picker selects out of all 75.
_Avoid_: difficulty (that word belongs to BIRD's per-question `simple` /
`moderate` / `challenging` label)

**Picker**:
The component that selects which tables to send to the model in HARD mode.
_Avoid_: retriever, selector, router

**Self-repair**:
Feeding a Postgres error and the SQL that caused it back to the model for
another attempt. Only an execution error triggers it — a query that runs and
returns wrong rows has no signal to repair against.
_Avoid_: retry loop, healing, reflection
