# The 26 questions between 72.4% and the ceiling

The best configuration answers 362 of 500 questions correctly. 112 questions
are out of reach (broken or unmatchable reference answers — the README covers
them). This document is the other 26: every question the system could still
get right and currently doesn't. Each one was read by hand — the generated
query, the reference query, and the actual rows both return.

**How to read this page.** Every benchmark question comes with a *hint* (the
benchmark's own clarifying note) and a *reference query* — the SQL that
defines the correct answer. An answer is correct only if it returns exactly
the same rows as the reference: row order is ignored, but **column order
matters and extra columns fail** — a perfect answer with one extra column
scores zero. That strictness explains most of what follows.

**The record column** shows how often each question passed: first across the
eight full pipeline runs (earlier runs are earlier configurations, so early
zeros can be either "not fixed yet" or bad luck), then across the two runs of
the agent — the variant that can inspect stored data before answering.

---

## 1. Near-identical columns — it picks the wrong twin (5 questions)

The database has two columns or tables with almost the same name, the
question's words don't say which, and the reference picked one. The agent can
sometimes catch these by looking at what the columns actually store — it wins
them some runs, not reliably.

| id | The question, shortened | Why it fails | Record (pipeline · agent) |
|---|---|---|---|
| 0023 | Nationality of the customer who spent 548.4 | Reads "nationality" as the customer's currency; the reference means the *gas station's* country. A decimal price compared without rounding also matches nothing. | 0 of 8 · 1 of 2 |
| 0366 | All types of German cards | Grabs the translated `type` text from the language table; the reference wants the English `subtypes` + `supertypes` columns. | 2 of 8 · 1 of 2 |
| 0369 | French name of the Creature card | Filters `type = 'Creature'` — that column stores `"Creature — Human Soldier"`. The sibling `types` column holds the bare word. Zero rows. | 2 of 8 · 1 of 2 |
| 0447 | Enrollment difference by `DOC` type | The question names the column `DOC`; it returns the neighboring human-readable label column instead. | 1 of 8 · 1 of 2 |
| 0367 | Cards whose info mentions "triggered ability" | Two tables both have a `text` column. It searches the card's own text (35 matches); the reference searches the rulings table (1,382). Also the one question whose needed table the picker never sends. | 0 of 8 · 0 of 2 |

## 2. One detail read differently than the reference (8 questions)

The query is nearly right; one filter, join, or formula step goes the other
way. Both readings are usually defensible English — the reference picked one.

| id | The question, shortened | Why it fails | Record (pipeline · agent) |
|---|---|---|---|
| 0225 | Fastest lap of "the champion" in 2009 | Pins "champion" to the season champion; the reference means each race's winner. | 0 of 8 · 0 of 2 |
| 0494 | Loan growth rate for male clients | Missing "account owner only" filter — a loan with two account holders counts twice. | 0 of 8 · 0 of 2 |
| 0432 | % of chlorine in single-bond molecules | Joins atoms to bonds through the link table; the reference joins on molecule id — a silently different population. | 2 of 8 · 1 of 2 |
| 0058 | % of cost for the Yearly Kickoff | Same formula, computed in an order that loses precision digits. The rule that fixes it broke 4 other questions when measured. | 1 of 8 · 1 of 2 |
| 0372 | % of French cards without power | LEFT JOIN keeps untranslated cards in the denominator; the reference's INNER JOIN drops them. | 6 of 8 · 2 of 2 |
| 0462 | LA schools serving grades K–9 | Expresses "K-9" using the wrong table's grade columns, which never match the two right schools. | 1 of 8 · 0 of 2 |
| 0466 | % eligible free meals for one school | Returns the stored percent column — which holds a *fraction* (0.70); the reference computes the formula (70.15). | 0 of 8 · 0 of 2 |
| 0323 | Avg up-votes and age of active users | Returns one row *per user*; the reference wants one average over all qualifying users. | 1 of 8 · 1 of 2 |

## 3. Right values, wrong output shape (8 questions)

The rows are correct — the query returns an extra column, or the asked-for
columns in a different order. The prompt already forbids this; the model
slips on ~10% of rolls, a different question each run. This class *is* the
±2.5-point noise band.

| id | The question, shortened | Why it fails | Record (pipeline · agent) |
|---|---|---|---|
| 0013 | Highest monthly consumption in 2012 | Adds the month label next to the asked-for total. | 1 of 8 · 2 of 2 |
| 0029 | Consumption status of high payers | Adds customer id and date next to the asked-for consumption. | 0 of 8 · 0 of 2 |
| 0036 | Was each October Meeting expense approved | Adds id and description next to the asked-for yes/no column. | 1 of 8 · 0 of 2 |
| 0109 | Diagnosis, ID, age of low-RBC patients | Same 73 rows, same values — columns ordered id/diagnosis/age instead of diagnosis/id/age. | 0 of 8 · 1 of 2 |
| 0199 | Best lap time, driver, and race | Same single row — lap time placed last instead of first. | 0 of 8 · 2 of 2 |
| 0236 | Top 3 German drivers by pit-stop time | Reads "born between 1980–1985" as excluding 1985 (drops one driver) and adds the sort value as a column. | 0 of 8 · 1 of 2 |
| 0449 | Meal rate of top-5 schools | Sorts a column containing NULLs without pushing them last, so three blank schools crowd out the real top 5. | 2 of 8 · 2 of 2 |
| 0459 | Street address of the 7th-best school | Address and name emitted in the wrong order. | 3 of 8 · 0 of 2 |

## 4. Nothing is broken — they pass in other runs (5 questions)

These failed the headline run and pass in others. The model is genuinely
torn between two readings, and which side it lands on varies run to run.
No mechanism to fix; re-running flips them.

| id | The question, shortened | Record (pipeline · agent) |
|---|---|---|
| 0306 | % of high-score posts owned by elder users | 7 of 8 · 2 of 2 |
| 0070 | Category of events held at MU 215 | 3 of 8 · 2 of 2 |
| 0091 | Age and diagnosis of highest-hemoglobin patient | 2 of 8 · 2 of 2 |
| 0349 | Legalities of single-faced artifact cards | 2 of 8 · 1 of 2 |
| 0465 | Magnet K–8 schools offering multiple grade spans | 3 of 8 · 1 of 2 |

---

## Three of them, in full

**0369 — the twin-column trap.** *"What is the foreign name of the card in
French of type Creature…"*

```sql
-- Ours: 0 rows. `type` stores the full line "Creature — Human Soldier".
SELECT fd.name FROM cards c JOIN foreign_data fd ON c.uuid = fd.uuid
WHERE fd.language = 'French' AND c.type LIKE 'Creature%' AND ...

-- Reference: 50 rows. `types` (plural) stores the bare word.
SELECT name FROM foreign_data WHERE uuid IN
  (SELECT uuid FROM cards WHERE types = 'Creature' AND ...) AND language = 'French'
```

Nothing in the schema says which of `type`/`types` holds the bare word — but
one SELECT on each would show it. This is exactly what the agent variant can
discover, and why this class flips under the agent instead of always failing.

**0109 — same answer, zero points.** *"What are the patient's diagnosis …
State their ID and age."*

```sql
-- Ours: 73 rows — id, age, diagnosis.
SELECT p.id, EXTRACT(YEAR FROM CURRENT_TIMESTAMP) - EXTRACT(YEAR FROM p.birthday), p.diagnosis
FROM patient p JOIN laboratory l ON p.id = l.id WHERE l.rbc < 3.5

-- Reference: the same 73 rows — diagnosis, id, age.
SELECT DISTINCT T1.Diagnosis, T1.ID, EXTRACT(YEAR FROM CURRENT_TIMESTAMP) - EXTRACT(YEAR FROM T1.Birthday)
FROM Patient T1 JOIN Laboratory T2 ON T1.ID = T2.ID WHERE T2.RBC < 3.5
```

Identical rows, identical values. The columns follow the question's phrasing
in a different order, and column order is graded. Score: zero.

**0013 — the helpful extra column.** *"What is the highest monthly
consumption in the year 2012?"*

```sql
-- Ours: the right month and the right total — plus the month label.
SELECT SUBSTR(date,5,2) AS month, SUM(CAST(consumption AS float))
FROM yearmonth WHERE SUBSTR(date,1,4) = '2012'
GROUP BY SUBSTR(date,5,2) ORDER BY 2 DESC NULLS LAST LIMIT 1

-- Reference: the total alone.
SELECT SUM(CAST(Consumption AS float)) FROM yearmonth
WHERE SUBSTR(Date,1,4) = '2012' GROUP BY SUBSTR(Date,5,2)
ORDER BY SUM(Consumption) DESC NULLS LAST LIMIT 1
```

The aggregation is perfect. The model added the month as context — helpful
to a human, fatal to the grader.

---

Why none of these are "just fixed": every mechanical fix that could touch
them was built and measured — the receipts are in [RUNS.md](../RUNS.md).
Rules that break the tie for group 2 broke mirror questions every time they
were tried (three separate measurements); group 3 is the model's ~10% slip
rate, which harder rules, voting, and self-checks all failed to move; group 1
is winnable only by the agent variant, which wins them one roll in two.

Full working notes per question — every query, row count, and per-run stamp,
in their original unpolished form:
[winnable-failures.md](winnable-failures.md).
