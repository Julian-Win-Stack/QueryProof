# Known issues

Deliberate divergences from BIRD's evaluation, and decisions that would
otherwise read as bugs. Each is a settled choice with its reasoning, not an open
question.

## 1. Rows are compared as a multiset, not a set

**Choice.** Two results are equal iff they contain the same rows the same number
of times. Row order is ignored, column order is significant, column names are
never consulted, and a duplicated row is a real difference.

**Why.** BIRD compares result *sets*, which forgives a result that returns every
correct row plus duplicates. That is the exact symptom of a join on a non-unique
key — the single most common way an LLM gets SQL wrong. Grading it as correct
would hide the failure mode the project exists to measure.

**Effect.** For identical generated SQL, our accuracy is at most BIRD's and
sometimes lower. That gap is the point, not an error to reconcile. Never add a
dedupe step to make the numbers line up.

## 2. Session timezone is pinned to `Asia/Shanghai` (+08)

**Choice.** Every connection runs `SET TimeZone = 'Asia/Shanghai'` — gold
validation and eval execution alike.

**Why.** Eleven columns in `BIRD_dev.sql` are `timestamp with time zone`, and
all 882,084 timestamp literals in the dump carry a `+08` offset. Postgres
resolves a naive literal against the *session* zone, so under UTC the gold
predicate `CreationDate = '2014-04-23 20:29:39.0'` misses the stored instant by
eight hours. BIRD's original SQLite holds these as naive text, so `+08` is the
reading the gold SQL was written against.

**Measured effect.** Under UTC, `bird-0307` and `bird-0308` return zero rows.
Under `+08` they return one row each — the row their question asks for. That is
the entire difference between a 498 and a 500 denominator.

**Gotcha.** Use the named zone. `SET TimeZone = '+08'` is read POSIX-style and
means UTC−8, i.e. sixteen hours off in the wrong direction.

**Residual divergence.** An absolute instant is still not the same object as
SQLite's naive text. A query that formats or extracts from these columns agrees
with BIRD under `+08`, but one that compares them across zones has no SQLite
equivalent to agree with.

## 3. Zero-row gold queries are excluded — currently there are none

**Choice.** A gold query that executes but returns no rows goes to
`gold/quarantine.json` and is out of the denominator. One that fails to execute
goes to `gold/rejected.json` and is likewise out.

**Why quarantine at all.** An empty result is matched by any query that also
returns nothing, including SQL that is wrong in every other respect. Such a
question scores a free point and measures nothing.

**Current state.** 500 validated, 0 quarantined, 0 rejected. Every one of BIRD's
500 gold queries is valid Postgres and returns at least one row under `+08`. The
rule stays in force because it governs re-runs, not because anything is excluded
today.

**Denominator.** Read `|validated|` from the file at runtime. It is 500 now and
a hardcoded 500 is still a bug — a future re-run that quarantines something must
produce a different percentage, not a wrong one.
