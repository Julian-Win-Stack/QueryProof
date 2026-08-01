# The 99 winnable failures

Every question the default configuration gets wrong **and** could plausibly get
right. This is the work list. It is deliberately not the full failure set.

## Read this first

The system answers 500 questions. It gets **304 right**. Of the 196 it gets
wrong:

- **97 can never be won.** The reference SQL is broken, or it picks an output
  convention the question does not specify and no system could guess. Those are
  excluded from this document on purpose — working on them teaches nothing.
- **99 are winnable.** They are all here.

So the ceiling on this benchmark is **403 of 500, about 81%** — not 100%. A
system scoring 81% would be answering every question a correct answer exists for.

Of the 99 here:

- **59 already have a query that worked.** Some other configuration of this
  same system produced SQL that matched the reference. Those entries include it
  under "A query that did match". Diffing our SQL against that one is the fastest
  way in.
- **58 fail every single time.** The rest are answered differently across
  identical runs, so a fix must be verified over several runs, not one.

## How grading works

A query is correct when it returns **the same rows** as the reference query.

- Row order is ignored.
- Column order **matters**.
- Column names are never compared.
- Duplicate rows are ignored — two rows or ten of the same values are the same answer.
- Numbers are compared to 6 decimal places.

The practical consequence: returning one extra column makes an otherwise perfect
answer wrong. That is why "Wrong columns returned" is the largest group below.

## The configuration these came from

Prompt v1, LLM table picker, five sample rows per table, no repair, no voting —
the project default, described in [CLAUDE.md](../CLAUDE.md). Source run:
`runs/2026-07-31-152120-exp-rows-full.json`. Every query below was re-executed
against the live database while writing this file, so the results shown are
current, not copied from the run.

To reproduce:

```bash
PICKER=llm npm run eval:hard
```

## What is wrong, by count

| Problem | Count |
|---|---|
| Wrong columns returned | 29 |
| Read the wrong table or column | 19 |
| Missing or extra filter | 16 |
| Counted or averaged at the wrong level | 13 |
| Joined through the wrong path | 9 |
| Filter value does not match stored data | 7 |
| Query failed to execute | 6 |

---

## Wrong columns returned (29)

The values are right. The number or order of returned columns is not — usually an extra column the query sorted by, or two names concatenated into one. Column names are never compared, but column *count* and *order* are.

### bird-0005 — debit_card_specializing, moderate

**Question.** What was the gas consumption peak month for SME customers in 2013?

**Evidence given with it.** Year 2013 can be presented as Between 201301 And 201312; The first 4 strings of the Date values in the yearmonth table can represent year; The 5th and 6th string of the date can refer to month.

**What we did.** Grouped yearmonth rows for SME customers by the full ym.date and returned the peak as '201304' in one column.

**What is expected.** Gold groups by SUBSTR(Date, 5, 2) and projects only the two-character month, returning '04'.

**To fix it.** When the question asks which month, project the month substring the evidence describes (characters 5-6 of yearmonth.Date), not the whole '201304' key and not the SUM used for ordering.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: customers, yearmonth

**Reference SQL — this is what correct means.**

```sql
SELECT SUBSTR(T2.Date, 5, 2) FROM customers AS T1 INNER JOIN yearmonth AS T2 ON T1.CustomerID = T2.CustomerID WHERE SUBSTR(T2.Date, 1, 4) = '2013' AND T1.Segment = 'SME' GROUP BY SUBSTR(T2.Date, 5, 2) ORDER BY SUM(T2.Consumption) DESC NULLS LAST LIMIT 1
```

```
1 rows x 1 cols  [substr]
    04
```

**Our SQL — wrong.**

```sql
SELECT ym."date" FROM "yearmonth" ym JOIN "customers" c ON ym."customerid" = c."customerid" WHERE c."segment" = 'SME' AND ym."date"::text BETWEEN '201301' AND '201312' GROUP BY ym."date" ORDER BY SUM(ym."consumption") DESC LIMIT 1
```

```
1 rows x 1 cols  [date]
    201304
```

</details>

---

### bird-0029 — debit_card_specializing, moderate

**Question.** For all the people who paid more than 29.00 per unit of product id No.5. Give their consumption status in the August of 2012.

**Evidence given with it.** August of 2012 refers to the Date value = '201208' ; Price per unit of product = Price / Amount;

**What we did.** Returned three columns — y.customerid, y.date and y.consumption — for the 9 customers whose product-5 unit price exceeded 29.00 in 201208.

**What is expected.** Gold returns yearmonth.Consumption alone, a single column, joining transactions_1k to yearmonth on CustomerID.

**To fix it.** Project exactly the column the question names ('consumption status' = yearmonth.Consumption) and drop the customerid and date columns added as context.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: transactions_1k, yearmonth

**Reference SQL — this is what correct means.**

```sql
SELECT T2.Consumption FROM transactions_1k AS T1 INNER JOIN yearmonth AS T2 ON T1.CustomerID = T2.CustomerID WHERE T1.Price / NULLIF(T1.Amount, 0) > 29.00 AND T1.ProductID = 5 AND T2.Date = '201208'
```

```
10 rows x 1 cols  [consumption]
    1903.2
    88265.39
    1129.2
    126157.7
    ... 6 more rows
```

**Our SQL — wrong.**

```sql
SELECT y.customerid, y.date, y.consumption FROM "yearmonth" y WHERE y.date = '201208' AND y.customerid IN (SELECT t.customerid FROM "transactions_1k" t WHERE t.productid = 5 AND t.amount > 0 AND t.price / t.amount > 29.00)
```

```
9 rows x 3 cols  [customerid, date, consumption]
    46933 | 201208 | 1129.2
    45868 | 201208 | 1142.95
    18831 | 201208 | 1903.2
    23861 | 201208 | 8878.07
    ... 5 more rows
```

</details>

---

### bird-0036 — student_club, moderate

**Question.** Was each expense in October Meeting on October 8, 2019 approved?

**Evidence given with it.** event_name = 'October Meeting' where event_date = '2019-10-08'; approved = True means expenses was approved; approved = False means expenses was not approved

**What we did.** Returned expense_id, expense_description and approved from expense filtered on expense_date = '2019-10-08' — three columns, all three approved values true.

**What is expected.** Gold returns the single approved column, reached by joining event to budget on link_to_event and budget to expense on link_to_budget, filtered by event_name = 'October Meeting' and event_date LIKE '2019-10-08%'.

**To fix it.** Project only the column the question asks about (expense.approved); the correct true values still fail because the extra expense_id and expense_description columns change the output shape.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: expense, event

**Reference SQL — this is what correct means.**

```sql
SELECT T3.approved FROM event AS T1 INNER JOIN budget AS T2 ON T1.event_id = T2.link_to_event INNER JOIN expense AS T3 ON T2.budget_id = T3.link_to_budget WHERE T1.event_name = 'October Meeting' AND T1.event_date LIKE '2019-10-08%'
```

```
3 rows x 1 cols  [approved]
    true
    true
    true
```

**Our SQL — wrong.**

```sql
SELECT e.expense_id, e.expense_description, e.approved FROM "expense" e WHERE e.expense_date = '2019-10-08'
```

```
3 rows x 3 cols  [expense_id, expense_description, approved]
    rec1nIjoZKTYayqZ6 | Water, Cookies | true
    recTUt9QxJ0Sp3H3m | Water, chips, cookies | true
    receRmFWtS9xJdkL2 | Pizza | true
```

</details>

---

### bird-0052 — student_club, moderate

**Question.** Among all the closed events, which event has the highest spend-to-budget ratio?

**Evidence given with it.** closed events refers to event_name where status = 'Closed'; highest spend-to budget ratio refers to MAX(DIVIDE(spent, amount))

**What we did.** Returned two columns, e.event_name and the computed b.spent / b.amount ratio, for the top closed event ('September Speaker', 1.1537333170572917).

**What is expected.** Gold returns event_name only; the spent/amount ratio appears in ORDER BY and is never projected.

**To fix it.** Keep the sort expression out of the SELECT list — order by b.spent / b.amount DESC and project event_name alone.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: event, budget

**Reference SQL — this is what correct means.**

```sql
SELECT T2.event_name FROM budget AS T1 INNER JOIN event AS T2 ON T1.link_to_event = T2.event_id WHERE T2.status = 'Closed' ORDER BY T1.spent / NULLIF(T1.amount, 0) DESC NULLS LAST LIMIT 1
```

```
1 rows x 1 cols  [event_name]
    September Speaker
```

**Our SQL — wrong.**

```sql
SELECT e.event_name, b.spent / b.amount AS ratio FROM event e JOIN budget b ON e.event_id = b.link_to_event WHERE e.status = 'Closed' AND b.amount <> 0 ORDER BY ratio DESC LIMIT 1
```

```
1 rows x 2 cols  [event_name, ratio]
    September Speaker | 1.1537333170572917
```

**A query that did match, from the `rows-v3` run.**

```sql
SELECT e.event_name FROM event e JOIN budget b ON e.event_id = b.link_to_event WHERE e.status = 'Closed' ORDER BY b.spent / b.amount DESC LIMIT 1
```

```
1 rows x 1 cols  [event_name]
    September Speaker
```

</details>

---

### bird-0055 — student_club, moderate

**Question.** List the name of students that have attended more than 7 events.

**Evidence given with it.** name of students means the full name; full name refers to first_name, last_name; attended more than 7 events refers to COUNT(link_to_event) > 7

**What we did.** Concatenated first_name and last_name into a single full_name column with `||`, returning the right 29 members as 29 rows x 1 column.

**What is expected.** Gold returns first_name and last_name as two separate columns (29 rows x 2 cols) for exactly the same members.

**To fix it.** When evidence says 'full name refers to first_name, last_name', emit the two columns side by side and never concatenate them, because column count is compared while column names are not.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: member, attendance, event

**Reference SQL — this is what correct means.**

```sql
SELECT T1.first_name, T1.last_name FROM member AS T1 INNER JOIN attendance AS T2 ON T1.member_id = T2.link_to_member GROUP BY T1.member_id, T1.first_name, T1.last_name HAVING COUNT(T2.link_to_event) > 7
```

```
29 rows x 2 cols  [first_name, last_name]
    Luisa | Guidi
    Vincent | Ratcliffe
    Rafi | Mckee
    Carlo | Jacobs
    ... 25 more rows
```

**Our SQL — wrong.**

```sql
SELECT m.first_name || ' ' || m.last_name AS full_name FROM "member" m JOIN "attendance" a ON m.member_id = a.link_to_member GROUP BY m.member_id, m.first_name, m.last_name HAVING COUNT(a.link_to_event) > 7
```

```
29 rows x 1 cols  [full_name]
    Luisa Guidi
    Vincent Ratcliffe
    Rafi Mckee
    Carlo Jacobs
    ... 25 more rows
```

**A query that did match, from the `rows-v3` run.**

```sql
SELECT m.first_name, m.last_name FROM member m JOIN attendance a ON m.member_id = a.link_to_member GROUP BY m.member_id, m.first_name, m.last_name HAVING COUNT(a.link_to_event) > 7
```

```
29 rows x 2 cols  [first_name, last_name]
    Luisa | Guidi
    Vincent | Ratcliffe
    Rafi | Mckee
    Carlo | Jacobs
    ... 25 more rows
```

</details>

---

### bird-0068 — student_club, simple

**Question.** List out the full name and total cost that member id "rec4BLdZHS2Blfp4v" incurred?

**Evidence given with it.** full name refers to first_name, last name

**What we did.** Returned full_name (first_name || ' ' || last_name) plus SUM(expense.cost), giving 1 row x 2 cols: 'Sacha Harrison | 866.25006'.

**What is expected.** Gold returns three columns — first_name, last_name, SUM(cost) — as 'Sacha | Harrison | 866.25006'.

**To fix it.** Keep first_name and last_name as separate output columns whenever the evidence enumerates them, since an extra concatenation collapses two graded columns into one.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: member, expense

**Reference SQL — this is what correct means.**

```sql
SELECT T1.first_name, T1.last_name, SUM(T2.cost) FROM member AS T1 INNER JOIN expense AS T2 ON T1.member_id = T2.link_to_member WHERE T1.member_id = 'rec4BLdZHS2Blfp4v' GROUP BY T1.first_name, T1.last_name
```

```
1 rows x 3 cols  [first_name, last_name, sum]
    Sacha | Harrison | 866.25006
```

**Our SQL — wrong.**

```sql
SELECT m.first_name || ' ' || m.last_name AS full_name, SUM(e.cost) AS total_cost FROM "member" m JOIN "expense" e ON m.member_id = e.link_to_member WHERE m.member_id = 'rec4BLdZHS2Blfp4v' GROUP BY m.first_name, m.last_name
```

```
1 rows x 2 cols  [full_name, total_cost]
    Sacha Harrison | 866.25006
```

**A query that did match, from the `rows-v3` run.**

```sql
SELECT m.first_name, m.last_name, SUM(e.cost) AS total_cost FROM "member" m JOIN "expense" e ON m.member_id = e.link_to_member WHERE m.member_id = 'rec4BLdZHS2Blfp4v' GROUP BY m.first_name, m.last_name
```

```
1 rows x 3 cols  [first_name, last_name, total_cost]
    Sacha | Harrison | 866.25006
```

</details>

---

### bird-0102 — thrombosis_prediction, moderate

**Question.** Please provide the diagnosis of patients with ALT glutamic pylvic transaminase beyond the normal range by ascending order of their date of birth.

**Evidence given with it.** ALT glutamic pylvic transaminase beyond the normal range refers to GPT > 60; The larger the birthday value, the younger the person is, and vice versa;

**What we did.** Selected p.diagnosis AND p.birthday, returning 871 rows of two columns.

**What is expected.** Gold returns diagnosis only — birthday is purely the sort key in DISTINCT ON (T1.Birthday) ... ORDER BY T1.Birthday ASC — and the identical query with the birthday column dropped (871 rows, one column) scored correct because duplicate rows are ignored.

**To fix it.** Never project a column that exists only to drive ORDER BY; the SELECT list should contain exactly what the question asks to be shown ('provide the diagnosis').

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: patient, laboratory

**Reference SQL — this is what correct means.**

```sql
SELECT DISTINCT ON (T1.Birthday) T1.Diagnosis FROM Patient AS T1 INNER JOIN Laboratory AS T2 ON T1.ID = T2.ID WHERE T2.GPT > 60 ORDER BY T1.Birthday ASC
```

```
89 rows x 1 cols  [diagnosis]
    MRA
    SLE
    RA
    Adult STILL
    ... 85 more rows
```

**Our SQL — wrong.**

```sql
SELECT p.diagnosis, p.birthday FROM patient p JOIN laboratory l ON p.id = l.id WHERE l.gpt > 60 ORDER BY p.birthday ASC
```

```
871 rows x 2 cols  [diagnosis, birthday]
    MRA | Fri Dec 01 1922 00:00:00 GMT-0800 (Pacif
    MRA | Fri Dec 01 1922 00:00:00 GMT-0800 (Pacif
    MRA | Fri Dec 01 1922 00:00:00 GMT-0800 (Pacif
    MRA | Fri Dec 01 1922 00:00:00 GMT-0800 (Pacif
    ... 867 more rows
```

**A query that did match, from the `vote5` run.**

```sql
SELECT p.diagnosis FROM patient p JOIN laboratory l ON p.id = l.id WHERE l.gpt > 60 ORDER BY p.birthday ASC
```

```
871 rows x 1 cols  [diagnosis]
    MRA
    MRA
    MRA
    MRA
    ... 867 more rows
```

</details>

---

### bird-0109 — thrombosis_prediction, moderate

**Question.** What are the patient's diagnosis for those who has lower red blood blood cell? State their ID and age.

**Evidence given with it.** patient's diagnosis refers to Diagnosis; lower red blood cell refers to RBC < 3.5; age = SUBTRACT(year(current_timestamp), year(Birthday));

**What we did.** Returned the three columns as id, diagnosis, age — the same 73 rows with the same values as gold.

**What is expected.** Gold returns diagnosis, ID, age, in the order the question names them ('What are the patient's diagnosis ... State their ID and age').

**To fix it.** Order the SELECT list to follow the order the question mentions the fields, because column position is compared while column names are not.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: patient, laboratory

**Reference SQL — this is what correct means.**

```sql
SELECT DISTINCT T1.Diagnosis, T1.ID, EXTRACT(YEAR FROM CURRENT_TIMESTAMP) - EXTRACT(YEAR FROM T1.Birthday) AS Age FROM Patient AS T1 INNER JOIN Laboratory AS T2 ON T1.ID = T2.ID WHERE T2.RBC < 3.5
```

```
73 rows x 3 cols  [diagnosis, id, age]
    SJS | 1124385 | 82
    SLE, SJS, Adie | 1711181 | 52
    SLE | 4632548 | 99
    SLE | 2315140 | 91
    ... 69 more rows
```

**Our SQL — wrong.**

```sql
SELECT DISTINCT p."id", p.diagnosis, EXTRACT(YEAR FROM CURRENT_TIMESTAMP) - EXTRACT(YEAR FROM p.birthday) AS age FROM "patient" p JOIN "laboratory" l ON p."id" = l."id" WHERE l."rbc" < 3.5
```

```
73 rows x 3 cols  [id, diagnosis, age]
    1967597 | SLE | 47
    1617548 | DM | 58
    619178 | SJS | 80
    5122312 | SLE, APS | 57
    ... 69 more rows
```

</details>

---

### bird-0146 — european_football_2, simple

**Question.** Which player is older, Aaron Lennon or Abdelaziz Barrada?

**Evidence given with it.** The larger the birthday value, the younger the person is, and vice versa;

**What we did.** Selected player_name plus birthday from player for the two named players, returning two columns.

**What is expected.** Gold selects player_name only, a single column holding 'Aaron Lennon'.

**To fix it.** Keep the column used for ordering out of the SELECT list — 'which player is older' asks for the name, not the birthday that decided it.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: player

**Reference SQL — this is what correct means.**

```sql
SELECT player_name FROM Player WHERE player_name IN ('Aaron Lennon', 'Abdelaziz Barrada') ORDER BY birthday ASC NULLS FIRST LIMIT 1
```

```
1 rows x 1 cols  [player_name]
    Aaron Lennon
```

**Our SQL — wrong.**

```sql
SELECT player_name, birthday FROM "player" WHERE player_name IN ('Aaron Lennon', 'Abdelaziz Barrada') ORDER BY birthday ASC LIMIT 1
```

```
1 rows x 2 cols  [player_name, birthday]
    Aaron Lennon | 1987-04-16 00:00:00
```

</details>

---

### bird-0175 — european_football_2, simple

**Question.** Which top 4 leagues had the most games in the 2015-2016 season?

**Evidence given with it.** in the 2015-2016 season refers to season = '2015/2016'; league with most games refers to League.name where MAX(COUNT(id))

**What we did.** Selected l.name and COUNT(m.id) AS game_count, returning two columns for the top four leagues in season '2015/2016'.

**What is expected.** Gold returns League.name only; the match count is a sort key, not an output column.

**To fix it.** When an aggregate is only needed for ORDER BY, put it in the ORDER BY clause and not in the SELECT list.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: match, league

**Reference SQL — this is what correct means.**

```sql
SELECT t1.name FROM League AS t1 INNER JOIN Match AS t2 ON t1.id = t2.league_id WHERE t2.season = '2015/2016' GROUP BY t1.name ORDER BY COUNT(t2.id) DESC NULLS LAST LIMIT 4
```

```
4 rows x 1 cols  [name]
    Italy Serie A
    France Ligue 1
    England Premier League
    Spain LIGA BBVA
```

**Our SQL — wrong.**

```sql
SELECT l.name, COUNT(m.id) AS game_count FROM "match" m JOIN "league" l ON m.league_id = l.id WHERE m.season = '2015/2016' GROUP BY l.name ORDER BY game_count DESC LIMIT 4
```

```
4 rows x 2 cols  [name, game_count]
    Italy Serie A | 380
    France Ligue 1 | 380
    England Premier League | 380
    Spain LIGA BBVA | 380
```

</details>

---

### bird-0187 — formula_1, moderate

**Question.** For all the drivers who finished the game in race No. 592, who is the oldest?

**Evidence given with it.** drivers who finished the race refers to time is not empty (i.e. time IS NOT NULL); race number refers to raceId; date of birth refers to drivers.dob; The larger the birthday value, the younger the person is, and vice versa;

**What we did.** Selected d.driverid, d.forename, d.surname and d.dob, four columns, for the oldest finisher of raceid 592.

**What is expected.** Gold returns forename and surname only — the same driver, Jean-Pierre Beltoise, in two columns, exactly as the working query did.

**To fix it.** Drop the join key (driverid) and the sort key (dob) from the SELECT list — 'who is the oldest' asks for the name alone.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: results, drivers, races

**Reference SQL — this is what correct means.**

```sql
SELECT T1.forename, T1.surname FROM drivers AS T1 INNER JOIN results AS T2 ON T2.driverId = T1.driverId WHERE T2.raceId = 592 AND NOT T2.time IS NULL AND NOT T1.dob IS NULL ORDER BY T1.dob ASC NULLS FIRST LIMIT 1
```

```
1 rows x 2 cols  [forename, surname]
    Jean-Pierre | Beltoise
```

**Our SQL — wrong.**

```sql
SELECT d.driverid, d.forename, d.surname, d.dob FROM drivers d JOIN results r ON d.driverid = r.driverid WHERE r.raceid = 592 AND r.time IS NOT NULL ORDER BY d.dob ASC LIMIT 1
```

```
1 rows x 4 cols  [driverid, forename, surname, dob]
    306 | Jean-Pierre | Beltoise | Mon Apr 26 1937 00:00:00 GMT-0800 (Pacif
```

**A query that did match, from the `rows-v3` run.**

```sql
SELECT d.forename, d.surname FROM results r JOIN drivers d ON r.driverid = d.driverid WHERE r.raceid = 592 AND r.time IS NOT NULL ORDER BY d.dob ASC LIMIT 1
```

```
1 rows x 2 cols  [forename, surname]
    Jean-Pierre | Beltoise
```

</details>

---

### bird-0188 — formula_1, moderate

**Question.** Who was the player that got the lap time of 0:01:27 in the race No. 161? Show his introduction website.

**Evidence given with it.** player and driver are synonyms; the lap time of 0:0M:SS refers to lapTime.time LIKE 'M:SS%';race number refers to raceId; introduction website of the drivers refers to url;

**What we did.** Selected only d.url from laptimes joined to drivers where raceid = 161 and time LIKE '1:27%', giving 82 rows of one column.

**What is expected.** Gold returns DISTINCT forename, surname and url — three columns and nine rows.

**To fix it.** Answer both halves of a compound question: 'who was the player ... show his introduction website' needs forename and surname in front of the url.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: laptimes, drivers

**Reference SQL — this is what correct means.**

```sql
SELECT DISTINCT T2.forename, T2.surname, T2.url FROM lapTimes AS T1 INNER JOIN drivers AS T2 ON T2.driverId = T1.driverId WHERE T1.raceId = 161 AND T1.time LIKE '1:27%'
```

```
9 rows x 3 cols  [forename, surname, url]
    David | Coulthard | http://en.wikipedia.org/wiki/David_Coult
    Heinz-Harald | Frentzen | http://en.wikipedia.org/wiki/Heinz-Haral
    Jarno | Trulli | http://en.wikipedia.org/wiki/Jarno_Trull
    Jenson | Button | http://en.wikipedia.org/wiki/Jenson_Butt
    ... 5 more rows
```

**Our SQL — wrong.**

```sql
SELECT d.url FROM laptimes l JOIN drivers d ON l.driverid = d.driverid WHERE l.raceid = 161 AND l.time LIKE '1:27%'
```

```
82 rows x 1 cols  [url]
    http://en.wikipedia.org/wiki/David_Coult
    http://en.wikipedia.org/wiki/David_Coult
    http://en.wikipedia.org/wiki/David_Coult
    http://en.wikipedia.org/wiki/David_Coult
    ... 78 more rows
```

</details>

---

### bird-0196 — formula_1, moderate

**Question.** For the drivers who took part in the race in 1983/7/16, what's their race completion rate?

**Evidence given with it.** DIVIDE(COUNT(driverid when time has value ), (COUNT(driverid )) as percentage; in 1983/7/16 refers to when date = '1983-07-16'

**What we did.** Divided COUNT(CASE WHEN results.time IS NOT NULL) by COUNT(driverid) for races.date = '1983-07-16' and returned the raw fraction 0.1724137931034483.

**What is expected.** Gold multiplies the same division by 100 and returns 17.24137931034483, the completion rate expressed as a percentage.

**To fix it.** When the evidence labels a ratio 'as percentage', multiply the division by 100 instead of returning the bare fraction.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: races, results, drivers, status

**Reference SQL — this is what correct means.**

```sql
SELECT CAST(COUNT(CASE WHEN NOT T2.time IS NULL THEN T2.driverId END) AS REAL) * 100 / NULLIF(COUNT(T2.driverId), 0) FROM races AS T1 INNER JOIN results AS T2 ON T2.raceId = T1.raceId WHERE T1.date = '1983-07-16'
```

```
1 rows x 1 cols  [?column?]
    17.24137931034483
```

**Our SQL — wrong.**

```sql
SELECT CAST(COUNT(CASE WHEN r."time" IS NOT NULL THEN r."driverid" END) AS FLOAT) / COUNT(r."driverid") AS completion_rate FROM "results" r JOIN "races" ra ON r."raceid" = ra."raceid" WHERE ra."date" = '1983-07-16'
```

```
1 rows x 1 cols  [completion_rate]
    0.1724137931034483
```

</details>

---

### bird-0199 — formula_1, moderate

**Question.** What is the best lap time recorded? List the driver and race with such recorded lap time.

**Evidence given with it.** the best lap time refers to min(milliseconds); List the driver refers to drivers.forename and drivers.surname; List the race refers to races.name

**What we did.** Returned forename, surname, races.name, laptimes.milliseconds — the correct row (Lewis, Hamilton, Austrian Grand Prix, 67411) with milliseconds in the last position.

**What is expected.** Gold returns milliseconds first, then forename, surname, races.name, matching the order the question asks ('what is the best lap time? list the driver and race').

**To fix it.** Lay out the SELECT list in the order the question mentions the items, since column position is compared and column names are not.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: laptimes, drivers, races

**Reference SQL — this is what correct means.**

```sql
SELECT T2.milliseconds, T1.forename, T1.surname, T3.name FROM drivers AS T1 INNER JOIN lapTimes AS T2 ON T1.driverId = T2.driverId INNER JOIN races AS T3 ON T2.raceId = T3.raceId ORDER BY T2.milliseconds ASC NULLS FIRST LIMIT 1
```

```
1 rows x 4 cols  [milliseconds, forename, surname, name]
    67411 | Lewis | Hamilton | Austrian Grand Prix
```

**Our SQL — wrong.**

```sql
SELECT d.forename, d.surname, r.name, l.milliseconds FROM laptimes l JOIN drivers d ON l.driverid = d.driverid JOIN races r ON l.raceid = r.raceid ORDER BY l.milliseconds ASC LIMIT 1
```

```
1 rows x 4 cols  [forename, surname, name, milliseconds]
    Lewis | Hamilton | Austrian Grand Prix | 67411
```

</details>

---

### bird-0203 — formula_1, simple

**Question.** How old is the youngest Japanese driver? What is his name?

**Evidence given with it.** date of birth refers to drivers.dob; The larger the birthday value, the younger the person is, and vice versa; Japanese refers to nationality = 'Japanese'; age = YEAR(CURRENT_TIMESTAMP) - YEAR(dob);

**What we did.** Returned forename, surname, then the computed age for Kamui Kobayashi, putting age in the last column.

**What is expected.** Gold returns age first, then forename and surname, following the question order 'how old is the youngest Japanese driver? what is his name'.

**To fix it.** Emit columns in the order the question asks for them — 'how old' comes before 'his name', so the computed age is column one.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: drivers

**Reference SQL — this is what correct means.**

```sql
SELECT EXTRACT(YEAR FROM CURRENT_TIMESTAMP) - EXTRACT(YEAR FROM dob) AS age, forename, surname FROM drivers WHERE nationality = 'Japanese' ORDER BY dob DESC LIMIT 1
```

```
1 rows x 3 cols  [age, forename, surname]
    40 | Kamui | Kobayashi
```

**Our SQL — wrong.**

```sql
SELECT forename, surname, EXTRACT(YEAR FROM CURRENT_DATE) - EXTRACT(YEAR FROM dob) AS age FROM drivers WHERE nationality = 'Japanese' ORDER BY dob DESC LIMIT 1
```

```
1 rows x 3 cols  [forename, surname, age]
    Kamui | Kobayashi | 40
```

</details>

---

### bird-0273 — superhero, challenging

**Question.** List the eyes, hair and skin colour of all female superheroes published by Dark Horse Comics.

**Evidence given with it.** eyes refers to eye_colour_id; hair refers to hair_colour_id; skin colour refers to skin_colour_id; female superheroes refers to gender = 'Female'; published by Dark Horse Comics refers to publisher_name = 'Dark Horse Comics';

**What we did.** Returned 4 columns - superhero_name plus eye/hair/skin colour names resolved through three LEFT JOINs to the colour table - for the 5 female Dark Horse Comics heroes.

**What is expected.** Gold returns 3 columns, the raw superhero.eye_colour_id, hair_colour_id and skin_colour_id integers such as 14 | 6 | 1, with no name column and no join to colour.

**To fix it.** When the evidence maps a phrase to an *_id column ('eyes refers to eye_colour_id'), project that id column directly instead of joining to the lookup table, and never add an identifying name column that was not asked for.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: superhero, colour, gender, publisher

**Reference SQL — this is what correct means.**

```sql
SELECT T1.eye_colour_id, T1.hair_colour_id, T1.skin_colour_id FROM superhero AS T1 INNER JOIN publisher AS T2 ON T2.id = T1.publisher_id INNER JOIN gender AS T3 ON T3.id = T1.gender_id WHERE T2.publisher_name = 'Dark Horse Comics' AND T3.gender = 'Female'
```

```
5 rows x 3 cols  [eye_colour_id, hair_colour_id, skin_colour_id]
    14 | 6 | 1
    9 | 9 | 1
    1 | 1 | 1
    1 | 1 | 28
    ... 1 more rows
```

**Our SQL — wrong.**

```sql
SELECT s.superhero_name, ec.colour AS eye_colour, hc.colour AS hair_colour, sc.colour AS skin_colour FROM "superhero" s JOIN "gender" g ON s.gender_id = g.id JOIN "publisher" p ON s.publisher_id = p.id LEFT JOIN "colour" ec ON s.eye_colour_id = ec.id LEFT JOIN "colour" hc ON s.hair_colour_id = hc.id LEFT JOIN "colour" sc ON s.skin_colour_id = sc.id WHERE g.gender = 'Female' AND p.publisher_name = 'Dark Horse Comics'
```

```
5 rows x 4 cols  [superhero_name, eye_colour, hair_colour, skin_colour]
    Buffy | Green | Blond | No Colour
    Elastigirl | Brown | Brown | No Colour
    Liz Sherman | No Colour | No Colour | No Colour
    T-X | No Colour | No Colour | Silver
    ... 1 more rows
```

</details>

---

### bird-0288 — superhero, moderate

**Question.** What is the publisher for Hawkman, Karate Kid and Speedy?

**Evidence given with it.** publisher refers to publisher_name; Hawkman refers to superhero_name = 'Hawkman'; Karate Kid refers to superhero_name = 'Karate Kid'; Speedy refers to superhero_name = 'Speedy';

**What we did.** Selected s.superhero_name alongside p.publisher_name, returning 3 rows x 2 cols with the right publisher values.

**What is expected.** Gold selects only T2.publisher_name, returning 3 rows x 1 col of 'DC Comics'.

**To fix it.** Do not echo back the column used in the IN/WHERE filter — when the question asks only 'what is the publisher', the SELECT list is publisher_name alone even though three names were matched.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: superhero, publisher

**Reference SQL — this is what correct means.**

```sql
SELECT T2.publisher_name FROM superhero AS T1 INNER JOIN publisher AS T2 ON T1.publisher_id = T2.id WHERE T1.superhero_name IN ('Hawkman', 'Karate Kid', 'Speedy')
```

```
3 rows x 1 cols  [publisher_name]
    DC Comics
    DC Comics
    DC Comics
```

**Our SQL — wrong.**

```sql
SELECT s.superhero_name, p.publisher_name FROM superhero s JOIN publisher p ON s.publisher_id = p.id WHERE s.superhero_name IN ('Hawkman', 'Karate Kid', 'Speedy')
```

```
3 rows x 2 cols  [superhero_name, publisher_name]
    Hawkman | DC Comics
    Karate Kid | DC Comics
    Speedy | DC Comics
```

</details>

---

### bird-0297 — codebase_community, simple

**Question.** Which user has a higher reputation, Harlan or Jarrod Dixon?

**Evidence given with it.** "Harlan" and "Jarrod Dixon" are both DisplayName; highest reputation refers to Max(Reputation)

**What we did.** Selected displayname and reputation with ORDER BY reputation DESC LIMIT 1, returning 'Harlan | 457' in 2 columns.

**What is expected.** Gold selects DisplayName only, using MAX(Reputation) in a subquery so reputation never appears in the output.

**To fix it.** Keep the comparison metric in ORDER BY or a subquery and out of the SELECT list — a 'which one' question wants only the identifying column.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: users

**Reference SQL — this is what correct means.**

```sql
SELECT DisplayName FROM users WHERE DisplayName IN ('Harlan', 'Jarrod Dixon') AND Reputation = (SELECT MAX(Reputation) FROM users WHERE DisplayName IN ('Harlan', 'Jarrod Dixon'))
```

```
1 rows x 1 cols  [displayname]
    Harlan
```

**Our SQL — wrong.**

```sql
SELECT displayname, reputation FROM users WHERE displayname IN ('Harlan','Jarrod Dixon') ORDER BY reputation DESC LIMIT 1
```

```
1 rows x 2 cols  [displayname, reputation]
    Harlan | 457
```

</details>

---

### bird-0308 — codebase_community, moderate

**Question.** User No.23853 gave a comment to a post at 9:08:18 on 2013/7/12, was that post well-finished?

**Evidence given with it.** user no. 23853 refers to UserId = '23853'; at 9:08:18 on 2013/7/12 refers to CreationDate = '2013-07-12 09:08:18.0'; not well-finished refers to ClosedDate IS NULL and vice versa

**What we did.** Selected p.id plus the boolean expression p.closeddate IS NULL, returning '64117 | false' in 2 columns.

**What is expected.** Gold returns one column holding the literal string 'well-finished' from a CASE WHEN T2.ClosedDate IS NULL THEN 'NOT well-finished' ELSE 'well-finished' END.

**To fix it.** When the evidence maps a condition to a named verdict ('not well-finished refers to ClosedDate IS NULL'), emit that phrase as a CASE-produced string in a single column, not a raw boolean and not the joined post's id.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: comments, posts

**Reference SQL — this is what correct means.**

```sql
SELECT CASE WHEN T2.ClosedDate IS NULL THEN 'NOT well-finished' ELSE 'well-finished' END AS resylt FROM comments AS T1 INNER JOIN posts AS T2 ON T1.PostId = T2.Id WHERE T1.UserId = 23853 AND T1.CreationDate = '2013-07-12 09:08:18.0'
```

```
1 rows x 1 cols  [resylt]
    well-finished
```

**Our SQL — wrong.**

```sql
SELECT p.id, p.closeddate IS NULL AS well_finished FROM comments c JOIN posts p ON c.postid = p.id WHERE c.userid = 23853 AND c.creationdate = '2013-07-12 09:08:18'
```

```
1 rows x 2 cols  [id, well_finished]
    64117 | false
```

</details>

---

### bird-0326 — codebase_community, challenging

**Question.** Among posts by Harvey Motulsky and Noah Snyder, which one has higher popularity?

**Evidence given with it.** Has higher popularity means the post has higher view count ; calculation = MAX(SUM(ViewCount)) where DisplayName = 'Harvey Motulsky' OR DisplayName = 'Noah Snyder';

**What we did.** Selected u.displayname plus SUM(p.viewcount) AS total_viewcount, returning 'Harvey Motulsky | 23065' in 2 columns.

**What is expected.** Gold returns DisplayName only, keeping SUM(T3.ViewCount) in the ORDER BY; the winner is the same, so only the extra column differs.

**To fix it.** Never promote the ranking expression into the SELECT list — for an 'which one has higher X' question, order by SUM(ViewCount) DESC LIMIT 1 and return the name column alone.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: posts, users

**Reference SQL — this is what correct means.**

```sql
SELECT T1.DisplayName FROM users AS T1 INNER JOIN postHistory AS T2 ON T1.Id = T2.UserId INNER JOIN posts AS T3 ON T2.PostId = T3.Id WHERE T1.DisplayName = 'Harvey Motulsky' OR T1.DisplayName = 'Noah Snyder' GROUP BY T1.DisplayName ORDER BY SUM(T3.ViewCount) DESC NULLS LAST LIMIT 1
```

```
1 rows x 1 cols  [displayname]
    Harvey Motulsky
```

**Our SQL — wrong.**

```sql
SELECT u.displayname, SUM(p.viewcount) AS total_viewcount FROM posts p JOIN users u ON p.owneruserid = u.id WHERE u.displayname IN ('Harvey Motulsky', 'Noah Snyder') GROUP BY u.displayname ORDER BY total_viewcount DESC LIMIT 1
```

```
1 rows x 2 cols  [displayname, total_viewcount]
    Harvey Motulsky | 23065
```

</details>

---

### bird-0362 — card_games, moderate

**Question.** Among the Artifact cards, which are black color and comes with foreign languague translation?

**Evidence given with it.** Artifact card refers to originalType = 'Artifact'; black color refers to colors = 'B'; foreign language refers to language in foreign_data

**What we did.** Selected `DISTINCT c.name, f.language`, returning 69 rows across two columns because each card repeats once per translation language.

**What is expected.** Gold returns `DISTINCT T1.name` only — 8 single-column rows such as Bloodsoaked Altar and Immortal Coil.

**To fix it.** Treat a table mentioned only as an existence condition (foreign_data for "comes with foreign language translation") as a join filter, and do not project its column into the output.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: cards, foreign_data

**Reference SQL — this is what correct means.**

```sql
SELECT DISTINCT T1.name FROM cards AS T1 INNER JOIN foreign_data AS T2 ON T1.uuid = T2.uuid WHERE T1.originalType = 'Artifact' AND T1.colors = 'B'
```

```
8 rows x 1 cols  [name]
    Bloodsoaked Altar
    Executioner's Capsule
    Immortal Coil
    Netherborn Altar
    ... 4 more rows
```

**Our SQL — wrong.**

```sql
SELECT DISTINCT c."name", f."language" FROM "cards" c JOIN "foreign_data" f ON c."uuid" = f."uuid" WHERE c."originaltype" = 'Artifact' AND c."colors" = 'B'
```

```
69 rows x 2 cols  [name, language]
    Bloodsoaked Altar | Chinese Simplified
    Bloodsoaked Altar | Chinese Traditional
    Bloodsoaked Altar | French
    Bloodsoaked Altar | German
    ... 65 more rows
```

**A query that did match, from the `rows-v3` run.**

```sql
SELECT DISTINCT c."name" FROM "cards" c JOIN "foreign_data" f ON c."uuid" = f."uuid" WHERE c."originaltype" = 'Artifact' AND c."colors" = 'B'
```

```
8 rows x 1 cols  [name]
    Bloodsoaked Altar
    Executioner's Capsule
    Immortal Coil
    Netherborn Altar
    ... 4 more rows
```

</details>

---

### bird-0389 — card_games, moderate

**Question.** Please list the Italian text ruling of all the cards in the set Coldsnap.

**Evidence given with it.** card set Coldsnap refers to name = 'Coldsnap'; Italian refers to language = 'Italian'

**What we did.** Returned two columns, cards.name and foreign_data.text, for Italian rows of Coldsnap cards.

**What is expected.** Gold returns the single text column (DISTINCT foreign_data.text), so the extra name column alone makes the rows unequal.

**To fix it.** Project only the column the question names ('list the Italian text ruling') and never add an identifier column for readability.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: foreign_data, cards, sets

**Reference SQL — this is what correct means.**

```sql
SELECT DISTINCT T1.text FROM foreign_data AS T1 INNER JOIN cards AS T2 ON T2.uuid = T1.uuid INNER JOIN sets AS T3 ON T3.code = T2.setCode WHERE T3.name = 'Coldsnap' AND T1.language = 'Italian'
```

```
149 rows x 1 cols  [text]
    
    {1}, Rivela X carte bianche dalla tua ma
    {1}, Rivela X carte nere dalla tua mano,
    {1}, Rivela X carte verdi dalla tua mano
    ... 145 more rows
```

**Our SQL — wrong.**

```sql
SELECT c.name, f.text FROM cards c JOIN sets s ON c.setcode = s.code JOIN foreign_data f ON f.uuid = c.uuid WHERE s.name = 'Coldsnap' AND f.language = 'Italian'
```

```
155 rows x 2 cols  [name, text]
    Kjeldoran Javelineer | Mantenimento cumulativo {1} (All'inizio 
    Kjeldoran Outrider | {W}: Il Battipista di Kjeldor prende +0/
    Kjeldoran War Cry | Le creature che controlli prendono +X/+X
    Luminesce | Previeni tutto il danno che le fonti ner
    ... 151 more rows
```

**A query that did match, from the `rows-v3` run.**

```sql
SELECT fd.text FROM cards c JOIN sets s ON c.setcode = s.code JOIN foreign_data fd ON fd.uuid = c.uuid WHERE s.name = 'Coldsnap' AND fd.language = 'Italian'
```

```
155 rows x 1 cols  [text]
    Volare
{S}: Il Grifone di Borealia guada
    Mantenimento cumulativo {S} ({S} può ess
    Ogniqualvolta ti viene inflitto danno, p
    Gli altri Soldati prendono +1/+1 e hanno
    ... 151 more rows
```

</details>

---

### bird-0424 — toxicology, moderate

**Question.** Is the molecule with the most double bonds carcinogenic?

**Evidence given with it.** double bond refers to bond_type = ' = '; label = '+' mean molecules are carcinogenic

**What we did.** Returned three columns — molecule_id, label and the '=' bond count — for the molecule with the most double bonds (TR430, '+', 26).

**What is expected.** Gold returns only molecule.label, a single column holding '+'.

**To fix it.** Keep the ranking expression in ORDER BY and the grouping key out of the SELECT list, projecting only the column the yes/no question asks about.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: molecule, bond

**Reference SQL — this is what correct means.**

```sql
SELECT T1.label FROM molecule AS T1 INNER JOIN (SELECT T.molecule_id, COUNT(T.bond_type) FROM bond AS T WHERE T.bond_type = '=' GROUP BY T.molecule_id ORDER BY COUNT(T.bond_type) DESC NULLS LAST LIMIT 1) AS T2 ON T1.molecule_id = T2.molecule_id
```

```
1 rows x 1 cols  [label]
    +
```

**Our SQL — wrong.**

```sql
SELECT m.molecule_id, m.label, COUNT(*) AS double_bond_count FROM molecule m JOIN bond b ON m.molecule_id = b.molecule_id WHERE b.bond_type = '=' GROUP BY m.molecule_id, m.label ORDER BY double_bond_count DESC LIMIT 1
```

```
1 rows x 3 cols  [molecule_id, label, double_bond_count]
    TR430 | + | 26
```

**A query that did match, from the `self` run.**

```sql
SELECT m.label FROM molecule m JOIN bond b ON m.molecule_id = b.molecule_id WHERE b.bond_type = '=' GROUP BY m.molecule_id, m.label ORDER BY COUNT(*) DESC LIMIT 1
```

```
1 rows x 1 cols  [label]
    +
```

</details>

---

### bird-0428 — toxicology, challenging

**Question.** What are the elements of the atoms of TR144_8_19?

**Evidence given with it.** TR144_8_19 is the bond id;

**What we did.** Returned atom_id together with element for atoms 'TR144_8' and 'TR144_19', two columns instead of one.

**What is expected.** Gold returns only atom.element for the atoms attached to bond 'TR144_8_19'.

**To fix it.** Project only the requested column, and resolve a bond's atoms by joining connected on bond_id rather than by splitting the bond id string into atom ids.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: atom, molecule

**Reference SQL — this is what correct means.**

```sql
SELECT T2.element FROM connected AS T1 INNER JOIN atom AS T2 ON T1.atom_id = T2.atom_id WHERE T1.bond_id = 'TR144_8_19'
```

```
2 rows x 1 cols  [element]
    h
    c
```

**Our SQL — wrong.**

```sql
SELECT atom_id, element FROM atom WHERE atom_id IN ('TR144_8', 'TR144_19')
```

```
2 rows x 2 cols  [atom_id, element]
    TR144_19 | h
    TR144_8 | c
```

**A query that did match, from the `probe` run.**

```sql
SELECT "element" FROM "atom" WHERE "atom_id" IN ('TR144_8', 'TR144_19')
```

```
2 rows x 1 cols  [element]
    h
    c
```

</details>

---

### bird-0441 — california_schools, simple

**Question.** Rank schools by their average score in Writing where the score is greater than 499, showing their charter numbers.

**Evidence given with it.** Valid charter number means the number is not null

**What we did.** Returned two columns, charternum and avgscrwrite, with the ordering expressed only as ORDER BY sat.avgscrwrite DESC.

**What is expected.** Gold returns three columns — CharterNum, AvgScrWrite, and a materialized RANK() OVER (ORDER BY AvgScrWrite DESC NULLS LAST) value (1, 2, 3, 4 ...).

**To fix it.** 'Rank X by Y' asks for a RANK() window column in the output, not just a sort order — emit the rank number as a column.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: satscores, schools

**Reference SQL — this is what correct means.**

```sql
SELECT CharterNum, AvgScrWrite, RANK() OVER (ORDER BY AvgScrWrite DESC NULLS LAST) AS WritingScoreRank FROM schools AS T1 INNER JOIN satscores AS T2 ON T1.CDSCode = T2.cds WHERE T2.AvgScrWrite > 499 AND NOT CharterNum IS NULL
```

```
58 rows x 3 cols  [charternum, avgscrwrite, writingscorerank]
    0210 | 630 | 1
    0890 | 593 | 2
    0290 | 582 | 3
    0352 | 581 | 4
    ... 54 more rows
```

**Our SQL — wrong.**

```sql
SELECT s.charternum, sat.avgscrwrite FROM satscores sat JOIN schools s ON sat.cds = s.cdscode WHERE sat.avgscrwrite > 499 AND s.charternum IS NOT NULL ORDER BY sat.avgscrwrite DESC
```

```
58 rows x 2 cols  [charternum, avgscrwrite]
    0210 | 630
    0890 | 593
    0290 | 582
    0352 | 581
    ... 54 more rows
```

**A query that did match, from the `self` run.**

```sql
SELECT s."charternum", sc."avgscrwrite", RANK() OVER (ORDER BY sc."avgscrwrite" DESC) AS rank FROM "satscores" sc JOIN "schools" s ON sc."cds" = s."cdscode" WHERE sc."avgscrwrite" > 499 AND s."charternum" IS NOT NULL
```

```
58 rows x 3 cols  [charternum, avgscrwrite, rank]
    0210 | 630 | 1
    0890 | 593 | 2
    0290 | 582 | 3
    0352 | 581 | 4
    ... 54 more rows
```

</details>

---

### bird-0448 — california_schools, moderate

**Question.** What is the eligible free rate of the 10th and 11th schools with the highest enrolment for students in grades 1 through 12?

**Evidence given with it.** K-12 refers to students in grades 1 through 12; Eligible free rate for K-12 = `Free Meal Count (K-12)` / `Enrollment (K-12)`

**What we did.** Returned `School Name` next to the computed rate — two columns — while the rates themselves (0.1344364 and 0.29058945) matched gold exactly.

**What is expected.** Gold returns the single rate column `Free Meal Count (K-12)` / `Enrollment (K-12)` and nothing else.

**To fix it.** Project only the quantity the question asks for ('what is the eligible free rate'); do not add an identifying name column that was never requested.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: frpm

**Reference SQL — this is what correct means.**

```sql
SELECT CAST("Free Meal Count (K-12)" AS REAL) / NULLIF("Enrollment (K-12)", 0) FROM frpm ORDER BY "Enrollment (K-12)" DESC NULLS LAST LIMIT 2 OFFSET 9
```

```
2 rows x 1 cols  [?column?]
    0.1344364
    0.29058945
```

**Our SQL — wrong.**

```sql
SELECT "School Name", "Free Meal Count (K-12)" / "Enrollment (K-12)" AS eligible_free_rate FROM frpm ORDER BY "Enrollment (K-12)" DESC LIMIT 2 OFFSET 9
```

```
2 rows x 2 cols  [School Name, eligible_free_rate]
    El Camino Real Charter High | 0.1344364
    Eleanor Roosevelt High | 0.29058945
```

</details>

---

### bird-0458 — california_schools, moderate

**Question.** What is the ratio of merged Unified School District schools in Orange County to merged Elementary School District schools?

**Evidence given with it.** Elementary School District refers to DOC = 52; Unified School District refers to DOC = 54.

**What we did.** Returned three columns — unified_merged (4), elementary_merged (7), and the ratio — even though the ratio value 0.5714285714285714 matched gold.

**What is expected.** Gold returns one column, the division SUM(doc = 54) / SUM(doc = 52) alone.

**To fix it.** When the question asks for a ratio, emit only the division expression; keep the numerator and denominator counts inline rather than exposing them as extra columns.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: schools

**Reference SQL — this is what correct means.**

```sql
SELECT CAST(SUM(CASE WHEN DOC::integer = 54 THEN 1 ELSE 0 END) AS REAL) / NULLIF(SUM(CASE WHEN DOC::integer = 52 THEN 1 ELSE 0 END), 0) FROM schools WHERE StatusType = 'Merged' AND County = 'Orange'
```

```
1 rows x 1 cols  [?column?]
    0.5714285714285714
```

**Our SQL — wrong.**

```sql
SELECT COUNT(*) FILTER (WHERE "doc" = '54') AS unified_merged, COUNT(*) FILTER (WHERE "doc" = '52') AS elementary_merged, CAST(COUNT(*) FILTER (WHERE "doc" = '54') AS FLOAT) / NULLIF(COUNT(*) FILTER (WHERE "doc" = '52'), 0) AS ratio FROM "schools" WHERE "county" = 'Orange' AND "statustype" = 'Merged'
```

```
1 rows x 3 cols  [unified_merged, elementary_merged, ratio]
    4 | 7 | 0.5714285714285714
```

**A query that did match, from the `rows-v3` run.**

```sql
SELECT CAST(SUM(CASE WHEN doc='54' THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(SUM(CASE WHEN doc='52' THEN 1 ELSE 0 END),0) AS ratio FROM schools WHERE county='Orange' AND statustype='Merged'
```

```
1 rows x 1 cols  [ratio]
    0.5714285714285714
```

</details>

---

### bird-0459 — california_schools, simple

**Question.** What is the postal street address for the school with the 7th highest Math average? Indicate the school's name.

**Evidence given with it.** Postal street and mailing street are synonyms.

**What we did.** Selected (s.school, s.street), so the single row came back as (null, '25 Churchill Avenue').

**What is expected.** Gold selects (MailStreet, School) — address first, name second — so the row is ('25 Churchill Avenue', null).

**To fix it.** Emit columns in the order the question names them — the postal street is the primary ask and the school name is the follow-on ('Indicate the school's name') — because column position is compared while column names are not.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: schools, satscores

**Reference SQL — this is what correct means.**

```sql
SELECT T2.MailStreet, T2.School FROM satscores AS T1 INNER JOIN schools AS T2 ON T1.cds = T2.CDSCode ORDER BY T1.AvgScrMath DESC NULLS LAST LIMIT 1 OFFSET 6
```

```
1 rows x 2 cols  [mailstreet, school]
    25 Churchill Avenue | null
```

**Our SQL — wrong.**

```sql
SELECT s.school, s.street FROM schools s JOIN satscores sat ON s.cdscode = sat.cds WHERE sat.avgscrmath IS NOT NULL ORDER BY sat.avgscrmath DESC LIMIT 1 OFFSET 6
```

```
1 rows x 2 cols  [school, street]
    null | 25 Churchill Avenue
```

**A query that did match, from the `rows-v3` run.**

```sql
SELECT s.street, s.school FROM schools s JOIN satscores t ON s.cdscode = t.cds WHERE t.avgscrmath IS NOT NULL ORDER BY t.avgscrmath DESC LIMIT 1 OFFSET 6
```

```
1 rows x 2 cols  [street, school]
    25 Churchill Avenue | null
```

</details>

---

### bird-0474 — financial, moderate

**Question.** Among the accounts who have loan validity more than 12 months, list out the accounts that have the highest approved amount and have account opening date in 1993.

**Evidence given with it.** Loan validity more than 12 months refers to duration > 12

**What we did.** Selected both l.account_id and l.amount, returning two columns (10451 | 482940) instead of one.

**What is expected.** Gold selects only T1.account_id and returns the single column 10451.

**To fix it.** Keep the ORDER BY column (loan.amount) out of the SELECT list — return only the field the question asks to list.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: loan, account

**Reference SQL — this is what correct means.**

```sql
SELECT T1.account_id FROM loan AS T1 INNER JOIN account AS T2 ON T1.account_id = T2.account_id WHERE TO_CHAR(CAST(T2.date AS TIMESTAMP), 'YYYY') = '1993' AND T1.duration > 12 ORDER BY T1.amount DESC NULLS LAST LIMIT 1
```

```
1 rows x 1 cols  [account_id]
    10451
```

**Our SQL — wrong.**

```sql
SELECT l.account_id, l.amount FROM loan l JOIN account a ON l.account_id = a.account_id WHERE l.duration > 12 AND EXTRACT(YEAR FROM a.date) = 1993 ORDER BY l.amount DESC LIMIT 1
```

```
1 rows x 2 cols  [account_id, amount]
    10451 | 482940
```

**A query that did match, from the `control` run.**

```sql
SELECT a.account_id FROM account a JOIN loan l ON a.account_id = l.account_id WHERE l.duration > 12 AND EXTRACT(YEAR FROM a.date) = 1993 ORDER BY l.amount DESC LIMIT 1
```

```
1 rows x 1 cols  [account_id]
    10451
```

</details>


## Read the wrong table or column (19)

A correct source existed and was available in the prompt. The query went somewhere else — most often when a word in the question ("fundraising", "cost") names a value in one table and a column in another.

### bird-0014 — debit_card_specializing, simple

**Question.** Please list the product description of the products consumed in September, 2013.

**Evidence given with it.** September 2013 refers to 201309; The first 4 strings of the Date values in the yearmonth table can represent year; The 5th and 6th string of the date can refer to month.

**What we did.** Filtered transactions_1k's own date column with to_char(t.date,'YYYYMM') = '201309' and got 0 rows, because transactions_1k only holds August 2012 transactions.

**What is expected.** Gold joins yearmonth on CustomerID and filters yearmonth.Date = '201309', returning products.Description for every transaction of the customers active in that month.

**To fix it.** When the evidence says the date value lives in the yearmonth table, apply the month filter to yearmonth.Date through the CustomerID join instead of the transaction table's own date.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: transactions_1k, products

**Reference SQL — this is what correct means.**

```sql
SELECT T3.Description FROM transactions_1k AS T1 INNER JOIN yearmonth AS T2 ON T1.CustomerID = T2.CustomerID INNER JOIN products AS T3 ON T1.ProductID = T3.ProductID WHERE T2.Date = '201309'
```

```
976 rows x 1 cols  [description]
    Diesel
    Nat.Super
    Diesel
    Diesel
    ... 972 more rows
```

**Our SQL — wrong.**

```sql
SELECT DISTINCT p.description FROM transactions_1k t JOIN products p ON t.productid = p.productid WHERE TO_CHAR(t.date, 'YYYYMM') = '201309'
```

```
0 rows x 1 cols  [description]

```

**A query that did match, from the `probe` run.**

```sql
SELECT DISTINCT p."description" FROM "transactions_1k" t JOIN "products" p ON t."productid" = p."productid" WHERE to_char(t."date", 'YYYYMM') = '201208'
```

```
27 rows x 1 cols  [description]
    Additivum
    Autokosmet.
    Autokozmetik
    Autoprísluš.
    ... 23 more rows
```

</details>

---

### bird-0023 — debit_card_specializing, simple

**Question.** What's the nationality of the customer who spent 548.4 in 2012/8/24?

**Evidence given with it.** '2012/8/24' can be represented by '2012-08-24'; spent 548.4 refers to price = '548.4'

**What we did.** Joined transactions_1k to customers and selected c.currency, and the bare t.price = 548.4 equality on the float column matched nothing, so it returned 0 rows.

**What is expected.** Gold joins gasstations on GasStationID and returns gasstations.Country ('CZE'), comparing Price against the quoted literal '548.4' so it is cast to the column's own float type.

**To fix it.** Map 'nationality' to gasstations.Country via GasStationID rather than customers.Currency, and match a float price with ROUND(price::numeric,1) or a quoted literal instead of raw = 548.4.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: transactions_1k, customers

**Reference SQL — this is what correct means.**

```sql
SELECT T2.Country FROM transactions_1k AS T1 INNER JOIN gasstations AS T2 ON T1.GasStationID = T2.GasStationID WHERE T1.Date = '2012-08-24' AND T1.Price = '548.4'
```

```
1 rows x 1 cols  [country]
    CZE
```

**Our SQL — wrong.**

```sql
SELECT c."currency" FROM "transactions_1k" t JOIN "customers" c ON t."customerid" = c."customerid" WHERE t."price" = 548.4 AND t."date" = '2012-08-24'
```

```
0 rows x 1 cols  [currency]

```

**A query that did match, from the `stack` run.**

```sql
SELECT DISTINCT g.country FROM transactions_1k t JOIN gasstations g ON t.gasstationid = g.gasstationid WHERE t.date = '2012-08-24' AND ROUND(t.price::numeric,1) = 548.4
```

```
1 rows x 1 cols  [country]
    CZE
```

</details>

---

### bird-0039 — student_club, simple

**Question.** What was the notes of the fundraising on 2019/9/14?

**Evidence given with it.** fundraising on 2019/9/14 refers to source = 'Fundraising' where date_received = '2019-09-14'

**What we did.** Queried event.notes with event.type = 'Fundraising' and event_date LIKE '2019-09-14%', which matched 0 rows.

**What is expected.** Gold reads income.notes where income.source = 'Fundraising' and income.date_received = '2019-09-14', returning 'Secured donations to help pay for speake'.

**To fix it.** Let the evidence's column names pick the table — 'source' and 'date_received' exist on income, not on event — instead of mapping the word 'fundraising' to event.type.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: event

**Reference SQL — this is what correct means.**

```sql
SELECT notes FROM income WHERE source = 'Fundraising' AND date_received = '2019-09-14'
```

```
1 rows x 1 cols  [notes]
    Secured donations to help pay for speake
```

**Our SQL — wrong.**

```sql
SELECT notes FROM "event" WHERE "type" = 'Fundraising' AND "event_date" LIKE '2019-09-14%'
```

```
0 rows x 1 cols  [notes]

```

**A query that did match, from the `expand` run.**

```sql
SELECT "notes" FROM "income" WHERE "source" = 'Fundraising' AND "date_received" = '2019-09-14'
```

```
1 rows x 1 cols  [notes]
    Secured donations to help pay for speake
```

</details>

---

### bird-0041 — student_club, moderate

**Question.** What is the status of the event which bought "Post Cards, Posters" on 2019/8/20?

**Evidence given with it.** 'Post Cards, Posters' is an expense description; on 2019/8/20 refers to expense_date = '2019-8-20'; status of event refers to event_status

**What we did.** Selected event.status where event.notes ILIKE '%Post Cards, Posters%', returning 0 rows because that string lives in expense.expense_description.

**What is expected.** Gold filters expense.expense_description = 'Post Cards, Posters' and expense_date = '2019-08-20', joins budget on budget.budget_id = expense.link_to_budget, and returns budget.event_status ('Closed').

**To fix it.** When the evidence names the column a value belongs to (expense_description), filter that column and read event_status off budget via link_to_budget rather than text-searching event.notes.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: event, expense

**Reference SQL — this is what correct means.**

```sql
SELECT T1.event_status FROM budget AS T1 INNER JOIN expense AS T2 ON T1.budget_id = T2.link_to_budget WHERE T2.expense_description = 'Post Cards, Posters' AND T2.expense_date = '2019-08-20'
```

```
1 rows x 1 cols  [event_status]
    Closed
```

**Our SQL — wrong.**

```sql
SELECT "status" FROM "event" WHERE "notes" ILIKE '%Post Cards, Posters%'
```

```
0 rows x 1 cols  [status]

```

</details>

---

### bird-0058 — student_club, moderate

**Question.** Based on the total cost for all event, what is the percentage of cost for Yearly Kickoff event?

**Evidence given with it.** percentage = DIVIDE(SUM(cost where event_name = 'Yearly Kickoff'), SUM(cost)) * 100

**What we did.** Summed budget.amount over a budget-to-event join and reported 11.9047619047619048 percent for 'Yearly Kickoff'.

**What is expected.** Gold sums expense.cost across event -> budget -> expense (expense.link_to_budget = budget.budget_id) and gets 21.530166915170767.

**To fix it.** Map the word 'cost' to expense.cost rather than budget.amount — they are different money columns, and reaching expense requires the extra hop through budget.budget_id.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: budget, event

**Reference SQL — this is what correct means.**

```sql
SELECT CAST(SUM(CASE WHEN T1.event_name = 'Yearly Kickoff' THEN T3.cost ELSE 0 END) AS REAL) * 100 / NULLIF(SUM(T3.cost), 0) FROM event AS T1 INNER JOIN budget AS T2 ON T1.event_id = T2.link_to_event INNER JOIN expense AS T3 ON T2.budget_id = T3.link_to_budget
```

```
1 rows x 1 cols  [?column?]
    21.530166915170767
```

**Our SQL — wrong.**

```sql
SELECT SUM(CASE WHEN e.event_name = 'Yearly Kickoff' THEN b.amount ELSE 0 END) * 100.0 / SUM(b.amount) AS percentage FROM "budget" b JOIN "event" e ON b."link_to_event" = e."event_id"
```

```
1 rows x 1 cols  [percentage]
    11.9047619047619048
```

**A query that did match, from the `desc-picker` run.**

```sql
SELECT 100.0 * SUM(CASE WHEN e.event_name = 'Yearly Kickoff' THEN ex.cost ELSE 0 END) / SUM(ex.cost) AS percentage FROM "expense" ex JOIN "budget" b ON ex.link_to_budget = b.budget_id JOIN "event" e ON b.link_to_event = e.event_id
```

```
1 rows x 1 cols  [percentage]
    21.530166915170767
```

</details>

---

### bird-0087 — thrombosis_prediction, simple

**Question.** What are the symptoms observed by the youngest patient to ever did a medical examination? Identify their diagnosis.

**Evidence given with it.** The larger the birthday value, the younger the person is, and vice versa; symptoms observed refers to the symptoms is not NULL

**What we did.** Selected examination.diagnosis alongside examination.symptoms, returning 'CNS susp | SLE+Psy'.

**What is expected.** Gold selects Patient.Diagnosis, which is 'SLE' for the youngest patient, paired with examination.symptoms 'CNS susp'.

**To fix it.** When the same column name exists on both joined tables (patient.diagnosis and examination.diagnosis), resolve it against the question's subject — 'identify their diagnosis' refers to the patient, so qualify it with the patient table.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: patient, examination

**Reference SQL — this is what correct means.**

```sql
SELECT T2.Symptoms, T1.Diagnosis FROM Patient AS T1 INNER JOIN Examination AS T2 ON T1.ID = T2.ID WHERE NOT T2.Symptoms IS NULL ORDER BY T1.Birthday DESC NULLS LAST LIMIT 1
```

```
1 rows x 2 cols  [symptoms, diagnosis]
    CNS susp | SLE
```

**Our SQL — wrong.**

```sql
SELECT e."symptoms", e."diagnosis" FROM examination e JOIN patient p ON e.id = p.id WHERE e.symptoms IS NOT NULL ORDER BY p.birthday DESC LIMIT 1
```

```
1 rows x 2 cols  [symptoms, diagnosis]
    CNS susp | SLE+Psy
```

**A query that did match, from the `self` run.**

```sql
SELECT e.symptoms, p.diagnosis FROM patient p JOIN examination e ON p.id = e.id WHERE e.symptoms IS NOT NULL ORDER BY p.birthday DESC LIMIT 1
```

```
1 rows x 2 cols  [symptoms, diagnosis]
    CNS susp | SLE
```

</details>

---

### bird-0127 — thrombosis_prediction, challenging

**Question.** For the patients with a normal range of creatinine phosphokinase, how many of them have a positive measure of degree of coagulation?

**Evidence given with it.** normal range of creatinine phosphokinase refers to CPK < 250; positive measure of degree of coagulation refers to KCT = '+' or RVVT = '+' or LAC = '+' ;

**What we did.** Queried laboratory alone (SELECT COUNT(DISTINCT id) FROM laboratory WHERE cpk < 250), silently omitting the coagulation condition, and counted 267 patients.

**What is expected.** Gold joins Patient to Laboratory and to Examination and adds (T3.KCT = '+' OR T3.RVVT = '+' OR T3.LAC = '+') alongside CPK < 250, giving 7; KCT, RVVT and LAC live on examination, which our picker never selected (ourTables was laboratory and patient only).

**To fix it.** Table selection must pull in every table owning a column named in the question or evidence, and the SQL step should fail loudly when a required column is absent from the offered schema instead of dropping the filter.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: laboratory, patient

**Reference SQL — this is what correct means.**

```sql
SELECT COUNT(T1.ID) FROM Patient AS T1 INNER JOIN Laboratory AS T2 ON T1.ID = T2.ID INNER JOIN Examination AS T3 ON T1.ID = T3.ID WHERE T2.CPK < 250 AND (T3.KCT = '+' OR T3.RVVT = '+' OR T3.LAC = '+')
```

```
1 rows x 1 cols  [count]
    7
```

**Our SQL — wrong.**

```sql
SELECT COUNT(DISTINCT id) FROM laboratory WHERE cpk < 250
```

```
1 rows x 1 cols  [count]
    267
```

</details>

---

### bird-0206 — formula_1, moderate

**Question.** State the race and year of race in which Michael Schumacher had his fastest lap.

**Evidence given with it.** fastest lap refers to min(milliseconds); Alex Yoong refers to the full name of the driver; Full name of the driver refers to drivers.forename and drivers.surname;

**What we did.** Ordered results.milliseconds — the driver's total race duration — for Michael Schumacher and returned 'Belgian Grand Prix', 2001.

**What is expected.** Gold joins laptimes and orders laptimes.milliseconds, the per-lap time, returning 'Austrian Grand Prix', 2003.

**To fix it.** Map 'fastest lap' to laptimes.milliseconds, not results.milliseconds — both tables carry a milliseconds column but only laptimes measures a single lap.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: results, drivers, races

**Reference SQL — this is what correct means.**

```sql
SELECT T1.name, T1.year FROM races AS T1 INNER JOIN lapTimes AS T2 ON T2.raceId = T1.raceId INNER JOIN drivers AS T3 ON T3.driverId = T2.driverId WHERE T3.forename = 'Michael' AND T3.surname = 'Schumacher' ORDER BY T2.milliseconds ASC NULLS FIRST LIMIT 1
```

```
1 rows x 2 cols  [name, year]
    Austrian Grand Prix | 2003
```

**Our SQL — wrong.**

```sql
SELECT r."name", r."year" FROM results res JOIN drivers d ON res."driverid" = d."driverid" JOIN races r ON res."raceid" = r."raceid" WHERE d."forename" = 'Michael' AND d."surname" = 'Schumacher' AND res."milliseconds" IS NOT NULL ORDER BY res."milliseconds" ASC LIMIT 1
```

```
1 rows x 2 cols  [name, year]
    Belgian Grand Prix | 2001
```

</details>

---

### bird-0227 — formula_1, challenging

**Question.** From 2000 to 2005, what percentage of drivers who were born before 1985 and the lap numbers were over 50?

**Evidence given with it.** born before 1985 refers to year(dob)<1985; in 2000 to 2005 refers to year between 2000 and 2005; percentage = Divide(COUNT(driverId where year (dob) <1985 and laps >50),COUNT(DriverID where year between 2000 and 2005) *100;

**What we did.** Read the laptimes table and filtered laptimes.lap > 50 (the lap number of one lap row), counting COUNT(DISTINCT driverid) in both numerator and denominator, which returns 100.

**What is expected.** Gold reads results.laps > 50 (laps completed in a result row) joined to races and drivers, and divides by COUNT(*) over the 2039 results rows for years 2000-2005, returning 64.884747.

**To fix it.** Map 'the lap numbers were over 50' to results.laps rather than laptimes.lap, and use the raw result-row count as the denominator instead of distinct drivers.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: drivers, laptimes, races

**Reference SQL — this is what correct means.**

```sql
SELECT CAST(SUM(CASE WHEN TO_CHAR(CAST(T3.dob AS TIMESTAMP), 'YYYY') < '1985' AND T1.laps > 50 THEN 1 ELSE 0 END) AS REAL) * 100 / NULLIF(COUNT(*), 0) FROM results AS T1 INNER JOIN races AS T2 ON T1.raceId = T2.raceId INNER JOIN drivers AS T3 ON T1.driverId = T3.driverId WHERE T2.year BETWEEN 2000 AND 2005
```

```
1 rows x 1 cols  [?column?]
    64.88474742520843
```

**Our SQL — wrong.**

```sql
SELECT (COUNT(DISTINCT CASE WHEN EXTRACT(YEAR FROM d.dob) < 1985 AND l.lap > 50 THEN l.driverid END)::float / NULLIF(COUNT(DISTINCT l.driverid),0)) * 100 AS percentage FROM laptimes l JOIN races r ON l.raceid = r.raceid JOIN drivers d ON l.driverid = d.driverid WHERE r.year BETWEEN 2000 AND 2005
```

```
1 rows x 1 cols  [percentage]
    100
```

</details>

---

### bird-0314 — codebase_community, simple

**Question.** Name the user that commented 'thank you user93!'

**Evidence given with it.** "thank you user93" is the Text of comment; user refers to DisplayName

**What we did.** Read comments.userdisplayname directly and got a single null row, because that denormalized column is empty for this comment.

**What is expected.** Gold joins users to comments on users.Id = comments.UserId and reads users.DisplayName, returning 'Preets'.

**To fix it.** Resolve a person's name through the entity table via the foreign key (comments.userid -> users.id) rather than a same-table snapshot column like comments.userdisplayname, which is null for most rows.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: comments

**Reference SQL — this is what correct means.**

```sql
SELECT T1.DisplayName FROM users AS T1 INNER JOIN comments AS T2 ON T1.Id = T2.UserId WHERE T2.Text = 'thank you user93!'
```

```
1 rows x 1 cols  [displayname]
    Preets
```

**Our SQL — wrong.**

```sql
SELECT userdisplayname FROM comments WHERE text = 'thank you user93!'
```

```
1 rows x 1 cols  [userdisplayname]
    null
```

**A query that did match, from the `rows-v3` run.**

```sql
SELECT u."displayname" FROM "comments" c JOIN "users" u ON c."userid" = u."id" WHERE c."text" = 'thank you user93!'
```

```
1 rows x 1 cols  [displayname]
    Preets
```

</details>

---

### bird-0336 — codebase_community, moderate

**Question.** What is the percentage of posts whose owners had a reputation of over 1000 in 2011?

**Evidence given with it.** percentage = DIVIDE(COUNT(Id where YEAR(CreationDate) = 2011 and Reputation > 1000), COUNT(Id) ) * 100;

**What we did.** Took the year from `users.creationdate` (`EXTRACT(YEAR FROM u.creationdate) = 2011`), scoring 11.324 percent — the year the user account was created, not the post.

**What is expected.** Gold reads the post's own date, `posts."creaiondate"` (misspelled in the schema), giving 7.242 percent.

**To fix it.** When both joined tables carry a date column, bind the year filter to the entity the question counts (posts), and match the schema's literal spelling including the `creaiondate` typo.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: posts, users

**Reference SQL — this is what correct means.**

```sql
SELECT CAST(SUM(CASE WHEN TO_CHAR(CAST(T2.CreaionDate AS TIMESTAMP), 'YYYY') = '2011' AND T1.Reputation > 1000 THEN 1 ELSE 0 END) AS REAL) * 100 / NULLIF(COUNT(T1.Id), 0) FROM users AS T1 INNER JOIN posts AS T2 ON T1.Id = T2.OwnerUserId
```

```
1 rows x 1 cols  [?column?]
    7.24159250999183
```

**Our SQL — wrong.**

```sql
SELECT (COUNT(CASE WHEN EXTRACT(YEAR FROM u.creationdate) = 2011 AND u.reputation > 1000 THEN p.id END)::numeric / COUNT(p.id)) * 100 AS percentage FROM "posts" p JOIN "users" u ON p.owneruserid = u.id
```

```
1 rows x 1 cols  [percentage]
    11.32444189281692317900
```

**A query that did match, from the `vote5` run.**

```sql
SELECT (COUNT(*) FILTER (WHERE EXTRACT(YEAR FROM p.creaiondate) = 2011 AND u.reputation > 1000))::numeric / COUNT(*) * 100 AS percentage FROM "posts" p JOIN "users" u ON p.owneruserid = u.id
```

```
1 rows x 1 cols  [percentage]
    7.24159250999182988500
```

</details>

---

### bird-0356 — card_games, simple

**Question.** What is the rule of playing card "Benalish Knight"?

**Evidence given with it.** Benalish Knight' is the name of card; rule of playing card refers to format;

**What we did.** Selected `cards.availability` for Benalish Knight, returning 4 rows of `mtgo,paper` / `paper`.

**What is expected.** Gold joins `legalities` on uuid and returns `legalities.format` — 32 rows such as commander, duel, legacy, modern.

**To fix it.** Resolve the evidence's word `format` to the actual column named `format` in `legalities` rather than picking a superficially similar column in the table already selected.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: cards, rulings

**Reference SQL — this is what correct means.**

```sql
SELECT T2.format FROM cards AS T1 INNER JOIN legalities AS T2 ON T1.uuid = T2.uuid WHERE T1.name = 'Benalish Knight'
```

```
32 rows x 1 cols  [format]
    commander
    duel
    legacy
    modern
    ... 28 more rows
```

**Our SQL — wrong.**

```sql
SELECT "availability" FROM "cards" WHERE "name" = 'Benalish Knight'
```

```
4 rows x 1 cols  [availability]
    mtgo,paper
    mtgo,paper
    paper
    mtgo,paper
```

**A query that did match, from the `expand` run.**

```sql
SELECT l.format FROM legalities l JOIN cards c ON l.uuid = c.uuid WHERE c.name = 'Benalish Knight'
```

```
32 rows x 1 cols  [format]
    commander
    duel
    legacy
    modern
    ... 28 more rows
```

</details>

---

### bird-0366 — card_games, moderate

**Question.** Lists all types of cards in German.

**Evidence given with it.** German refer to language; all types refer to the subtypes, supertypes; subtypes is not null AND supertypes is not null

**What we did.** Selected DISTINCT foreign_data.type for language = 'German', returning one column of localized type lines like 'Kreatur — Surrakar'.

**What is expected.** Gold returns two columns, cards.subtypes and cards.supertypes, for cards joined to foreign_data on uuid where language = 'German' and both columns are non-null.

**To fix it.** Map the evidence phrase 'all types refer to the subtypes, supertypes' onto cards.subtypes and cards.supertypes instead of grabbing the similarly named foreign_data.type from the table already in scope.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: foreign_data

**Reference SQL — this is what correct means.**

```sql
SELECT T1.subtypes, T1.supertypes FROM cards AS T1 INNER JOIN foreign_data AS T2 ON T1.uuid = T2.uuid WHERE T2.language = 'German' AND NOT T1.subtypes IS NULL AND NOT T1.supertypes IS NULL
```

```
1693 rows x 2 cols  [subtypes, supertypes]
    Human,Wizard | Legendary
    Aetherborn,Vampire | Legendary
    Human,Pirate | Legendary
    Elf,Druid | Legendary
    ... 1689 more rows
```

**Our SQL — wrong.**

```sql
SELECT DISTINCT "type" FROM "foreign_data" WHERE "language" = 'German' AND "type" IS NOT NULL
```

```
2150 rows x 1 cols  [type]
    Kreatur — Surrakar
    Beschwörung eines Elementar — wesens
    Kreatur — Troll, Kleriker
    Kreatur — Slith
    ... 2146 more rows
```

**A query that did match, from the `probe` run.**

```sql
SELECT DISTINCT c."subtypes", c."supertypes" FROM "cards" c JOIN "foreign_data" f ON c."uuid" = f."uuid" WHERE f."language" = 'German' AND c."subtypes" IS NOT NULL AND c."supertypes" IS NOT NULL
```

```
408 rows x 2 cols  [subtypes, supertypes]
    Aetherborn,Rogue | Legendary
    Aetherborn,Vampire | Legendary
    Ajani | Legendary
    Aminatou | Legendary
    ... 404 more rows
```

</details>

---

### bird-0367 — card_games, moderate

**Question.** How many unknown power cards contain info about the triggered ability

**Evidence given with it.** unknown power cards refers to power is null or power = '*';contain info about the triggered ability refers to text contains 'triggered ability'

**What we did.** Counted rows in cards where cards.text LIKE '%triggered ability%' and power is null or '*', returning 35.

**What is expected.** Gold matches rulings.text after joining cards to rulings on uuid and counts DISTINCT cards.id, returning 1382.

**To fix it.** When two tables both expose a text column, let 'contain info about' route the LIKE filter to rulings.text via the uuid join instead of defaulting to the text column on the main entity table.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: cards

**Reference SQL — this is what correct means.**

```sql
SELECT Count(DISTINCT T1.id) FROM cards AS T1 INNER JOIN rulings AS T2 ON T1.uuid = T2.uuid WHERE (T1.power IS NULL OR T1.power = '*') AND T2.text LIKE '%triggered ability%'
```

```
1 rows x 1 cols  [count]
    1382
```

**Our SQL — wrong.**

```sql
SELECT COUNT(*) FROM "cards" WHERE ("power" IS NULL OR "power" = '*') AND "text" LIKE '%triggered ability%'
```

```
1 rows x 1 cols  [count]
    35
```

</details>

---

### bird-0369 — card_games, moderate

**Question.** What is the foreign name of the card in French of type Creature, normal layout and black border color, by artist Matthew D. Wilson?

**Evidence given with it.** in French refers to language = 'French'; black border color refers to borderColor = 'black'

**What we did.** Filtered cards.type = 'Creature', a column that stores the full type line such as 'Creature — Human Soldier', so the query returned 0 rows.

**What is expected.** Gold filters cards.types = 'Creature', the plural column that stores the bare type list, and returns 50 French names.

**To fix it.** Disambiguate near-identical column names (type vs types) by inspecting sample values before writing an equality filter, and treat a 0-row result on an equality filter as a signal to try the sibling column.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: cards, foreign_data

**Reference SQL — this is what correct means.**

```sql
SELECT name FROM foreign_data WHERE uuid IN (SELECT uuid FROM cards WHERE types = 'Creature' AND layout = 'normal' AND borderColor = 'black' AND artist = 'Matthew D. Wilson') AND language = 'French'
```

```
50 rows x 1 cols  [name]
    Dragon mage
    Ange déchu
    Gardienne de l'esprit
    Dragon exalté
    ... 46 more rows
```

**Our SQL — wrong.**

```sql
SELECT fd.name FROM cards c JOIN foreign_data fd ON c.uuid = fd.uuid WHERE fd.language = 'French' AND c.type = 'Creature' AND c.layout = 'normal' AND c.bordercolor = 'black' AND c.artist = 'Matthew D. Wilson'
```

```
0 rows x 1 cols  [name]

```

**A query that did match, from the `rows-v3` run.**

```sql
SELECT fd.name FROM "cards" c JOIN "foreign_data" fd ON c."uuid" = fd."uuid" WHERE fd."language" = 'French' AND c."types" = 'Creature' AND c."layout" = 'normal' AND c."bordercolor" = 'black' AND c."artist" = 'Matthew D. Wilson'
```

```
50 rows x 1 cols  [name]
    Vampire de Mephidross
    Assassin de la Forteresse
    Dragon mage
    Maréchale aguerrie
    ... 46 more rows
```

</details>

---

### bird-0388 — card_games, moderate

**Question.** What is the Italian flavor text of the card "Ancestor's Chosen"?

**Evidence given with it.** Italian refers to language = 'Italian'; flavor text refers to flavorText; "Ancestor''s Chosen" refers to name = 'Ancestor''s Chosen'

**What we did.** Filtered foreign_data.name = 'Ancestor''s Chosen' with language = 'Italian' and got 0 rows, because foreign_data.name holds the translated Italian name.

**What is expected.** Gold joins foreign_data to cards on uuid and applies the name filter to cards.name, returning the two Italian flavortext rows.

**To fix it.** When both joined tables have a name column, apply an English-language literal to the source table (cards.name) rather than to the translation table's own name column.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: cards, foreign_data

**Reference SQL — this is what correct means.**

```sql
SELECT T2.flavorText FROM cards AS T1 INNER JOIN foreign_data AS T2 ON T2.uuid = T1.uuid WHERE T1.name = 'Ancestor''s Chosen' AND T2.language = 'Italian'
```

```
2 rows x 1 cols  [flavortext]
    Sancito da generazioni di forza.
    "La volontà di tutti, eseguita per mano 
```

**Our SQL — wrong.**

```sql
SELECT flavortext FROM foreign_data WHERE name = 'Ancestor''s Chosen' AND language = 'Italian'
```

```
0 rows x 1 cols  [flavortext]

```

**A query that did match, from the `rows-v3` run.**

```sql
SELECT fd."flavortext" FROM "foreign_data" fd JOIN "cards" c ON fd."uuid" = c."uuid" WHERE c."name" = 'Ancestor''s Chosen' AND fd."language" = 'Italian'
```

```
2 rows x 1 cols  [flavortext]
    Sancito da generazioni di forza.
    "La volontà di tutti, eseguita per mano 
```

</details>

---

### bird-0447 — california_schools, challenging

**Question.** Consider the average difference between K-12 enrollment and 15-17 enrollment of schools that are locally funded, list the names and DOC type of schools which has a difference above this average.

**Evidence given with it.** Difference between K-12 enrollment and 15-17 enrollment can be computed by `Enrollment (K-12)` - `Enrollment (Ages 5-17)`

**What we did.** Selected schools.doctype, returning descriptive labels like 'County Office of Education (COE)' and 'Unified School District' for the 57 correct schools.

**What is expected.** Gold selects schools.DOC, the two-character code column ('00', '54').

**To fix it.** When the question and evidence name a column by its literal name (DOC), select that column, not the adjacent human-readable label column (doctype) that expands the same code.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: frpm, schools

**Reference SQL — this is what correct means.**

```sql
SELECT T2.School, T2.DOC FROM frpm AS T1 INNER JOIN schools AS T2 ON T1.CDSCode = T2.CDSCode WHERE T2.FundingType = 'Locally funded' AND (T1."Enrollment (K-12)" - T1."Enrollment (Ages 5-17)") > (SELECT AVG(T3."Enrollment (K-12)" - T3."Enrollment (Ages 5-17)") FROM frpm AS T3 INNER JOIN schools AS T4 ON T3.CDSCode = T4.CDSCode WHERE T4.FundingType = 'Locally funded')
```

```
57 rows x 2 cols  [school, doc]
    Mountain Oaks | 00
    Castle Rock | 00
    Charter Community School Home Study Acad | 00
    Clovis Online Charter | 54
    ... 53 more rows
```

**Our SQL — wrong.**

```sql
SELECT s.school, s.doctype FROM schools s JOIN frpm f ON s.cdscode = f.cdscode WHERE s.fundingtype = 'Locally funded' AND (f."Enrollment (K-12)" - f."Enrollment (Ages 5-17)") > (SELECT AVG(f2."Enrollment (K-12)" - f2."Enrollment (Ages 5-17)") FROM frpm f2 JOIN schools s2 ON f2.cdscode = s2.cdscode WHERE s2.fundingtype = 'Locally funded')
```

```
57 rows x 2 cols  [school, doctype]
    Mountain Oaks | County Office of Education (COE)
    Castle Rock | County Office of Education (COE)
    Charter Community School Home Study Acad | County Office of Education (COE)
    Clovis Online Charter | Unified School District
    ... 53 more rows
```

**A query that did match, from the `probe` run.**

```sql
SELECT s.school, s.doc FROM schools s JOIN frpm f ON s.cdscode = f.cdscode WHERE s.fundingtype = 'Locally funded' AND (f."Enrollment (K-12)" - f."Enrollment (Ages 5-17)") > (SELECT AVG(f2."Enrollment (K-12)" - f2."Enrollment (Ages 5-17)") FROM frpm f2 JOIN schools s2 ON f2.cdscode = s2.cdscode WHERE s2.fundingtype = 'Locally funded')
```

```
57 rows x 2 cols  [school, doc]
    Mountain Oaks | 00
    Castle Rock | 00
    Charter Community School Home Study Acad | 00
    Clovis Online Charter | 54
    ... 53 more rows
```

</details>

---

### bird-0462 — california_schools, moderate

**Question.** Which schools served a grade span of Kindergarten to 9th grade in the county of Los Angeles and what is its Percent (%) Eligible FRPM (Ages 5-17)?

**Evidence given with it.** Percent (%) Eligible FRPM (Ages 5-17) can be acquired by `FRPM Count (Ages 5-17)` / `Enrollment (Ages 5-17)` * 100

**What we did.** Filtered frpm."County Name" = 'Los Angeles' with frpm."Low Grade" = 'K' AND frpm."High Grade" = '9' and returned the stored frpm."Percent (%) Eligible FRPM (Ages 5-17)" column, which yields 0 rows.

**What is expected.** Gold filters schools.County = 'Los Angeles' AND schools.GSserved = 'K-9' — those two schools carry frpm Low/High Grade of K/5 and K/8, so the frpm grade columns never match — and computes "FRPM Count (Ages 5-17)" * 100 / "Enrollment (Ages 5-17)" to get 3.7558 and 97.6388.

**To fix it.** Express a grade-span filter as schools.GSserved = 'K-9' rather than frpm's Low/High Grade pair, and compute the percentage from the evidence formula instead of selecting the similarly named stored column that holds a 0–1 fraction.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: schools, frpm

**Reference SQL — this is what correct means.**

```sql
SELECT T2.School, T1."FRPM Count (Ages 5-17)" * 100 / NULLIF(T1."Enrollment (Ages 5-17)", 0) FROM frpm AS T1 INNER JOIN schools AS T2 ON T1.CDSCode = T2.CDSCode WHERE T2.County = 'Los Angeles' AND T2.GSserved = 'K-9'
```

```
2 rows x 2 cols  [school, ?column?]
    White Oak Elementary | 3.755868544600939
    The Accelerated | 97.63888888888889
```

**Our SQL — wrong.**

```sql
SELECT s."school", f."Percent (%) Eligible FRPM (Ages 5-17)" FROM "frpm" f JOIN "schools" s ON f."cdscode" = s."cdscode" WHERE f."County Name" = 'Los Angeles' AND f."Low Grade" = 'K' AND f."High Grade" = '9'
```

```
0 rows x 2 cols  [school, Percent (%) Eligible FRPM (Ages 5-17)]

```

</details>

---

### bird-0466 — california_schools, moderate

**Question.** What is the Percent (%) Eligible Free (K-12) in the school administered by an administrator whose first name is Alusine. List the district code of the school.

**Evidence given with it.** Percent (%) Eligible Free (K-12) = `Free Meal Count (K-12)` / `Enrollment (K-12)` * 100%

**What we did.** Selected frpm."District Code" followed by the stored frpm."Percent (%) Eligible Free (K-12)" column, returning 64857 and 0.7015113.

**What is expected.** Gold computes "Free Meal Count (K-12)" * 100 / "Enrollment (K-12)" = 70.15113350125945 and returns that value before "District Code".

**To fix it.** When the evidence spells out a formula, compute it from the count and enrollment columns rather than reading the same-named stored column (it stores a fraction, not a percent), and emit the columns in the order the question names them.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: frpm, schools

**Reference SQL — this is what correct means.**

```sql
SELECT T1."Free Meal Count (K-12)" * 100 / NULLIF(T1."Enrollment (K-12)", 0), T1."District Code" FROM frpm AS T1 INNER JOIN schools AS T2 ON T1.CDSCode = T2.CDSCode WHERE T2.AdmFName1 = 'Alusine'
```

```
1 rows x 2 cols  [?column?, District Code]
    70.15113350125945 | 64857
```

**Our SQL — wrong.**

```sql
SELECT f."District Code", f."Percent (%) Eligible Free (K-12)" FROM frpm f JOIN schools s ON f.cdscode = s.cdscode WHERE s.admfname1 = 'Alusine'
```

```
1 rows x 2 cols  [District Code, Percent (%) Eligible Free (K-12)]
    64857 | 0.7015113
```

</details>


## Missing or extra filter (16)

A condition the question states was dropped, or one it never asked for was added.

### bird-0090 — thrombosis_prediction, challenging

**Question.** How many underage patients were examined during the course of the three-year period from 1990 to 1993?

**Evidence given with it.** underage patients refers to year(Birthday) < 18; three-year period from 1990 to 1993 refers to year(`Examination Date`) between '1990' and '1993'

**What we did.** Filtered EXTRACT(YEAR FROM patient.birthday) < 18, a condition no birth year can satisfy, so the count came back 0.

**What is expected.** Gold compares age at the exam — EXTRACT(YEAR FROM "Examination Date") - EXTRACT(YEAR FROM Birthday) < 18 — inside exam years 1990 to 1993, and counts 1.

**To fix it.** Translate 'underage' into a difference between the event year and the birth year, never a bare comparison of the birth year against 18, even when the evidence writes it literally as year(Birthday) < 18.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: patient, examination

**Reference SQL — this is what correct means.**

```sql
SELECT COUNT(T1.ID) FROM Patient AS T1 INNER JOIN Examination AS T2 ON T1.ID = T2.ID WHERE EXTRACT(YEAR FROM T2."Examination Date") BETWEEN 1990 AND 1993 AND EXTRACT(YEAR FROM T2."Examination Date") - EXTRACT(YEAR FROM T1.Birthday) < 18
```

```
1 rows x 1 cols  [count]
    1
```

**Our SQL — wrong.**

```sql
SELECT COUNT(DISTINCT e.id) FROM examination e JOIN patient p ON e.id = p.id WHERE EXTRACT(YEAR FROM e."Examination Date") BETWEEN 1990 AND 1993 AND EXTRACT(YEAR FROM p.birthday) < 18
```

```
1 rows x 1 cols  [count]
    0
```

**A query that did match, from the `self` run.**

```sql
SELECT COUNT(DISTINCT p.id) FROM "patient" p JOIN "examination" e ON p.id = e.id WHERE (EXTRACT(YEAR FROM e."Examination Date") - EXTRACT(YEAR FROM p.birthday)) < 18 AND EXTRACT(YEAR FROM e."Examination Date") BETWEEN 1990 AND 1993
```

```
1 rows x 1 cols  [count]
    1
```

</details>

---

### bird-0111 — thrombosis_prediction, challenging

**Question.** Name the ID and age of patient with two or more laboratory examinations which show their hematoclit level exceeded the normal range.

**Evidence given with it.** age = SUBTRACT(year(current_timestamp), year(Birthday)); patient with two or more laboratory examinations refers to COUNT(ID) > 2; hematoclit level exceeded the normal range refers to HCT > = 52;

**What we did.** Used HAVING COUNT(l."id") > 2, demanding at least three lab tests with HCT >= 52, which dropped patient 3182521 and returned only 2 rows.

**What is expected.** Gold requires two or more (COUNT(ID) >= 2) and returns 3 rows: 2307640, 3182521, 4007151.

**To fix it.** Translate 'two or more' as >= 2 and prefer the question's wording over the evidence when they disagree — the evidence here literally says 'COUNT(ID) > 2' and gold does not follow it.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: patient, laboratory

**Reference SQL — this is what correct means.**

```sql
SELECT DISTINCT T1.ID, EXTRACT(YEAR FROM CURRENT_TIMESTAMP) - EXTRACT(YEAR FROM T1.Birthday) AS Age FROM Patient AS T1 INNER JOIN Laboratory AS T2 ON T1.ID = T2.ID WHERE T1.ID IN (SELECT ID FROM Laboratory WHERE HCT >= 52 GROUP BY ID HAVING COUNT(ID) >= 2)
```

```
3 rows x 2 cols  [id, age]
    2307640 | 73
    3182521 | 74
    4007151 | 58
```

**Our SQL — wrong.**

```sql
SELECT p."id", EXTRACT(YEAR FROM CURRENT_DATE) - EXTRACT(YEAR FROM p."birthday") AS age FROM "patient" p JOIN "laboratory" l ON p."id" = l."id" WHERE l."hct" >= 52 GROUP BY p."id", p."birthday" HAVING COUNT(l."id") > 2
```

```
2 rows x 2 cols  [id, age]
    2307640 | 73
    4007151 | 58
```

**A query that did match, from the `self` run.**

```sql
SELECT p."id", EXTRACT(YEAR FROM CURRENT_DATE) - EXTRACT(YEAR FROM p."birthday") AS age FROM "patient" p JOIN "laboratory" l ON p."id" = l."id" WHERE l."hct" >= 52 GROUP BY p."id", p."birthday" HAVING COUNT(l."id") >= 2
```

```
3 rows x 2 cols  [id, age]
    2307640 | 73
    3182521 | 74
    4007151 | 58
```

</details>

---

### bird-0152 — european_football_2, simple

**Question.** Give the name of the league had the most matches in the 2008/2009 season?

**Evidence given with it.** league that had the most matches in the 2008/2009 season refers to MAX(league_name WHERE season = '2008/2009');

**What we did.** Grouped match rows by league name for season '2008/2009', ordered by COUNT(*) DESC and took LIMIT 1, returning only 'England Premier League'.

**What is expected.** Four leagues tie at the maximum match count, and gold's HAVING COUNT(match.id) = (SELECT MAX(match_count) ...) returns all four names.

**To fix it.** For a 'most X' question, keep every group whose count equals the maximum via HAVING instead of collapsing to ORDER BY ... LIMIT 1, which silently drops ties.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: league, match

**Reference SQL — this is what correct means.**

```sql
SELECT t1.name FROM League AS t1 JOIN Match AS t2 ON t1.id = t2.league_id WHERE t2.season = '2008/2009' GROUP BY t1.name HAVING COUNT(t2.id) = (SELECT MAX(match_count) FROM (SELECT COUNT(t2.id) AS match_count FROM Match AS t2 WHERE t2.season = '2008/2009' GROUP BY t2.league_id) AS subquery)
```

```
4 rows x 1 cols  [name]
    England Premier League
    Italy Serie A
    Spain LIGA BBVA
    France Ligue 1
```

**Our SQL — wrong.**

```sql
SELECT l.name FROM "match" m JOIN "league" l ON m.league_id = l.id WHERE m.season = '2008/2009' GROUP BY l.name ORDER BY COUNT(*) DESC LIMIT 1
```

```
1 rows x 1 cols  [name]
    England Premier League
```

</details>

---

### bird-0177 — european_football_2, simple

**Question.** Please name one player whose overall strength is the greatest.

**Evidence given with it.** overall strength is the greatest refers to MAX(overall_rating)

**What we did.** Joined player to player_attributes and used ORDER BY pa.overall_rating DESC LIMIT 1, which under Postgres sorts NULL overall_rating first and returned 'Matthew Connolly'.

**What is expected.** Gold filters WHERE t2.overall_rating = (SELECT MAX(overall_rating) FROM Player_Attributes), which never sees NULL ratings and returns 'Lionel Messi'.

**To fix it.** Take a maximum either by comparing to a scalar MAX() subquery or by writing ORDER BY col DESC NULLS LAST, because Postgres puts NULLs first under DESC.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: player, player_attributes

**Reference SQL — this is what correct means.**

```sql
SELECT DISTINCT t1.player_name FROM Player AS t1 INNER JOIN Player_Attributes AS t2 ON t1.player_api_id = t2.player_api_id WHERE t2.overall_rating = (SELECT MAX(overall_rating) FROM Player_Attributes)
```

```
1 rows x 1 cols  [player_name]
    Lionel Messi
```

**Our SQL — wrong.**

```sql
SELECT p.player_name FROM player p JOIN player_attributes pa ON p.player_api_id = pa.player_api_id ORDER BY pa.overall_rating DESC LIMIT 1
```

```
1 rows x 1 cols  [player_name]
    Matthew Connolly
```

</details>

---

### bird-0225 — formula_1, simple

**Question.** What is the fastest lap number of the champion in 2009?

**Evidence given with it.** in 2009 refers to year = 2009; Only the time of the champion shows in the format of "hour: minutes: seconds.millionsecond"

**What we did.** Added a filter pinning results.driverid to the 2009 season champion derived from driverstandings, returning only that one driver's 5 fastestlap values.

**What is expected.** Gold filters only on year 2009 and results.time LIKE '_:%:__.___', which picks the winner of each of the 16 races (position = 1) and returns 16 fastestlap values.

**To fix it.** When the evidence defines the target by a stored value format ('only the champion's time is HH:MM:SS.mmm'), filter on that pattern or on position = 1 per race, never on a season champion computed from driverstandings.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: races, results, drivers, driverstandings

**Reference SQL — this is what correct means.**

```sql
SELECT T1.fastestLap FROM results AS T1 INNER JOIN races AS T2 ON T1.raceId = T2.raceId WHERE T2.year = 2009 AND T1.time LIKE '_:%:__.___'
```

```
16 rows x 1 cols  [fastestlap]
    18
    42
    11
    17
    ... 12 more rows
```

**Our SQL — wrong.**

```sql
SELECT r.fastestlap FROM results r JOIN races ra ON r.raceid = ra.raceid WHERE ra.year = 2009 AND r.driverid = (SELECT ds.driverid FROM driverstandings ds JOIN races ra2 ON ds.raceid = ra2.raceid WHERE ra2.year = 2009 ORDER BY ra2.round DESC, ds.position ASC LIMIT 1) AND r.time ~ '^\d+:\d{2}:\d{2}\.\d+$'
```

```
5 rows x 1 cols  [fastestlap]
    18
    11
    17
    49
    ... 1 more rows
```

**A query that did match, from the `desc-sql` run.**

```sql
SELECT r."fastestlap" FROM "results" r JOIN "races" ra ON r."raceid" = ra."raceid" WHERE ra."year" = 2009 AND r."position" = 1 AND r."time" LIKE '%:%:%'
```

```
16 rows x 1 cols  [fastestlap]
    18
    42
    11
    17
    ... 12 more rows
```

</details>

---

### bird-0235 — formula_1, moderate

**Question.** On what year did the youngest driver had his first qualifying race? Also state the name, date and time of the race.

**Evidence given with it.** date of birth refers to drivers.dob; The larger the birthday value, the younger the person is, and vice versa; first qualifying race refers to MIN(races.date);

**What we did.** Selected the youngest driver with (SELECT driverid FROM drivers ORDER BY dob DESC LIMIT 1), which in Postgres returns the single driver whose dob is NULL, and that driver has no qualifying rows, so the outer query returned 0 rows.

**What is expected.** Gold orders dob DESC NULLS LAST, picking the genuinely youngest driver whose earliest qualifying race is the 2017 Chinese Grand Prix.

**To fix it.** In Postgres a DESC sort puts NULLs first, so any ORDER BY col DESC LIMIT 1 used as a max needs NULLS LAST or a WHERE col IS NOT NULL guard.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: drivers, qualifying, races

**Reference SQL — this is what correct means.**

```sql
SELECT T3.year, T3.name, T3.date, T3.time FROM qualifying AS T1 INNER JOIN drivers AS T2 ON T1.driverId = T2.driverId INNER JOIN races AS T3 ON T1.raceId = T3.raceId WHERE T1.driverId = (SELECT driverId FROM drivers ORDER BY dob DESC NULLS LAST LIMIT 1) ORDER BY T3.date ASC NULLS FIRST LIMIT 1
```

```
1 rows x 4 cols  [year, name, date, time]
    2017 | Chinese Grand Prix | Sun Apr 09 2017 00:00:00 GMT-0700 (Pacif | 06:00:00
```

**Our SQL — wrong.**

```sql
SELECT r.year, r.name, r.date, r.time FROM races r JOIN qualifying q ON r.raceid = q.raceid WHERE q.driverid = (SELECT driverid FROM drivers ORDER BY dob DESC LIMIT 1) ORDER BY r.date ASC LIMIT 1
```

```
0 rows x 4 cols  [year, name, date, time]

```

**A query that did match, from the `self` run.**

```sql
SELECT r.year, r.name, r.date, r.time FROM races r JOIN qualifying q ON r.raceid = q.raceid WHERE q.driverid = (SELECT driverid FROM drivers WHERE dob IS NOT NULL ORDER BY dob DESC LIMIT 1) ORDER BY r.date ASC LIMIT 1
```

```
1 rows x 4 cols  [year, name, date, time]
    2017 | Chinese Grand Prix | Sun Apr 09 2017 00:00:00 GMT-0700 (Pacif | 06:00:00
```

</details>

---

### bird-0236 — formula_1, challenging

**Question.** List down top 3 German drivers who has the shortest average pit stop duration and were born between 1980-1985.

**Evidence given with it.** Full name of the driver refers to drivers.forename and drivers.surname; born between 1980-1985 refers to 1980< year(dob)>1985; Average pitstop duration refers to Divide(SUM(duration),COUNT(duration)); shortest average refers to Min(avg(duration));

**What we did.** Filtered EXTRACT(YEAR FROM dob) > 1980 AND EXTRACT(YEAR FROM dob) < 1985 exclusively, which drops Nico Rosberg (dob 1985-06-27) and leaves only 2 rows, and also selected a third avg_duration column.

**What is expected.** Gold filters EXTRACT(YEAR FROM dob) BETWEEN 1980 AND 1985 inclusively and returns exactly forename and surname for Glock, Sutil and Rosberg.

**To fix it.** Read 'born between 1980-1985' as inclusive on both endpoints, and keep the ordering expression (AVG of pit stop duration) out of the SELECT list.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: drivers, pitstops

**Reference SQL — this is what correct means.**

```sql
SELECT T2.forename, T2.surname FROM pitStops AS T1 INNER JOIN drivers AS T2 ON T1.driverId = T2.driverId WHERE T2.nationality = 'German' AND EXTRACT(YEAR FROM T2.dob) BETWEEN 1980 AND 1985 GROUP BY T2.forename, T2.surname ORDER BY AVG(CAST(T1.duration AS INTERVAL))  LIMIT 3
```

```
3 rows x 2 cols  [forename, surname]
    Timo | Glock
    Adrian | Sutil
    Nico | Rosberg
```

**Our SQL — wrong.**

```sql
SELECT d.forename, d.surname, AVG(p.milliseconds) AS avg_duration FROM drivers d JOIN pitstops p ON d.driverid = p.driverid WHERE d.nationality = 'German' AND EXTRACT(YEAR FROM d.dob) > 1980 AND EXTRACT(YEAR FROM d.dob) < 1985 GROUP BY d.driverid, d.forename, d.surname ORDER BY avg_duration ASC LIMIT 3
```

```
2 rows x 3 cols  [forename, surname, avg_duration]
    Timo | Glock | 23689.388888888889
    Adrian | Sutil | 35102.215517241379
```

</details>

---

### bird-0249 — superhero, moderate

**Question.** Rank heroes published by Marvel Comics by their height in descending order.

**Evidence given with it.** name refers to superhero_name; the tallest hero refers to MAX(height_cm); published by Marvel Comics refers to publisher_name = 'Marvel Comics'

**What we did.** Ranked with RANK() OVER (ORDER BY s.height_cm DESC), so the 21 Marvel heroes whose height_cm is NULL sorted first and all received rank 1, shifting the rank value of every other row.

**What is expected.** Gold uses RANK() OVER (ORDER BY height_cm DESC NULLS LAST), so Ymir and Surtur at 30480 cm are rank 1 and the NULL-height heroes rank last.

**To fix it.** Append NULLS LAST to every descending ORDER BY, including window ORDER BY clauses, because the gold queries were authored for SQLite (NULLs sort smallest) while Postgres puts NULLs first under DESC.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: superhero, publisher

**Reference SQL — this is what correct means.**

```sql
SELECT superhero_name, height_cm, RANK() OVER (ORDER BY height_cm DESC NULLS LAST) AS HeightRank FROM superhero INNER JOIN publisher ON superhero.publisher_id = publisher.id WHERE publisher.publisher_name = 'Marvel Comics'
```

```
387 rows x 3 cols  [superhero_name, height_cm, heightrank]
    Ymir | 30480 | 1
    Surtur | 30480 | 1
    Bloodwraith | 3050 | 3
    Utgard-Loki | 1520 | 4
    ... 383 more rows
```

**Our SQL — wrong.**

```sql
SELECT s.superhero_name, s.height_cm, RANK() OVER (ORDER BY s.height_cm DESC) AS height_rank FROM superhero s JOIN publisher p ON s.publisher_id = p.id WHERE p.publisher_name = 'Marvel Comics' ORDER BY s.height_cm DESC
```

```
387 rows x 3 cols  [superhero_name, height_cm, height_rank]
    Bird-Man | null | 1
    Blaquesmith | null | 1
    Wondra | null | 1
    Thunderbird II | null | 1
    ... 383 more rows
```

**A query that did match, from the `self` run.**

```sql
SELECT s.superhero_name, s.height_cm, RANK() OVER (ORDER BY s.height_cm DESC NULLS LAST) AS height_rank FROM "superhero" s JOIN "publisher" p ON s.publisher_id = p.id WHERE p.publisher_name = 'Marvel Comics' ORDER BY s.height_cm DESC NULLS LAST
```

```
387 rows x 3 cols  [superhero_name, height_cm, height_rank]
    Ymir | 30480 | 1
    Surtur | 30480 | 1
    Bloodwraith | 3050 | 3
    Utgard-Loki | 1520 | 4
    ... 383 more rows
```

</details>

---

### bird-0281 — superhero, challenging

**Question.** How many percent of female heroes were published by Marvel Comics?

**Evidence given with it.** percent = MULTIPLY(DIVIDE(SUM(gender = 'Female' WHERE publisher_name = 'Marvel Comics'), COUNT(publisher_name = 'Marvel Comics')), 100); female heroes refers to gender = 'Female'; Marvel Comics refers to publisher_name = 'Marvel Comics';

**What we did.** Put publisher_name = 'Marvel Comics' in the WHERE clause and counted gender = 'Female' inside the CASE, so the denominator was all Marvel heroes and the answer came out 28.68.

**What is expected.** Gold filters WHERE gender.gender = 'Female' and counts publisher_name = 'Marvel Comics' inside the CASE, making the denominator all female heroes and the answer 54.95.

**To fix it.** Read the evidence's DIVIDE(numerator, denominator) literally — the denominator's condition (here 'Female') belongs in WHERE and the numerator's condition (here 'Marvel Comics') belongs inside the COUNT/CASE, never the reverse.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: superhero, gender, publisher

**Reference SQL — this is what correct means.**

```sql
SELECT CAST(COUNT(CASE WHEN T2.publisher_name = 'Marvel Comics' THEN 1 ELSE NULL END) AS REAL) * 100 / NULLIF(COUNT(T1.id), 0) FROM superhero AS T1 INNER JOIN publisher AS T2 ON T1.publisher_id = T2.id INNER JOIN gender AS T3 ON T1.gender_id = T3.id WHERE T3.gender = 'Female'
```

```
1 rows x 1 cols  [?column?]
    54.95049504950495
```

**Our SQL — wrong.**

```sql
SELECT SUM(CASE WHEN g.gender = 'Female' THEN 1 ELSE 0 END) * 100.0 / COUNT(*) AS percent FROM superhero s JOIN publisher p ON s.publisher_id = p.id JOIN gender g ON s.gender_id = g.id WHERE p.publisher_name = 'Marvel Comics'
```

```
1 rows x 1 cols  [percent]
    28.6821705426356589
```

**A query that did match, from the `stack` run.**

```sql
SELECT SUM(CASE WHEN p.publisher_name = 'Marvel Comics' THEN 1 ELSE 0 END) * 100.0 / COUNT(*) FROM superhero s JOIN publisher p ON s.publisher_id = p.id JOIN gender g ON s.gender_id = g.id WHERE g.gender = 'Female'
```

```
1 rows x 1 cols  [?column?]
    54.9504950495049505
```

</details>

---

### bird-0327 — codebase_community, moderate

**Question.** State all the tags used by Mark Meckes in his posts that doesn't have comments.

**Evidence given with it.** used by Mark Meckes refers to DisplayName = 'Mark Meckes'; Doen't have comments refers to CommentCount = 0;

**What we did.** Added `AND p.tags IS NOT NULL` to the posts/users filter, returning only the `<books>` row and dropping Mark Meckes's one comment-free post whose `tags` column is NULL.

**What is expected.** Gold applies only `DisplayName = 'Mark Meckes'` and `CommentCount = 0` and returns both distinct values — `<books>` and NULL — because a post with no tags is still a matching post.

**To fix it.** Do not add IS NOT NULL guards to a projected column unless the question excludes empty values; NULL is a legitimate row in the answer set.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: users, posts, comments

**Reference SQL — this is what correct means.**

```sql
SELECT T3.Tags FROM users AS T1 INNER JOIN postHistory AS T2 ON T1.Id = T2.UserId INNER JOIN posts AS T3 ON T3.Id = T2.PostId WHERE T1.DisplayName = 'Mark Meckes' AND T3.CommentCount = 0
```

```
5 rows x 1 cols  [tags]
    <books>
    <books>
    <books>
    <books>
    ... 1 more rows
```

**Our SQL — wrong.**

```sql
SELECT DISTINCT p.tags FROM posts p JOIN users u ON p.owneruserid = u.id WHERE u.displayname = 'Mark Meckes' AND p.commentcount = 0 AND p.tags IS NOT NULL
```

```
1 rows x 1 cols  [tags]
    <books>
```

**A query that did match, from the `rows-v3` run.**

```sql
SELECT DISTINCT p.tags FROM posts p JOIN users u ON p.owneruserid = u.id WHERE u.displayname = 'Mark Meckes' AND p.commentcount = 0
```

```
2 rows x 1 cols  [tags]
    <books>
    null
```

</details>

---

### bird-0374 — card_games, simple

**Question.** What proportion of cards do not have a text box with a normal layout?

**Evidence given with it.** do not have a text box refers to isTextless = 1; proportion refers to DIVIDE(COUNT(Textless = 1 and layout = 'normal'),COUNT(Textless))*100

**What we did.** Divided the count of cards with istextless = 1 AND layout = 'normal' by the count of cards with istextless = 1, returning exactly 100 because every textless card in cards has layout = 'normal'.

**What is expected.** Gold divides the same numerator by COUNT(*) over the whole cards table, returning 0.2024%.

**To fix it.** Read 'proportion of cards' as a share of every row in the table and use COUNT(*) as the denominator; do not copy the numerator's filter into the denominator when the question names no subpopulation.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: cards

**Reference SQL — this is what correct means.**

```sql
SELECT CAST(SUM(CASE WHEN isTextless = 1 AND layout = 'normal' THEN 1 ELSE 0 END) AS REAL) * 100 / NULLIF(COUNT(*), 0) FROM cards
```

```
1 rows x 1 cols  [?column?]
    0.20238639963394459
```

**Our SQL — wrong.**

```sql
SELECT (SUM(CASE WHEN "istextless"=1 AND "layout"='normal' THEN 1 ELSE 0 END)::float / NULLIF(SUM(CASE WHEN "istextless"=1 THEN 1 ELSE 0 END),0)) * 100 AS proportion FROM "cards"
```

```
1 rows x 1 cols  [proportion]
    100
```

</details>

---

### bird-0449 — california_schools, moderate

**Question.** What is the eligible free or reduced price meal rate for the top 5 schools in grades 1-12 with the highest free or reduced price meal count of the schools with the ownership code 66?

**Evidence given with it.** grades 1-12 means K-12; Eligible free or reduced price meal rate for K-12 = `FRPM Count (K-12)` / `Enrollment (K-12)`

**What we did.** Ordered by `FRPM Count (K-12)` DESC without NULLS LAST, so three schools with a NULL FRPM count (Cold Springs High, Yosemite Park High, New Opportunities Charter) sorted to the top and came back with NULL rates, and we also emitted a `School Name` column.

**What is expected.** Gold orders `FRPM Count (K-12)` DESC NULLS LAST — pushing null counts out of the top 5 — and returns only the rate column, starting 0.91794765, 0.9993291, 0.8964988.

**To fix it.** In Postgres DESC sorts NULLs first, so every top-N ordering on a nullable measure needs NULLS LAST (or an IS NOT NULL filter), and the SELECT list should carry only the asked-for rate.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: frpm, schools

**Reference SQL — this is what correct means.**

```sql
SELECT CAST(T1."FRPM Count (K-12)" AS REAL) / NULLIF(T1."Enrollment (K-12)", 0) FROM frpm AS T1 INNER JOIN schools AS T2 ON T1.CDSCode = T2.CDSCode WHERE T2.SOC::integer = 66 ORDER BY T1."FRPM Count (K-12)" DESC NULLS LAST LIMIT 5
```

```
5 rows x 1 cols  [?column?]
    0.91794765
    0.9993291
    0.8964988
    0.8958203
    ... 1 more rows
```

**Our SQL — wrong.**

```sql
SELECT f."School Name", f."FRPM Count (K-12)" / f."Enrollment (K-12)" AS frpm_rate FROM frpm f JOIN schools s ON f.cdscode = s.cdscode WHERE s.soc = '66' ORDER BY f."FRPM Count (K-12)" DESC LIMIT 5
```

```
5 rows x 2 cols  [School Name, frpm_rate]
    Cold Springs High | null
    Yosemite Park High | null
    New Opportunities Charter | null
    Paramount High | 0.91794765
    ... 1 more rows
```

</details>

---

### bird-0454 — california_schools, simple

**Question.** List the names of virtual schools that are among the top 5 in their respective counties based on average reading scores.

**Evidence given with it.** Exclusively virtual refers to Virtual = 'F'; respective counties means PARTITION BY County

**What we did.** Ranked with RANK() OVER (PARTITION BY s.county ORDER BY sc.avgscrread DESC), letting schools with a NULL avgscrread take rank 1 in their county and consume top-5 slots, returning only 31 school names.

**What is expected.** Gold's ORDER BY AvgScrRead DESC NULLS LAST sinks the NULL reading scores to the bottom of each county partition, so 34 schools with real scores fill the top 5.

**To fix it.** Add NULLS LAST to DESC orderings inside window functions (or exclude NULL scores in the WHERE clause) so missing values never occupy a top-N rank in Postgres.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: schools, satscores

**Reference SQL — this is what correct means.**

```sql
SELECT School FROM (SELECT T2.School, T1.AvgScrRead, RANK() OVER (PARTITION BY T2.County ORDER BY T1.AvgScrRead DESC NULLS LAST) AS rnk FROM satscores AS T1 INNER JOIN schools AS T2 ON T1.cds = T2.CDSCode WHERE T2.Virtual = 'F') AS ranked_schools WHERE rnk <= 5
```

```
34 rows x 1 cols  [school]
    Academy of Arts and Sciences: Fresno
    Dunlap Leadership Academy
    Insight School of California
    California Virtual Academy @ Kings
    ... 30 more rows
```

**Our SQL — wrong.**

```sql
SELECT school_name FROM (SELECT s.school AS school_name, s.county, sc.avgscrread, RANK() OVER (PARTITION BY s.county ORDER BY sc.avgscrread DESC) AS rnk FROM schools s JOIN satscores sc ON s.cdscode = sc.cds WHERE s.virtual = 'F') ranked WHERE rnk <= 5
```

```
31 rows x 1 cols  [school_name]
    Academy of Arts and Sciences: Fresno
    Dunlap Leadership Academy
    Insight School of California
    California Virtual Academy @ Kings
    ... 27 more rows
```

</details>

---

### bird-0456 — california_schools, simple

**Question.** Which state special schools have the highest number of enrollees from grades 1 through 12?

**Evidence given with it.** State Special Schools refers to DOC = 31; Grades 1 through 12 means K-12

**What we did.** Returned all 3 schools with doc = '31' sorted by `Enrollment (K-12)` DESC and included the enrollment value as a second column, with no LIMIT.

**What is expected.** Gold applies LIMIT 1 and returns one column — the single school name 'California School for the Deaf-Fremont'.

**To fix it.** 'Which X has the highest Y' means ORDER BY Y DESC LIMIT 1 and project only X — the sort key itself must not appear in the output.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: schools, frpm

**Reference SQL — this is what correct means.**

```sql
SELECT T2.School FROM frpm AS T1 INNER JOIN schools AS T2 ON T1.CDSCode = T2.CDSCode WHERE T2.DOC = '31' ORDER BY T1."Enrollment (K-12)" DESC LIMIT 1
```

```
1 rows x 1 cols  [school]
    California School for the Deaf-Fremont
```

**Our SQL — wrong.**

```sql
SELECT s.school, f."Enrollment (K-12)" FROM schools s JOIN frpm f ON s.cdscode = f.cdscode WHERE s.doc = '31' ORDER BY f."Enrollment (K-12)" DESC
```

```
3 rows x 2 cols  [school, Enrollment (K-12)]
    California School for the Deaf-Fremont | 410
    California School for the Deaf-Riverside | 355
    California School for the Blind | 60
```

</details>

---

### bird-0488 — financial, moderate

**Question.** In the branch where the second-highest number of crimes were committed in 1995 occurred, how many male clients are there?

**Evidence given with it.** Male refers to gender = 'M'; A15 stands for no. of commited crimes 1995

**What we did.** Ranked with (SELECT DISTINCT a15 FROM district ORDER BY a15 DESC OFFSET 1 LIMIT 1), and because district 69 has a NULL a15 that Postgres sorts first under plain DESC, the offset landed on the maximum 85677 (Prague) and counted 339 male clients.

**What is expected.** Gold orders A15 DESC NULLS LAST so OFFSET 1 lands on the genuine second-highest value 18782 (district 74), giving 96 male clients.

**To fix it.** Always write NULLS LAST on a DESC ordering used for top-N or OFFSET ranking — district.A15 contains a NULL and Postgres places NULLs first in DESC, shifting every rank by one.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: district, client

**Reference SQL — this is what correct means.**

```sql
SELECT COUNT(T1.client_id) FROM client AS T1 INNER JOIN district AS T2 ON T1.district_id = T2.district_id WHERE T1.gender = 'M' AND T2.A15 = (SELECT T3.A15 FROM district AS T3 ORDER BY T3.A15 DESC NULLS LAST LIMIT 1 OFFSET 1)
```

```
1 rows x 1 cols  [count]
    96
```

**Our SQL — wrong.**

```sql
SELECT COUNT(*) FROM client c JOIN district d ON c.district_id = d.district_id WHERE c.gender = 'M' AND d.a15 = (SELECT DISTINCT a15 FROM district ORDER BY a15 DESC OFFSET 1 LIMIT 1)
```

```
1 rows x 1 cols  [count]
    339
```

**A query that did match, from the `rows-v3` run.**

```sql
SELECT COUNT(*) FROM client c WHERE c.gender = 'M' AND c.district_id = (SELECT district_id FROM district ORDER BY a15 DESC NULLS LAST OFFSET 1 LIMIT 1)
```

```
1 rows x 1 cols  [count]
    96
```

</details>

---

### bird-0494 — financial, challenging

**Question.** What was the growth rate of the total amount of loans across all accounts for a male client between 1996 and 1997?

**Evidence given with it.** Growth rate = (sum of amount_1997 - sum of amount_1996) / (sum of amount_1996) * 100%; Male refers to gender = 'M'

**What we did.** Joined loan -> disp -> client on gender = 'M' with no disposition-type filter, so loans held by a male DISPONENT counted too and loans with two male dispositions counted twice, yielding 25.3620.

**What is expected.** Gold adds T3.type = 'OWNER' (4500 of the 5369 disp rows), attributing each loan to exactly one male owner and yielding 25.3001.

**To fix it.** Whenever disp is used to attribute an account or loan to a client, add disp.type = 'OWNER' — without it the same loan is summed once per disposition row.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: loan, account, disp, client

**Reference SQL — this is what correct means.**

```sql
SELECT CAST((SUM(CASE WHEN TO_CHAR(CAST(T1.date AS TIMESTAMP), 'YYYY') = '1997' THEN T1.amount ELSE 0 END) - SUM(CASE WHEN TO_CHAR(CAST(T1.date AS TIMESTAMP), 'YYYY') = '1996' THEN T1.amount ELSE 0 END)) AS REAL) * 100 / NULLIF(SUM(CASE WHEN TO_CHAR(CAST(T1.date AS TIMESTAMP), 'YYYY') = '1996' THEN T1.amount ELSE 0 END), 0) FROM loan AS T1 INNER JOIN account AS T2 ON T1.account_id = T2.account_id INNER JOIN disp AS T3 ON T3.account_id = T2.account_id INNER JOIN client AS T4 ON T4.client_id = T3.client_id WHERE T4.gender = 'M' AND T3.type = 'OWNER'
```

```
1 rows x 1 cols  [?column?]
    25.300191222790616
```

**Our SQL — wrong.**

```sql
SELECT (SUM(CASE WHEN EXTRACT(YEAR FROM l."date")=1997 THEN l."amount" ELSE 0 END) - SUM(CASE WHEN EXTRACT(YEAR FROM l."date")=1996 THEN l."amount" ELSE 0 END))::float / NULLIF(SUM(CASE WHEN EXTRACT(YEAR FROM l."date")=1996 THEN l."amount" ELSE 0 END),0) * 100 AS growth_rate FROM "loan" l JOIN "disp" d ON l."account_id" = d."account_id" JOIN "client" c ON d."client_id" = c."client_id" WHERE c."gender" = 'M' AND EXTRACT(YEAR FROM l."date") IN (1996,1997)
```

```
1 rows x 1 cols  [growth_rate]
    25.36203967738821
```

</details>


## Counted or averaged at the wrong level (13)

Per join row instead of per entity, DISTINCT where the reference counts every row, or a MAX over stored rows where the reference sums into groups first.

### bird-0013 — debit_card_specializing, simple

**Question.** What is the highest monthly consumption in the year 2012?

**Evidence given with it.** cast the consumption into float when perform calculation; The first 4 strings of the Date values in the yearmonth table can represent year; The 5th and 6th string of the date can refer to month.

**What we did.** Took MAX(CAST(consumption AS float)) over individual yearmonth rows for 2012, returning one customer-month value of 445279.6875.

**What is expected.** Gold sums Consumption per calendar month across all customers (GROUP BY SUBSTR(Date, 5, 2)) and returns the largest monthly total, 51787161.71440923.

**To fix it.** Read 'highest monthly X' as GROUP BY month then SUM across all entities and take the top total, not MAX of a single stored row.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: yearmonth

**Reference SQL — this is what correct means.**

```sql
SELECT SUM(CAST(Consumption AS float)) FROM yearmonth WHERE SUBSTR(Date, 1, 4) = '2012' GROUP BY SUBSTR(Date, 5, 2) ORDER BY SUM(Consumption) DESC NULLS LAST LIMIT 1
```

```
1 rows x 1 cols  [sum]
    51787161.71440923
```

**Our SQL — wrong.**

```sql
SELECT MAX(CAST(consumption AS float)) FROM yearmonth WHERE SUBSTRING(CAST(date AS text),1,4) = '2012'
```

```
1 rows x 1 cols  [max]
    445279.6875
```

</details>

---

### bird-0075 — student_club, challenging

**Question.** Give the full name and contact number of members who had to spend more than average on each expense.

**Evidence given with it.** full name refers to first_name, last_name; contact number refers to phone; had spent more than average on each expense refers to cost > AVG(cost)

**What we did.** Grouped expense rows per member and applied HAVING MIN(expense.cost) > (SELECT AVG(cost) FROM expense), which demands every one of a member's expenses beat the average, so 0 rows returned.

**What is expected.** Gold filters at the individual expense row with WHERE cost > (overall AVG(cost)) and returns DISTINCT first_name, last_name, phone for the 3 members who have at least one above-average expense.

**To fix it.** Apply 'cost > AVG(cost)' as a row-level WHERE plus DISTINCT over members, not as a per-member HAVING on MIN(cost) — aggregating before the comparison silently turns 'any expense' into 'all expenses'.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: member, expense

**Reference SQL — this is what correct means.**

```sql
SELECT DISTINCT T3.first_name, T3.last_name, T3.phone FROM expense AS T1 INNER JOIN budget AS T2 ON T1.link_to_budget = T2.budget_id INNER JOIN member AS T3 ON T3.member_id = T1.link_to_member WHERE T1.cost > (SELECT AVG(T1.cost) FROM expense AS T1 INNER JOIN budget AS T2 ON T1.link_to_budget = T2.budget_id INNER JOIN member AS T3 ON T3.member_id = T1.link_to_member)
```

```
3 rows x 3 cols  [first_name, last_name, phone]
    Phillip | Cullen | 905-555-5035
    Elijah | Allen | 724-555-5721
    Sacha | Harrison | 840-555-4781
```

**Our SQL — wrong.**

```sql
SELECT m.first_name, m.last_name, m.phone FROM "member" m JOIN "expense" e ON e.link_to_member = m.member_id GROUP BY m.member_id, m.first_name, m.last_name, m.phone HAVING MIN(e.cost) > (SELECT AVG(cost) FROM "expense")
```

```
0 rows x 3 cols  [first_name, last_name, phone]

```

</details>

---

### bird-0120 — thrombosis_prediction, moderate

**Question.** How many patients with a abnormal C-reactive protein don't have their data recorded?

**Evidence given with it.** abnormal C-reactive protein refers to CRP ='+'; don't have data recorded refers to Description IS NULL;

**What we did.** Counted COUNT(DISTINCT p.id) over the patient-to-laboratory join, collapsing to 25 distinct patients.

**What is expected.** Gold counts one row per lab record — COUNT(T1.ID) with no DISTINCT over the same join and the same CRP = '+' AND Description IS NULL filters — giving 208.

**To fix it.** Add DISTINCT to a COUNT only when the evidence explicitly calls for it (as bird-0125's evidence does with 'Should consider DISTINCT'); otherwise count join rows with COUNT(*).

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: patient, laboratory

**Reference SQL — this is what correct means.**

```sql
SELECT COUNT(T1.ID) FROM Patient AS T1 INNER JOIN Laboratory AS T2 ON T1.ID = T2.ID WHERE (T2.CRP = '+') AND T1.Description IS NULL
```

```
1 rows x 1 cols  [count]
    208
```

**Our SQL — wrong.**

```sql
SELECT COUNT(DISTINCT p.id) FROM "patient" p JOIN "laboratory" l ON p.id = l.id WHERE l.crp = '+' AND p.description IS NULL
```

```
1 rows x 1 cols  [count]
    25
```

**A query that did match, from the `vote5` run.**

```sql
SELECT COUNT(*) FROM "patient" p JOIN "laboratory" l ON p."id" = l."id" WHERE l."crp" = '+' AND p."description" IS NULL
```

```
1 rows x 1 cols  [count]
    208
```

</details>

---

### bird-0138 — european_football_2, moderate

**Question.** List the top 10 players' names whose heights are above 180 in descending order of average heading accuracy.

**Evidence given with it.** heights are above 180 refers to Player.height > 180; average heading accuracy = DIVIDE(SUM(heading_accuracy), COUNT(player_fifa_api_id));

**What we did.** Ranked with AVG(pa.heading_accuracy) grouped by p.player_name and also projected that average as a second column.

**What is expected.** Gold groups by Player.id and orders by SUM(t2.heading_accuracy) / NULLIF(COUNT(t2.player_fifa_api_id),0) — a denominator that also counts attribute rows whose heading_accuracy is NULL — returning player_name only; the two orderings agree for ranks 1-3 then diverge (gold Naldo at rank 4, ours Per Mertesacker).

**To fix it.** When the evidence spells out a formula such as DIVIDE(SUM(heading_accuracy), COUNT(player_fifa_api_id)), reproduce that exact numerator and denominator instead of substituting AVG(), group by the entity's primary key rather than its name, and keep the sort expression out of the SELECT list.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: player, player_attributes

**Reference SQL — this is what correct means.**

```sql
SELECT t1.player_name FROM Player AS t1 INNER JOIN Player_Attributes AS t2 ON t1.player_api_id = t2.player_api_id WHERE t1.height > 180 GROUP BY t1.id ORDER BY CAST(SUM(t2.heading_accuracy) AS REAL) / NULLIF(COUNT(t2."player_fifa_api_id"), 0) DESC NULLS LAST LIMIT 10
```

```
10 rows x 1 cols  [player_name]
    Michael Ballack
    Fernando Llorente
    John Terry
    Naldo
    ... 6 more rows
```

**Our SQL — wrong.**

```sql
SELECT p.player_name, AVG(pa.heading_accuracy) AS avg_heading_accuracy FROM player p JOIN player_attributes pa ON p.player_api_id = pa.player_api_id WHERE p.height > 180 GROUP BY p.player_name ORDER BY avg_heading_accuracy DESC LIMIT 10
```

```
10 rows x 2 cols  [player_name, avg_heading_accuracy]
    Michael Ballack | 91.8000000000000000
    Fernando Llorente | 91.5238095238095238
    John Terry | 91.3333333333333333
    Per Mertesacker | 90.2647058823529412
    ... 6 more rows
```

</details>

---

### bird-0218 — formula_1, challenging

**Question.** How much faster in percentage is the champion than the driver who finished the race last in the 2008 Australian Grand Prix?

**Evidence given with it.** how much faster in percentage = divide(subtract(incremental time, champion time), last_driver time) * 100; last driver finished time = incremental time + champion time; only champion's finished time is represented by 'HH:MM:SS.mmm'; finished the game refers to time is not null

**What we did.** Wrote a plain row-returning join over results for the 2008 Australian Grand Prix with last_finisher.time IS NOT NULL and LIMIT 1, and because that race has zero rows in results at all, it returned 0 rows.

**What is expected.** Gold computes the whole percentage inside scalar subqueries over a CTE with no outer FROM, so the same empty input still emits exactly one row whose value is NULL.

**To fix it.** Express a single-number answer as an ungrouped aggregate or a FROM-less scalar subquery so an empty input yields one NULL row rather than an empty result.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: races, results, drivers

**Reference SQL — this is what correct means.**

```sql
WITH time_in_seconds AS (SELECT T1.positionOrder, CASE WHEN T1.positionOrder = 1 THEN (CAST(SUBSTR(T1.time, 1, 1) AS REAL) * 3600) + (CAST(SUBSTR(T1.time, 3, 2) AS REAL) * 60) + CAST(SUBSTR(T1.time, 6) AS REAL) ELSE CAST(SUBSTR(T1.time, 2) AS REAL) END AS time_seconds FROM results AS T1 INNER JOIN races AS T2 ON T1.raceId = T2.raceId WHERE T2.name = 'Australian Grand Prix' AND NOT T1.time IS NULL AND T2.year = 2008), champion_time AS (SELECT time_seconds FROM time_in_seconds WHERE positionOrder = 1), last_driver_incremental AS (SELECT time_seconds FROM time_in_seconds WHERE positionOrder = (SELECT MAX(positionOrder) FROM time_in_seconds)) SELECT (CAST((SELECT time_seconds FROM last_driver_incremental) AS REAL) * 100) / NULLIF((SELECT time_seconds + (SELECT time_seconds FROM last_driver_incremental) FROM champion_time), 0)
```

```
1 rows x 1 cols  [?column?]
    null
```

**Our SQL — wrong.**

```sql
SELECT (last_finisher.milliseconds - champion.milliseconds)::float / last_finisher.milliseconds * 100 AS percentage_faster FROM races r JOIN results champion ON champion.raceid = r.raceid AND champion.position = 1 JOIN results last_finisher ON last_finisher.raceid = r.raceid WHERE r.year = 2008 AND r.name = 'Australian Grand Prix' AND last_finisher.time IS NOT NULL ORDER BY last_finisher.positionorder DESC LIMIT 1
```

```
0 rows x 1 cols  [percentage_faster]

```

**A query that did match, from the `expand` run.**

```sql
SELECT (MAX(CASE WHEN r.position = (SELECT MAX(position) FROM results r2 JOIN races ra2 ON r2.raceid=ra2.raceid WHERE ra2.year=2008 AND ra2.name='Australian Grand Prix' AND r2.time IS NOT NULL) THEN r.milliseconds END) - MIN(CASE WHEN r.position = 1 THEN r.milliseconds END)) * 100.0 / MAX(CASE WHEN r.position = (SELECT MAX(position) FROM results r2 JOIN races ra2 ON r2.raceid=ra2.raceid WHERE ra2.year=2008 AND ra2.name='Australian Grand Prix' AND r2.time IS NOT NULL) THEN r.milliseconds END) AS percentage_faster FROM results r JOIN races ra ON r.raceid = ra.raceid WHERE ra.year = 2008 AND ra.name = 'Australian Grand Prix' AND r.time IS NOT NULL
```

```
1 rows x 1 cols  [percentage_faster]
    null
```

</details>

---

### bird-0283 — superhero, simple

**Question.** Calculate the average height for all superhero.

**Evidence given with it.** average = DIVIDE(SUM(height_cm), COUNT(all heros));

**What we did.** Used AVG(height_cm) over superhero, which divides by only the 692 rows with a non-null height and returns 267.75.

**What is expected.** Gold computes SUM(height_cm) / COUNT(id), dividing by all 750 superhero rows including the 58 with a null height, giving 247.05.

**To fix it.** When evidence spells out DIVIDE(SUM(col), COUNT(all rows)), emit SUM(col) / NULLIF(COUNT(id),0) rather than AVG(col) — AVG silently drops null-valued rows from the denominator.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: superhero

**Reference SQL — this is what correct means.**

```sql
SELECT CAST(SUM(height_cm) AS REAL) / NULLIF(COUNT(id), 0) FROM superhero
```

```
1 rows x 1 cols  [?column?]
    247.04533333333333
```

**Our SQL — wrong.**

```sql
SELECT AVG(height_cm) FROM superhero
```

```
1 rows x 1 cols  [avg]
    267.7514450867052023
```

</details>

---

### bird-0319 — codebase_community, moderate

**Question.** Calculate the average view count of each post tagged as 'humor' and list the title and the comment of each post.

**Evidence given with it.** tagged as  'humor' refers to tag = '<humor>'; comment of the post refers to Text; average view count = AVG(ViewCount)

**What we did.** Computed a single global AVG(p.viewcount) OVER () of 34804.58 stamped onto all 19 joined comment rows, and matched tags with LIKE '%<humor>%'.

**What is expected.** Gold computes AVG(T2.ViewCount) with GROUP BY T2.Title, T1.Text on posts whose Tags = '<humor>' exactly, giving 9 rows with per-post averages like 288.0 and 64481.0, average column first.

**To fix it.** When a question asks for an average 'of each post' listed beside per-row columns, aggregate with GROUP BY on those columns instead of a window function, and match the tag string with equality on the exact evidence value '<humor>' rather than LIKE.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: posts, tags, comments

**Reference SQL — this is what correct means.**

```sql
SELECT AVG(T2.ViewCount) AS AverageViewCount, T2.Title, T1.Text FROM comments AS T1 INNER JOIN posts AS T2 ON T2.Id = T1.PostId WHERE T2.Tags = '<humor>' GROUP BY T2.Title, T1.Text
```

```
9 rows x 3 cols  [averageviewcount, title, text]
    288.0000000000000000 | So how many staticians *does* it take to | @Jason Punyon in particular gets a humor
    288.0000000000000000 | So how many staticians *does* it take to | Probably better asked on meta.  People f
    64481.000000000000 | What is your favorite "data analysis" ca | Also my question on the source of a stat
    64481.000000000000 | What is your favorite "data analysis" ca | Could we clarify the problem with hotlin
    ... 5 more rows
```

**Our SQL — wrong.**

```sql
SELECT p.title, c.text AS comment, AVG(p.viewcount) OVER () AS avg_view_count FROM posts p JOIN comments c ON c.postid = p.id WHERE p.tags LIKE '%<humor>%'
```

```
19 rows x 3 cols  [title, comment, avg_view_count]
    What is your favorite "data analysis" ca | Could we clarify the problem with hotlin | 34804.578947368421
    So how many staticians *does* it take to | Probably better asked on meta.  People f | 34804.578947368421
    So how many staticians *does* it take to | @Jason Punyon in particular gets a humor | 34804.578947368421
    What is your favorite "data analysis" ca | @Sharpie, feel free to close or reopen a | 34804.578947368421
    ... 15 more rows
```

</details>

---

### bird-0323 — codebase_community, moderate

**Question.** What is the average of the up votes and the average user age for users creating more than 10 posts?

**Evidence given with it.** creating more than 10 post refers to Count (UserId) > 10; average of the up votes = Divide (Sum(UpVotes), Count (UserId)); average age = Divide (Sum(Age), Count(UserId))

**What we did.** Grouped by u.id with HAVING COUNT(p.id) > 10 and returned the per-user averages as the final result — 1165 rows, many with a null age.

**What is expected.** Gold uses the >10-posts group as a subquery and then takes one AVG(UpVotes), AVG(Age) across those users, a single row of 182.28 | 34.08.

**To fix it.** When HAVING is only defining which entities qualify, wrap that grouped query as a subquery and aggregate over it in the outer SELECT, so the answer is one row rather than one row per entity.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: users, posts, votes

**Reference SQL — this is what correct means.**

```sql
SELECT AVG(T1.UpVotes), AVG(T1.Age) FROM users AS T1 INNER JOIN (SELECT OwnerUserId, COUNT(*) AS post_count FROM posts GROUP BY OwnerUserId HAVING COUNT(*) > 10) AS T2 ON T1.Id = T2.OwnerUserId
```

```
1 rows x 2 cols  [avg, avg]
    182.2832618025751073 | 34.0833333333333333
```

**Our SQL — wrong.**

```sql
SELECT AVG(u.upvotes) AS avg_upvotes, AVG(u.age) AS avg_age FROM users u JOIN posts p ON p.owneruserid = u.id GROUP BY u.id HAVING COUNT(p.id) > 10
```

```
1165 rows x 2 cols  [avg_upvotes, avg_age]
    59.0000000000000000 | null
    44.0000000000000000 | null
    8.0000000000000000 | null
    50.0000000000000000 | null
    ... 1161 more rows
```

**A query that did match, from the `self` run.**

```sql
SELECT AVG(sub.upvotes) AS avg_upvotes, AVG(sub.age) AS avg_age FROM (SELECT u.id, u.upvotes, u.age FROM users u JOIN posts p ON u.id = p.owneruserid GROUP BY u.id, u.upvotes, u.age HAVING COUNT(p.id) > 10) sub
```

```
1 rows x 2 cols  [avg_upvotes, avg_age]
    182.2832618025751073 | 34.0833333333333333
```

</details>

---

### bird-0345 — codebase_community, moderate

**Question.** Among the comments with scores between 5 to 10, what is the percentage of the users with 0 up votes?

**Evidence given with it.** percentage = DIVIDE(COUNT(UserId where UpVotes = 0 and Score BETWEEN 5 and 10))*100, (COUNT(UserId where Score BETWEEN 5 and 10));

**What we did.** Counted distinct users — `COUNT(DISTINCT CASE WHEN u.upvotes = 0 THEN c.userid END) / COUNT(DISTINCT c.userid)` — yielding 4.870 percent.

**What is expected.** Gold counts one row per qualifying comment (`SUM(CASE WHEN UpVotes = 0 THEN 1 ELSE 0 END) / COUNT(T1.Id)` over the users-comments join), yielding 1.325 percent, so a user with many high-scoring comments is weighted by comment count.

**To fix it.** Compute a percentage over the joined rows themselves unless the question explicitly says distinct entities; do not insert DISTINCT to de-duplicate a many-to-one join.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: comments, users

**Reference SQL — this is what correct means.**

```sql
SELECT CAST(SUM(CASE WHEN T1.UpVotes = 0 THEN 1 ELSE 0 END) AS REAL) * 100 / NULLIF(COUNT(T1.Id), 0) AS per FROM users AS T1 INNER JOIN comments AS T2 ON T1.Id = T2.UserId WHERE T2.Score BETWEEN 5 AND 10
```

```
1 rows x 1 cols  [per]
    1.3254786450662739
```

**Our SQL — wrong.**

```sql
SELECT 100.0 * COUNT(DISTINCT CASE WHEN u.upvotes = 0 THEN c.userid END) / COUNT(DISTINCT c.userid) AS percentage FROM comments c JOIN users u ON c.userid = u.id WHERE c.score BETWEEN 5 AND 10
```

```
1 rows x 1 cols  [percentage]
    4.8701298701298701
```

**A query that did match, from the `rows-v3` run.**

```sql
SELECT 100.0 * COUNT(*) FILTER (WHERE u.upvotes = 0) / COUNT(*) FROM comments c JOIN users u ON c.userid = u.id WHERE c.score BETWEEN 5 AND 10
```

```
1 rows x 1 cols  [?column?]
    1.3254786450662739
```

</details>

---

### bird-0361 — card_games, simple

**Question.** How many of the banned cards are white border?

**Evidence given with it.** banned card refers to status = 'Banned'; white border refers to borderColor = 'white';

**What we did.** Counted `COUNT(DISTINCT c.uuid)` over the cards-legalities join and returned 89 — one per white-bordered card that is banned somewhere.

**What is expected.** Gold's `COUNT(T1.id)` counts every joined row, returning 258, because one card is banned in several formats and each ban row counts.

**To fix it.** Keep COUNT at the join's natural row grain when gold counts a joined-in id; adding DISTINCT to collapse a one-to-many relation changes the answer.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: cards, legalities

**Reference SQL — this is what correct means.**

```sql
SELECT COUNT(T1.id) FROM cards AS T1 INNER JOIN legalities AS T2 ON T1.uuid = T2.uuid WHERE T2.status = 'Banned' AND T1.borderColor = 'white'
```

```
1 rows x 1 cols  [count]
    258
```

**Our SQL — wrong.**

```sql
SELECT COUNT(DISTINCT c.uuid) FROM cards c JOIN legalities l ON c.uuid = l.uuid WHERE l.status = 'Banned' AND c.bordercolor = 'white'
```

```
1 rows x 1 cols  [count]
    89
```

**A query that did match, from the `rows-v3` run.**

```sql
SELECT COUNT(*) FROM cards c JOIN legalities l ON c.uuid = l.uuid WHERE l.status = 'Banned' AND c.bordercolor = 'white'
```

```
1 rows x 1 cols  [count]
    258
```

</details>

---

### bird-0391 — card_games, moderate

**Question.** What is the percentage of the cards with a converted mana cost of 7 in the set Coldsnap?

**Evidence given with it.** converted mana cost of 7 refers to convertedManaCost = 7; card set Coldsnap refers to name = 'Coldsnap'; percentage = DIVIDE(SUM(convertedManaCost = 7), SUM(convertedManaCost))*100

**What we did.** Divided the count of Coldsnap cards with convertedmanacost = 7 by SUM(c.convertedmanacost), the total of all mana cost values, giving 2.43%.

**What is expected.** Gold divides by COUNT(cards.id), the number of Coldsnap cards, giving 7.74%.

**To fix it.** Translate an evidence formula written as DIVIDE(SUM(x = 7), SUM(x)) into a share of rows — COUNT(*) in the denominator — because summing a numeric column's values is never the denominator of a percentage of cards.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: cards, sets

**Reference SQL — this is what correct means.**

```sql
SELECT CAST(SUM(CASE WHEN T1.convertedManaCost = 7 THEN 1 ELSE 0 END) AS REAL) * 100 / NULLIF(COUNT(T1.id), 0) FROM cards AS T1 INNER JOIN sets AS T2 ON T2.code = T1.setCode WHERE T2.name = 'Coldsnap'
```

```
1 rows x 1 cols  [?column?]
    7.741935483870968
```

**Our SQL — wrong.**

```sql
SELECT SUM(CASE WHEN c.convertedmanacost = 7 THEN 1 ELSE 0 END) * 100.0 / SUM(c.convertedmanacost) FROM "cards" c JOIN "sets" s ON c.setcode = s.code WHERE s.name = 'Coldsnap'
```

```
1 rows x 1 cols  [?column?]
    2.42914979757085
```

**A query that did match, from the `probe` run.**

```sql
SELECT (SUM(CASE WHEN c.convertedmanacost = 7 THEN 1 ELSE 0 END)::float / COUNT(*)) * 100 AS percentage FROM "cards" c JOIN "sets" s ON c.setcode = s.code WHERE s.name = 'Coldsnap'
```

```
1 rows x 1 cols  [percentage]
    7.741935483870968
```

</details>

---

### bird-0461 — california_schools, moderate

**Question.** How many students from the ages of 5 to 17 are enrolled at the State Special School school in Fremont for the 2014-2015 academic year?

**Evidence given with it.** State Special School means EdOpsCode = 'SSS'

**What we did.** Wrapped the answer in SUM(f."Enrollment (Ages 5-17)"), collapsing the two Fremont SSS schools into one row of 375.

**What is expected.** Gold selects "Enrollment (Ages 5-17)" ungrouped and returns both matching rows, 40 and 335.

**To fix it.** Only aggregate when the question asks for a combined total; a filter that legitimately matches several schools should return the column value per row.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: frpm, schools

**Reference SQL — this is what correct means.**

```sql
SELECT T1."Enrollment (Ages 5-17)" FROM frpm AS T1 INNER JOIN schools AS T2 ON T1.CDSCode = T2.CDSCode WHERE T2.EdOpsCode = 'SSS' AND T2.City = 'Fremont' AND T1."Academic Year" = '2014-2015'
```

```
2 rows x 1 cols  [Enrollment (Ages 5-17)]
    40
    335
```

**Our SQL — wrong.**

```sql
SELECT SUM(f."Enrollment (Ages 5-17)") FROM frpm f JOIN schools s ON f.cdscode = s.cdscode WHERE s.edopscode = 'SSS' AND s.city = 'Fremont' AND f."Academic Year" = '2014-2015'
```

```
1 rows x 1 cols  [sum]
    375
```

**A query that did match, from the `rows-v3` run.**

```sql
SELECT f."Enrollment (Ages 5-17)" FROM frpm f JOIN schools s ON f.cdscode = s.cdscode WHERE s.edopscode = 'SSS' AND s.city = 'Fremont' AND f."Academic Year" = '2014-2015'
```

```
2 rows x 1 cols  [Enrollment (Ages 5-17)]
    40
    335
```

</details>

---

### bird-0480 — financial, moderate

**Question.** For loan amount less than USD100,000, what is the percentage of accounts that is still running with no issue.

**Evidence given with it.** Status = 'C' stands for running contract, ok so far; Percentage of accounts by condition = [(total(amount) & condition) / (total amount)] * 100.

**What we did.** Computed a share of loan dollars, SUM(amount WHERE status='C') / SUM(amount) * 100 = 47.5516, over loans under 100000.

**What is expected.** Gold computes a share of loan rows, SUM(CASE WHEN status = 'C' THEN 1 ELSE 0 END) * 100 / COUNT(account_id) = 46.8852.

**To fix it.** "Percentage of accounts" counts rows with a CASE WHEN over COUNT(*), not amounts — do not let the evidence's "total(amount)" wording switch the measure to a money-weighted ratio.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: loan

**Reference SQL — this is what correct means.**

```sql
SELECT CAST(SUM(CASE WHEN status = 'C' THEN 1 ELSE 0 END) AS REAL) * 100 / NULLIF(COUNT(account_id), 0) FROM loan WHERE amount < 100000
```

```
1 rows x 1 cols  [?column?]
    46.885245901639344
```

**Our SQL — wrong.**

```sql
SELECT (SUM(CASE WHEN status='C' THEN amount ELSE 0 END)::numeric / SUM(amount)::numeric) * 100 AS percentage FROM loan WHERE amount < 100000
```

```
1 rows x 1 cols  [percentage]
    47.55164983164983165000
```

**A query that did match, from the `desc-sql` run.**

```sql
SELECT (SUM(CASE WHEN status='C' THEN 1 ELSE 0 END)::float / COUNT(*)) * 100 AS percentage FROM loan WHERE amount < 100000
```

```
1 rows x 1 cols  [percentage]
    46.885245901639344
```

</details>


## Joined through the wrong path (9)

Joined on keys that do not reference each other, or skipped a table that has to sit in the middle. Usually returns zero rows or multiplies them.

### bird-0057 — student_club, simple

**Question.** Which event has the lowest cost?

**Evidence given with it.** event refers to event_name; lowest cost means MIN(cost)

**What we did.** Joined event directly to expense on event.event_id = expense.link_to_budget, equating an event id with a budget id, so nothing matched and 0 rows came back.

**What is expected.** Gold routes event -> budget on budget.link_to_event = event.event_id, then budget -> expense on expense.link_to_budget = budget.budget_id, and returns 'November Speaker'.

**To fix it.** Never equate a link_to_X column with a key from a table it does not reference — expense.link_to_budget points at budget.budget_id, so budget must sit between event and expense in the join path.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: expense, event

**Reference SQL — this is what correct means.**

```sql
SELECT T1.event_name FROM event AS T1 INNER JOIN budget AS T2 ON T1.event_id = T2.link_to_event INNER JOIN expense AS T3 ON T2.budget_id = T3.link_to_budget ORDER BY T3.cost NULLS FIRST LIMIT 1
```

```
1 rows x 1 cols  [event_name]
    November Speaker
```

**Our SQL — wrong.**

```sql
SELECT e.event_name FROM event e JOIN expense ex ON e.event_id = ex.link_to_budget ORDER BY ex.cost ASC LIMIT 1
```

```
0 rows x 1 cols  [event_name]

```

**A query that did match, from the `self` run.**

```sql
SELECT e.event_name FROM event e JOIN budget b ON b.link_to_event = e.event_id JOIN expense ex ON ex.link_to_budget = b.budget_id ORDER BY ex.cost ASC LIMIT 1
```

```
1 rows x 1 cols  [event_name]
    November Speaker
```

</details>

---

### bird-0274 — superhero, challenging

**Question.** Which superhero has the same eyes, hair and skin colour? Indicate the publisher of the superhero.

**Evidence given with it.** which superhero refers to superhero_name; the same eyes, hair and skin colour refers to hair_colour_id = skin_colour_id AND hair_colour_id = eye_colour_id; publisher refers to publisher_name;

**What we did.** Used LEFT JOIN publisher ON s.publisher_id = p.id, so 2 superheroes with matching colour ids but no matching publisher row survived with a NULL publisher_name, giving 159 rows.

**What is expected.** Gold's INNER JOIN to publisher keeps only heroes that have a real publisher row, giving 157 rows.

**To fix it.** Use INNER JOIN when the question asks the query to report an attribute of the joined entity ('indicate the publisher of the superhero'); LEFT JOIN silently admits rows that have no such entity.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: superhero, publisher

**Reference SQL — this is what correct means.**

```sql
SELECT T1.superhero_name, T2.publisher_name FROM superhero AS T1 INNER JOIN publisher AS T2 ON T1.publisher_id = T2.id WHERE T1.eye_colour_id = T1.hair_colour_id AND T1.eye_colour_id = T1.skin_colour_id
```

```
157 rows x 2 cols  [superhero_name, publisher_name]
    Agent Zero | Marvel Comics
    Alex Mercer | Wildstorm
    Alex Woolsly | NBC - Heroes
    Allan Quatermain | Wildstorm
    ... 153 more rows
```

**Our SQL — wrong.**

```sql
SELECT s.superhero_name, p.publisher_name FROM superhero s LEFT JOIN publisher p ON s.publisher_id = p.id WHERE s.hair_colour_id = s.skin_colour_id AND s.hair_colour_id = s.eye_colour_id
```

```
159 rows x 2 cols  [superhero_name, publisher_name]
    Agent Zero | Marvel Comics
    Alex Mercer | Wildstorm
    Alex Woolsly | NBC - Heroes
    Allan Quatermain | Wildstorm
    ... 155 more rows
```

**A query that did match, from the `self` run.**

```sql
SELECT s.superhero_name, p.publisher_name FROM superhero s JOIN publisher p ON s.publisher_id = p.id WHERE s.hair_colour_id = s.skin_colour_id AND s.hair_colour_id = s.eye_colour_id
```

```
157 rows x 2 cols  [superhero_name, publisher_name]
    Agent Zero | Marvel Comics
    Alex Mercer | Wildstorm
    Alex Woolsly | NBC - Heroes
    Allan Quatermain | Wildstorm
    ... 153 more rows
```

</details>

---

### bird-0351 — card_games, moderate

**Question.** Find all cards illustrated by Stephen Daniel and describe the text of the ruling of these cards. State if these cards have missing or degraded properties and values.

**Evidence given with it.** cards have missing or degraded properties and value refers to hasContentWarning = 1; 'Stephen Daniele' is artist; Find all cards refers to return card id

**What we did.** Used `LEFT JOIN rulings r ON c.uuid = r.uuid`, returning 76 rows including Stephen Daniele cards that have no ruling at all (NULL text).

**What is expected.** Gold uses `INNER JOIN rulings`, returning the 23 rows where a ruling actually exists.

**To fix it.** When the question asks to describe a related attribute (the ruling text), require the related row with INNER JOIN instead of padding the result with LEFT-JOIN NULLs.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: cards, rulings

**Reference SQL — this is what correct means.**

```sql
SELECT T1.id, T2.text, T1.hasContentWarning FROM cards AS T1 INNER JOIN rulings AS T2 ON T1.uuid = T2.uuid WHERE T1.artist = 'Stephen Daniele'
```

```
23 rows x 3 cols  [id, text, hascontentwarning]
    29 | You can’t put an Aura card from your han | 0
    3872 | This card now has Enchant Swamp, which w | 0
    6651 | Cycling is an activated ability. Effects | 0
    6652 | Cycling is an activated ability. Effects | 0
    ... 19 more rows
```

**Our SQL — wrong.**

```sql
SELECT c.id, r.text AS ruling_text, c.hascontentwarning FROM "cards" c LEFT JOIN "rulings" r ON c.uuid = r.uuid WHERE c.artist = 'Stephen Daniele'
```

```
76 rows x 3 cols  [id, ruling_text, hascontentwarning]
    29 | You can’t put an Aura card from your han | 0
    3872 | This card now has Enchant Swamp, which w | 0
    6651 | Cycling is an activated ability. Effects | 0
    6652 | Cycling is an activated ability. Effects | 0
    ... 72 more rows
```

**A query that did match, from the `probe` run.**

```sql
SELECT c.id, r.text, c.hascontentwarning FROM cards c JOIN rulings r ON c.uuid = r.uuid WHERE c.artist = 'Stephen Daniele'
```

```
23 rows x 3 cols  [id, text, hascontentwarning]
    29 | You can’t put an Aura card from your han | 0
    3872 | This card now has Enchant Swamp, which w | 0
    6651 | Cycling is an activated ability. Effects | 0
    6652 | Cycling is an activated ability. Effects | 0
    ... 19 more rows
```

</details>

---

### bird-0353 — card_games, moderate

**Question.** Calculate the percentage of the cards availabe in Chinese Simplified.

**Evidence given with it.** Chinese Simplified' is the language; percentage = Divide(Sum(id where language = 'Chinese Simplified'), Count(id)) *100

**What we did.** Computed the percentage over `foreign_data` alone — 20106/229186 = 8.772787 — skipping the cards table entirely.

**What is expected.** Gold's `cards INNER JOIN foreign_data ON uuid` drops the 16 foreign_data rows whose uuid has no matching card, making the denominator 229170 and the answer 8.773400.

**To fix it.** When the evidence names a denominator like `Count(id)` from a specific table, join that table in even if the filtered column lives entirely in the other one — the join is what defines the row population.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: cards, foreign_data

**Reference SQL — this is what correct means.**

```sql
SELECT CAST(SUM(CASE WHEN T2.language = 'Chinese Simplified' THEN 1 ELSE 0 END) AS REAL) * 100 / NULLIF(COUNT(T1.id), 0) FROM cards AS T1 INNER JOIN foreign_data AS T2 ON T1.uuid = T2.uuid
```

```
1 rows x 1 cols  [?column?]
    8.773399659641314
```

**Our SQL — wrong.**

```sql
SELECT (SUM(CASE WHEN language = 'Chinese Simplified' THEN 1 ELSE 0 END)::numeric / COUNT(*)) * 100 FROM "foreign_data"
```

```
1 rows x 1 cols  [?column?]
    8.77278716850069376000
```

</details>

---

### bird-0372 — card_games, challenging

**Question.** What percentage of cards without power are in French?

**Evidence given with it.** in French refers to language = 'French'; cards without power refers to power IS NULL OR power = '*'; percentage = DIVIDE(COUNT(language = 'French' and power is NULL or power = '*'), COUNT( power is NULL or power = '*'))*100

**What we did.** LEFT JOINed cards to foreign_data with no WHERE clause, so power-less cards with no foreign_data row at all stayed in the denominator, giving 11.58%.

**What is expected.** Gold INNER JOINs cards to foreign_data on uuid and filters power IS NULL OR power = '*', so only card-translation pairs count, giving 12.975%.

**To fix it.** Use an INNER JOIN when a percentage is computed over the joined pair — a LEFT JOIN silently keeps unmatched left rows in the denominator and drags the ratio down.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: cards, foreign_data

**Reference SQL — this is what correct means.**

```sql
SELECT CAST(SUM(CASE WHEN T2.language = 'French' THEN 1 ELSE 0 END) AS REAL) * 100 / NULLIF(COUNT(T1.id), 0) FROM cards AS T1 INNER JOIN foreign_data AS T2 ON T1.uuid = T2.uuid WHERE T1.power IS NULL OR T1.power = '*'
```

```
1 rows x 1 cols  [?column?]
    12.975290140452374
```

**Our SQL — wrong.**

```sql
SELECT (SUM(CASE WHEN f.language = 'French' AND (c.power IS NULL OR c.power = '*') THEN 1 ELSE 0 END)::float / NULLIF(SUM(CASE WHEN c.power IS NULL OR c.power = '*' THEN 1 ELSE 0 END), 0)) * 100 AS percentage FROM "cards" c LEFT JOIN "foreign_data" f ON c.uuid = f.uuid
```

```
1 rows x 1 cols  [percentage]
    11.58288545450303
```

**A query that did match, from the `rows-v3` run.**

```sql
SELECT (COUNT(*) FILTER (WHERE f.language = 'French' AND (c.power IS NULL OR c.power = '*')))::float / COUNT(*) FILTER (WHERE c.power IS NULL OR c.power = '*') * 100 AS percentage FROM "cards" c JOIN "foreign_data" f ON c."uuid" = f."uuid"
```

```
1 rows x 1 cols  [percentage]
    12.975290140452374
```

</details>

---

### bird-0432 — toxicology, challenging

**Question.** What is the composition of element chlorine in percentage among the single bond molecules?

**Evidence given with it.** element chlorine refers to element = 'cl'; single bond refers to bond_type = '-'; percentage = DIVIDE(SUM(element = 'cl'), COUNT(atom_id)) as percent where bond_type = '-'

**What we did.** Joined atom to bond through the `connected` link table (a.atom_id = c.atom_id, c.bond_id = b.bond_id), so only atoms that physically sit on a '-' bond were counted, giving 2.0276%.

**What is expected.** Gold joins atom directly to bond on molecule_id, so every atom of any molecule containing a '-' bond is counted once per single bond in that molecule, giving 2.6840%.

**To fix it.** When the question scopes by a molecule-level property ('among the single bond molecules'), join atom to bond on molecule_id instead of routing through `connected`, which silently narrows the population to per-atom bond membership.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: atom, bond, molecule, connected

**Reference SQL — this is what correct means.**

```sql
SELECT CAST(COUNT(CASE WHEN T.element = 'cl' THEN T.atom_id ELSE NULL END) AS REAL) * 100 / NULLIF(COUNT(T.atom_id), 0) FROM (SELECT T1.atom_id, T1.element FROM atom AS T1 INNER JOIN molecule AS T2 ON T1.molecule_id = T2.molecule_id INNER JOIN bond AS T3 ON T2.molecule_id = T3.molecule_id WHERE T3.bond_type = '-') AS T
```

```
1 rows x 1 cols  [?column?]
    2.6840451814272206
```

**Our SQL — wrong.**

```sql
SELECT SUM(CASE WHEN a.element = 'cl' THEN 1 ELSE 0 END) * 100.0 / COUNT(a.atom_id) AS percent FROM "atom" a JOIN "connected" c ON a.atom_id = c.atom_id JOIN "bond" b ON c.bond_id = b.bond_id WHERE b.bond_type = '-'
```

```
1 rows x 1 cols  [percent]
    2.0276378664600284
```

**A query that did match, from the `rows-v3` run.**

```sql
SELECT 100.0 * SUM(CASE WHEN a.element = 'cl' THEN 1 ELSE 0 END) / COUNT(a.atom_id) FROM atom a JOIN bond b ON a.molecule_id = b.molecule_id WHERE b.bond_type = '-'
```

```
1 rows x 1 cols  [?column?]
    2.6840451814272207
```

</details>

---

### bird-0446 — california_schools, moderate

**Question.** What is the average score in writing for the schools that were opened after 1991 or closed before 2000? List the school names along with the score. Also, list the communication number of the schools if there is any.

**Evidence given with it.** Communication number refers to phone number.

**What we did.** INNER JOINed schools to satscores on cdscode = cds, returning only the 813 date-matching schools that happen to have an SAT record.

**What is expected.** Gold LEFT JOINs satscores onto schools, keeping all 8574 schools that pass the opened-after-1991 / closed-before-2000 filter and showing NULL avgscrwrite where no SAT row exists.

**To fix it.** When the question says to list entities 'along with' an attribute and adds 'if there is any', LEFT JOIN the optional table so entities without a match survive.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: schools, satscores

**Reference SQL — this is what correct means.**

```sql
SELECT T2.School, T1.AvgScrWrite, T2.Phone FROM schools AS T2 LEFT JOIN satscores AS T1 ON T2.CDSCode = T1.cds WHERE TO_CHAR(CAST(T2.OpenDate AS TIMESTAMP), 'YYYY') > '1991' OR TO_CHAR(CAST(T2.ClosedDate AS TIMESTAMP), 'YYYY') < '2000'
```

```
8574 rows x 3 cols  [school, avgscrwrite, phone]
    FAME Public Charter | 505 | null
    Envision Academy for Arts & Technology | 395 | (510) 596-8901
    Aspire California College Preparatory Ac | null | null
    Community School for Creative Education | null | (510) 686-4131
    ... 8570 more rows
```

**Our SQL — wrong.**

```sql
SELECT s.school, sc.avgscrwrite, s.phone FROM schools s JOIN satscores sc ON s.cdscode = sc.cds WHERE EXTRACT(YEAR FROM s.opendate) > 1991 OR EXTRACT(YEAR FROM s.closeddate) < 2000
```

```
813 rows x 3 cols  [school, avgscrwrite, phone]
    FAME Public Charter | 505 | null
    Envision Academy for Arts & Technology | 395 | (510) 596-8901
    Aspire California College Preparatory Ac | null | null
    Alameda Science and Technology Institute | 555 | (510) 748-4021
    ... 809 more rows
```

</details>

---

### bird-0493 — financial, moderate

**Question.** What percentage of clients who opened their accounts in the district with an average salary of over 10000 are women?

**Evidence given with it.** Female refers to gender = 'F'; Woman and female are closed; Average salary can be found in A11

**What we did.** Reached district by joining client -> disp -> account -> account.district_id, so it counted one row per disposition of each account in a district with A11 > 10000 and got 50.3881.

**What is expected.** Gold joins client.district_id directly to district and counts client rows, giving 49.6099.

**To fix it.** Resolve "clients in the district" to client.district_id directly; routing through disp and account both swaps in the account's district and fans out one row per disposition.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: client, district, disp, account

**Reference SQL — this is what correct means.**

```sql
SELECT CAST(SUM(CASE WHEN T2.gender = 'F' THEN 1 ELSE 0 END) AS REAL) * 100 / NULLIF(COUNT(T2.client_id), 0) FROM district AS T1 INNER JOIN client AS T2 ON T1.district_id = T2.district_id WHERE T1.A11 > 10000
```

```
1 rows x 1 cols  [?column?]
    49.609984399375975
```

**Our SQL — wrong.**

```sql
SELECT 100.0 * SUM(CASE WHEN c.gender = 'F' THEN 1 ELSE 0 END) / COUNT(*) AS percentage_women FROM client c JOIN disp d ON c.client_id = d.client_id JOIN account a ON d.account_id = a.account_id JOIN district dist ON a.district_id = dist.district_id WHERE dist.a11 > 10000
```

```
1 rows x 1 cols  [percentage_women]
    50.3881987577639752
```

**A query that did match, from the `vote5` run.**

```sql
SELECT 100.0 * SUM(CASE WHEN c.gender = 'F' THEN 1 ELSE 0 END) / COUNT(*) AS percentage_women FROM "client" c JOIN "district" d ON c.district_id = d.district_id WHERE d.a11 > 10000
```

```
1 rows x 1 cols  [percentage_women]
    49.6099843993759750
```

</details>

---

### bird-0497 — financial, moderate

**Question.** Name the account numbers of female clients who are oldest and have lowest average salary?

**Evidence given with it.** Female refers to 'F' in the gender; A11 contains information about average salary

**What we did.** Joined account to client on district_id (a.district_id = c.district_id) with MIN(birth_date) and MIN(a11) subqueries, returning all 49 accounts located in that district.

**What is expected.** Gold links each client to her own account through disp (T4.client_id = T1.client_id AND T4.account_id = T3.account_id) and takes ORDER BY birth_date ASC, A11 ASC LIMIT 1, returning the single account_id 1743.

**To fix it.** Connect a client to an account only through disp, never by matching district_id, and express "oldest / lowest" as ORDER BY ... LIMIT 1 rather than MIN() subqueries that can match many rows.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: client, district, account

**Reference SQL — this is what correct means.**

```sql
SELECT T3.account_id FROM client AS T1 INNER JOIN district AS T2 ON T1.district_id = T2.district_id INNER JOIN account AS T3 ON T2.district_id = T3.district_id INNER JOIN disp AS T4 ON T1.client_id = T4.client_id AND T4.account_id = T3.account_id WHERE T1.gender = 'F' ORDER BY T1.birth_date ASC NULLS FIRST, T2.A11 ASC NULLS FIRST LIMIT 1
```

```
1 rows x 1 cols  [account_id]
    1743
```

**Our SQL — wrong.**

```sql
SELECT a.account_id FROM client c JOIN district d ON c.district_id = d.district_id JOIN account a ON a.district_id = c.district_id WHERE c.gender = 'F' AND c.birth_date = (SELECT MIN(c2.birth_date) FROM client c2 WHERE c2.gender = 'F') AND d.a11 = (SELECT MIN(d2.a11) FROM district d2 JOIN client c3 ON c3.district_id = d2.district_id WHERE c3.gender = 'F' AND c3.birth_date = (SELECT MIN(c4.birth_date) FROM client c4 WHERE c4.gender = 'F'))
```

```
49 rows x 1 cols  [account_id]
    6
    142
    361
    463
    ... 45 more rows
```

**A query that did match, from the `rows-v3` run.**

```sql
SELECT a.account_id FROM client c JOIN disp d ON c.client_id = d.client_id JOIN account a ON d.account_id = a.account_id JOIN district dist ON c.district_id = dist.district_id WHERE c.gender = 'F' ORDER BY c.birth_date ASC, dist.a11 ASC LIMIT 1
```

```
1 rows x 1 cols  [account_id]
    1743
```

</details>


## Filter value does not match stored data (7)

The right column, the wrong spelling of the value. Casing, format, or a label where the database stores a code.

### bird-0063 — student_club, moderate

**Question.** Indicate the cost of posters for 'September Speaker' event.

**Evidence given with it.** 'Posters' is the expense description; 'September Speaker' is an event name

**What we did.** Filtered budget.category = 'Posters' for event 'September Speaker' and got 0 rows because no budget row carries that category value.

**What is expected.** 'Posters' is stored in expense.expense_description; the matching budget row's category is 'Advertisement', and the cost for that line is 67.81.

**To fix it.** Before writing an equality filter, confirm which column actually stores the quoted word — here 'Posters' lives in expense.expense_description (reached via expense.link_to_budget = budget.budget_id), not in budget.category.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: budget, event

**Reference SQL — this is what correct means.**

```sql
SELECT T3.cost FROM event AS T1 INNER JOIN budget AS T2 ON T1.event_id = T2.link_to_event INNER JOIN expense AS T3 ON T2.budget_id = T3.link_to_budget WHERE T1.event_name = 'September Speaker' AND T3.expense_description = 'Posters'
```

```
1 rows x 1 cols  [cost]
    67.81
```

**Our SQL — wrong.**

```sql
SELECT b.spent FROM "budget" b JOIN "event" e ON b.link_to_event = e.event_id WHERE b.category = 'Posters' AND e.event_name = 'September Speaker'
```

```
0 rows x 1 cols  [spent]

```

**A query that did match, from the `values-sql` run.**

```sql
SELECT b.spent FROM "budget" b JOIN "event" e ON b.link_to_event = e.event_id WHERE e.event_name = 'September Speaker' AND b.category = 'Advertisement'
```

```
1 rows x 1 cols  [spent]
    67.81
```

</details>

---

### bird-0080 — thrombosis_prediction, moderate

**Question.** What is the ratio of outpatient to inpatient followed up treatment among all the 'SLE' diagnosed patient?

**Evidence given with it.** 'SLE' diagnosed patient means Diagnosis = 'SLE'; inpatient refers to Admission = '+'; outpatient refers to Admission = '-'; calculation =  DIVIDE(COUNT(ID) where Diagnosis = 'SLE' and Admission = '+', COUNT(ID) where Diagnosis = 'SLE' and Admission = '-')

**What we did.** Put Admission = '-' in the numerator and Admission = '+' in the denominator for Diagnosis = 'SLE' patients, returning 0.7636363636363637.

**What is expected.** Gold follows the evidence's formula with '+' on top and '-' on the bottom, returning 1.3095238095238095.

**To fix it.** When the evidence supplies an explicit DIVIDE(A, B) formula, bind the literals to numerator and denominator exactly as written even when the question's phrasing ('outpatient to inpatient') suggests the opposite order.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: patient

**Reference SQL — this is what correct means.**

```sql
SELECT SUM(CASE WHEN Admission = '+' THEN 1.0 ELSE 0 END) / NULLIF(SUM(CASE WHEN Admission = '-' THEN 1 ELSE 0 END), 0) FROM Patient WHERE Diagnosis = 'SLE'
```

```
1 rows x 1 cols  [?column?]
    1.3095238095238095
```

**Our SQL — wrong.**

```sql
SELECT CAST(COUNT(CASE WHEN "admission" = '-' THEN 1 END) AS FLOAT) / NULLIF(COUNT(CASE WHEN "admission" = '+' THEN 1 END), 0) AS ratio FROM "patient" WHERE "diagnosis" = 'SLE'
```

```
1 rows x 1 cols  [ratio]
    0.7636363636363637
```

</details>

---

### bird-0125 — thrombosis_prediction, moderate

**Question.** Among the patients who has a normal level of anti-centromere and a normal level of anti-SSB, how many of them are male?

**Evidence given with it.** normal level of anti-centromere refers to CENTROMEA IN('-', '+-'); normal level of anti-SSB refers to SSB IN('-', '+-'); male refers to Sex = 'M'; Should consider DISTINCT in the final result;

**What we did.** Filtered laboratory.CENTROMEA IN ('-','+-') AND laboratory.SSB IN ('-','+-') exactly as the evidence spelled the codes, matching no rows and counting 0 males.

**What is expected.** Those two columns store the strings 'negative' and '0' in this Postgres load, so gold filters IN ('negative','0') and counts 1 male patient; our DISTINCT-count structure was otherwise identical to gold's.

**To fix it.** Sample the actual distinct values of a text column (e.g. from the schema's sample rows) before writing an equality or IN filter, rather than trusting the codes quoted in the evidence.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: patient, laboratory

**Reference SQL — this is what correct means.**

```sql
SELECT COUNT(DISTINCT T1.ID) FROM Patient AS T1 INNER JOIN Laboratory AS T2 ON T1.ID = T2.ID WHERE T2.CENTROMEA IN ('negative', '0') AND T2.SSB IN ('negative', '0') AND T1.SEX = 'M'
```

```
1 rows x 1 cols  [count]
    1
```

**Our SQL — wrong.**

```sql
SELECT COUNT(DISTINCT p.id) FROM "patient" p JOIN "laboratory" l ON p.id = l.id WHERE p.sex = 'M' AND l."centromea" IN ('-', '+-') AND l."ssb" IN ('-', '+-')
```

```
1 rows x 1 cols  [count]
    0
```

</details>

---

### bird-0229 — formula_1, simple

**Question.** List out the code for drivers who have nationality in America.

**Evidence given with it.** nationality = 'America'

**What we did.** Filtered drivers.nationality = 'America', copying the evidence string verbatim, and got 0 rows.

**What is expected.** The column stores the demonym 'American', which gold matches to return 157 code values.

**To fix it.** Treat evidence literals as approximate labels and check the column's actual stored values (nationality is stored as a demonym: 'American', 'German', 'British') before writing an equality filter.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: drivers

**Reference SQL — this is what correct means.**

```sql
SELECT code FROM drivers WHERE Nationality = 'American'
```

```
157 rows x 1 cols  [code]
    SPE
    null
    null
    null
    ... 153 more rows
```

**Our SQL — wrong.**

```sql
SELECT "code" FROM "drivers" WHERE "nationality" = 'America'
```

```
0 rows x 1 cols  [code]

```

**A query that did match, from the `self` run.**

```sql
SELECT "code" FROM "drivers" WHERE "nationality" = 'American'
```

```
157 rows x 1 cols  [code]
    SPE
    null
    null
    null
    ... 153 more rows
```

</details>

---

### bird-0316 — codebase_community, moderate

**Question.** Who is the owner of the post titled 'Open source tools for visualizing multi-dimensional data?'

**Evidence given with it.** 'Open source tools for visualizing multi-dimensional data' is the Title of Post; owner refers to DisplayName;

**What we did.** Filtered posts.title = 'Open source tools for visualizing multi-dimensional data' and got 0 rows.

**What is expected.** The stored title ends with a question mark — gold matches 'Open source tools for visualizing multi-dimensional data?' and returns 'Paul'.

**To fix it.** Copy a quoted title literal verbatim including trailing punctuation; do not strip a '?' on the assumption it belongs to the surrounding question sentence.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: posts, users

**Reference SQL — this is what correct means.**

```sql
SELECT T2.DisplayName FROM posts AS T1 INNER JOIN users AS T2 ON T1.OwnerUserId = T2.Id WHERE T1.Title = 'Open source tools for visualizing multi-dimensional data?'
```

```
1 rows x 1 cols  [displayname]
    Paul
```

**Our SQL — wrong.**

```sql
SELECT u."displayname" FROM "posts" p JOIN "users" u ON p."owneruserid" = u."id" WHERE p."title" = 'Open source tools for visualizing multi-dimensional data'
```

```
0 rows x 1 cols  [displayname]

```

**A query that did match, from the `probe` run.**

```sql
SELECT u."displayname" FROM "posts" p JOIN "users" u ON p."owneruserid" = u."id" WHERE p."title" = 'Open source tools for visualizing multi-dimensional data?'
```

```
1 rows x 1 cols  [displayname]
    Paul
```

</details>

---

### bird-0337 — codebase_community, moderate

**Question.** Identify the total views on the post 'Computer Game Datasets'. Name the user who posted it last time.

**Evidence given with it.** total views refer to ViewCount; Name the user refers to DisplayName; post 'Computer Game Datasets' refers to Text = 'Computer Game Datasets';

**What we did.** Filtered `posts.title = 'Computer Game Datasets'` with the question's capitalization and got 0 rows.

**What is expected.** The title is stored as `Computer game datasets`, so a case-insensitive match (ILIKE) or gold's `postHistory.text` lookup returns viewcount 1708 and displayname mbq.

**To fix it.** For an equality filter on a free-text title copied verbatim from the question, verify the stored casing first or match case-insensitively.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: posts, users

**Reference SQL — this is what correct means.**

```sql
SELECT T2.ViewCount, T3.DisplayName FROM postHistory AS T1 INNER JOIN posts AS T2 ON T1.PostId = T2.Id INNER JOIN users AS T3 ON T2.LastEditorUserId = T3.Id WHERE T1.Text = 'Computer Game Datasets'
```

```
1 rows x 2 cols  [viewcount, displayname]
    1708 | mbq
```

**Our SQL — wrong.**

```sql
SELECT p.viewcount, u.displayname FROM posts p LEFT JOIN users u ON p.lasteditoruserid = u.id WHERE p.title = 'Computer Game Datasets'
```

```
0 rows x 2 cols  [viewcount, displayname]

```

**A query that did match, from the `probe` run.**

```sql
SELECT p.viewcount, u.displayname FROM posts p LEFT JOIN users u ON p.lasteditoruserid = u.id WHERE p.title ILIKE 'Computer Game Datasets'
```

```
1 rows x 2 cols  [viewcount, displayname]
    1708 | mbq
```

</details>

---

### bird-0365 — card_games, moderate

**Question.** How many Brazilian Portuguese translated sets are inside the Commander block?

**Evidence given with it.** Commander block refer to block = 'Commander'; sets refer to code = setCode; Portuguese refer to language = 'Portuguese (Brasil)'

**What we did.** Filtered `set_translations.language = 'Portuguese (Brasil)'`, copying the evidence hint verbatim, and got 0.

**What is expected.** The column stores `Portuguese (Brazil)` with a z, which with `sets.block = 'Commander'` returns 7.

**To fix it.** Treat literals in the evidence hint as approximate — check the column's actual distinct values before writing an equality filter, and fall back to a fuzzy match when the exact literal returns nothing.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: set_translations, sets

**Reference SQL — this is what correct means.**

```sql
SELECT COUNT(T1.id) FROM sets AS T1 INNER JOIN set_translations AS T2 ON T1.code = T2.setCode WHERE T2.language = 'Portuguese (Brazil)' AND T1.block = 'Commander'
```

```
1 rows x 1 cols  [count]
    7
```

**Our SQL — wrong.**

```sql
SELECT COUNT(*) FROM set_translations st JOIN sets s ON st.setcode = s.code WHERE s.block = 'Commander' AND st.language = 'Portuguese (Brasil)'
```

```
1 rows x 1 cols  [count]
    0
```

**A query that did match, from the `values-sql` run.**

```sql
SELECT COUNT(*) FROM set_translations st JOIN sets s ON st.setcode = s.code WHERE st.language = 'Portuguese (Brazil)' AND s.block = 'Commander'
```

```
1 rows x 1 cols  [count]
    7
```

</details>


## Query failed to execute (6)

Postgres rejected it.

### bird-0045 — student_club, simple

**Question.** State the date Connor Hilton paid his/her dues.

**Evidence given with it.** Connor Hilton is the full name; full name refers to first_name, last_name; date the dues was paid refers to date_received where source = 'Dues';

**What we did.** Selected b.date_received from budget joined on b.link_to_member, and Postgres raised 42703: column b.link_to_member does not exist.

**What is expected.** Gold joins member to income on income.link_to_member = member.member_id, filters source = 'Dues', and returns income.date_received ('2019-10-02', '2019-09-12').

**To fix it.** Dues payments live in income (link_to_member, source, date_received) — check the join column actually exists on the table in the schema before emitting the query instead of assuming budget carries member links.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: member, expense

**Reference SQL — this is what correct means.**

```sql
SELECT T2.date_received FROM member AS T1 INNER JOIN income AS T2 ON T1.member_id = T2.link_to_member WHERE T1.first_name = 'Connor' AND T1.last_name = 'Hilton' AND T2.source = 'Dues'
```

```
2 rows x 1 cols  [date_received]
    2019-10-02
    2019-09-12
```

**Our SQL — wrong.**

```sql
SELECT b.date_received FROM budget b JOIN member m ON b.link_to_member = m.member_id WHERE b.source = 'Dues' AND m.first_name = 'Connor' AND m.last_name = 'Hilton'
```

```
ERROR 42703: column b.link_to_member does not exist
```

**A query that did match, from the `rows-v3` run.**

```sql
SELECT i.date_received FROM income i JOIN member m ON i.link_to_member = m.member_id WHERE m.first_name = 'Connor' AND m.last_name = 'Hilton' AND i.source = 'Dues'
```

```
2 rows x 1 cols  [date_received]
    2019-10-02
    2019-09-12
```

</details>

---

### bird-0084 — thrombosis_prediction, simple

**Question.** For patients with severe degree of thrombosis, list their ID, sex and disease the patient is diagnosed with.

**Evidence given with it.** severe degree of thrombosis refers to thrombosis = 2; disease refers to diagnosis;

**What we did.** Wrote e."ID" and e."Thrombosis" as quoted mixed-case identifiers on the examination table and Postgres raised 42703: column e.ID does not exist.

**What is expected.** Those columns are stored lowercase as examination.id and examination.thrombosis, and the query should return 3 DISTINCT rows of patient id, sex, diagnosis.

**To fix it.** Take the exact spelling of every quoted identifier from information_schema — examination keeps mixed case only for names like "Examination Date", while id and thrombosis are plain lowercase.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: patient

**Reference SQL — this is what correct means.**

```sql
SELECT DISTINCT T1.ID, T1.SEX, T1.Diagnosis FROM Patient AS T1 INNER JOIN Examination AS T2 ON T1.ID = T2.ID WHERE T2.Thrombosis = 2
```

```
3 rows x 3 cols  [id, sex, diagnosis]
    163109 | F | SLE
    2803470 | F | SLE
    4395720 | F | SLE
```

**Our SQL — wrong.**

```sql
SELECT p."id", p."sex", p."diagnosis" FROM "patient" p JOIN "examination" e ON p."id" = e."ID" WHERE e."Thrombosis" = 2
```

```
ERROR 42703: column e.ID does not exist
```

**A query that did match, from the `expand` run.**

```sql
SELECT DISTINCT p.id, p.sex, p.diagnosis FROM patient p JOIN examination e ON p.id = e.id WHERE e.thrombosis = 2
```

```
3 rows x 3 cols  [id, sex, diagnosis]
    163109 | F | SLE
    2803470 | F | SLE
    4395720 | F | SLE
```

</details>

---

### bird-0093 — thrombosis_prediction, challenging

**Question.** For the patient who was born on 1959/2/18, what is the decrease rate for his/her total cholesterol from November to December in 1981?

**Evidence given with it.** born on 1959/2/18 refers to Birthday = '1959-02-18'; calculation = DIVISION(SUBTRACT(SUM(Birthday = '1959-02-18' and Date like '1981-11-%' THEN `T-CHO`), SUM(Birthday = '1959-02-18' and Date like '1981-12-%' THEN `T-CHO`)), SUM(Birthday = '1959-02-18' and Date like '1981-12-%' THEN `T-CHO`))

**What we did.** Applied LIKE '1981-11-%' directly to laboratory.date, which is a real Postgres date column, so the query aborted with 42883 operator does not exist: date ~~ unknown and returned nothing.

**What is expected.** Gold casts the column to text first (T2.date::text LIKE '1981-11-%') and wraps the December sum in NULLIF(...,0), yielding 0.06030150753768844.

**To fix it.** Read each column's declared type from information_schema and emit ::text before any LIKE on a date/timestamp column instead of assuming date columns behave like strings.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: patient, laboratory

**Reference SQL — this is what correct means.**

```sql
SELECT CAST((SUM(CASE WHEN T2.date::text LIKE '1981-11-%' THEN T2."T-CHO" ELSE 0 END) - SUM(CASE WHEN T2.date::text LIKE '1981-12-%' THEN T2."T-CHO" ELSE 0 END)) AS REAL) / NULLIF(SUM(CASE WHEN T2.date::text LIKE '1981-12-%' THEN T2."T-CHO" ELSE 0 END), 0) FROM Patient AS T1 INNER JOIN Laboratory AS T2 ON T1.ID = T2.ID WHERE T1.Birthday = '1959-02-18'
```

```
1 rows x 1 cols  [?column?]
    0.06030150753768844
```

**Our SQL — wrong.**

```sql
SELECT (SUM(CASE WHEN l."date" LIKE '1981-11-%' THEN l."T-CHO" ELSE 0 END) - SUM(CASE WHEN l."date" LIKE '1981-12-%' THEN l."T-CHO" ELSE 0 END))::float / SUM(CASE WHEN l."date" LIKE '1981-12-%' THEN l."T-CHO" ELSE 0 END) AS decrease_rate FROM "laboratory" l JOIN "patient" p ON l."id" = p."id" WHERE p."birthday" = '1959-02-18'
```

```
ERROR 42883: operator does not exist: date ~~ unknown
```

**A query that did match, from the `rows-v3` run.**

```sql
SELECT (SUM(CASE WHEN l.date::text LIKE '1981-11-%' THEN l."T-CHO" END) - SUM(CASE WHEN l.date::text LIKE '1981-12-%' THEN l."T-CHO" END))::float / NULLIF(SUM(CASE WHEN l.date::text LIKE '1981-12-%' THEN l."T-CHO" END),0) AS decrease_rate FROM laboratory l JOIN patient p ON l.id = p.id WHERE p.birthday = '1959-02-18'
```

```
1 rows x 1 cols  [decrease_rate]
    0.06030150753768844
```

</details>

---

### bird-0096 — thrombosis_prediction, challenging

**Question.** List all patients who were followed up at the outpatient clinic who underwent a laboratory test in October 1991 and had a total blood bilirubin level within the normal range.

**Evidence given with it.** followed up at the outpatient clinic refers to Admission = '-'; laboratory test in April 1981 refers to Date like '1991-10%'; blood bilirubin level within the normal range refers to T-BIL < 2.0;

**What we did.** Wrote l."date" LIKE '1991-10%' against the date-typed laboratory.date column and crashed with 42883 operator does not exist: date ~~ unknown.

**What is expected.** Gold writes T2.Date::text LIKE '1991-10-%'; every other part of our query (DISTINCT id, admission = '-', T-BIL < 2.0) already matches gold's 6 rows.

**To fix it.** Cast date/timestamp columns to text before LIKE — the same one-character fix (::text) turns this exact query into a pass, as the rows-v3 run showed.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: patient, laboratory

**Reference SQL — this is what correct means.**

```sql
SELECT DISTINCT T1.ID FROM Patient AS T1 INNER JOIN Laboratory AS T2 ON T1.ID = T2.ID WHERE T1.Admission = '-' AND T2."T-BIL" < 2.0 AND T2.Date::text LIKE '1991-10-%'
```

```
6 rows x 1 cols  [id]
    304157
    4466840
    4471732
    4630092
    ... 2 more rows
```

**Our SQL — wrong.**

```sql
SELECT DISTINCT p."id" FROM "patient" p JOIN "laboratory" l ON p."id" = l."id" WHERE p."admission" = '-' AND l."date" LIKE '1991-10%' AND l."T-BIL" < 2.0
```

```
ERROR 42883: operator does not exist: date ~~ unknown
```

**A query that did match, from the `rows-v3` run.**

```sql
SELECT DISTINCT p."id" FROM "patient" p JOIN "laboratory" l ON p."id" = l."id" WHERE p."admission" = '-' AND l."date"::text LIKE '1991-10%' AND l."T-BIL" < 2.0
```

```
6 rows x 1 cols  [id]
    304157
    4466840
    4471732
    4630092
    ... 2 more rows
```

</details>

---

### bird-0099 — thrombosis_prediction, moderate

**Question.** What percentage of patients who were born in 1980 and were diagnosed with RA are women?

**Evidence given with it.** born in 1980 refers to YEAR(BIRTHDAY) = '1980'; 'RA' refers to Diagnosis='RA' ; women refers to SEX = 'F'; calculation = DIVIDE(SUM(SEX = 'F'), COUNT(SEX)) * 100

**What we did.** Copied the evidence's pseudo-function verbatim and called DIVIDE(SUM(CASE WHEN sex='F' THEN 1 ELSE 0 END), COUNT(sex)), which Postgres has no such function for, failing with 42883 function divide(bigint, bigint) does not exist.

**What is expected.** Gold expresses the same ratio in real SQL: CAST(SUM(CASE WHEN SEX='F' THEN 1 ELSE 0 END) AS REAL) * 100 / NULLIF(COUNT(ID), 0), returning 100.

**To fix it.** Treat DIVIDE/SUBTRACT/MULTIPLY in the evidence as pseudocode and translate them into Postgres operators (a float-cast numerator over NULLIF(denominator,0)), never emit them as function calls.

*Answered differently across identical runs, so partly luck. Verify a fix over several runs.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: patient

**Reference SQL — this is what correct means.**

```sql
SELECT CAST(SUM(CASE WHEN SEX = 'F' THEN 1 ELSE 0 END) AS REAL) * 100 / NULLIF(COUNT(ID), 0) FROM Patient WHERE Diagnosis = 'RA' AND TO_CHAR(CAST(Birthday AS TIMESTAMP), 'YYYY') = '1980'
```

```
1 rows x 1 cols  [?column?]
    100
```

**Our SQL — wrong.**

```sql
SELECT DIVIDE(SUM(CASE WHEN sex='F' THEN 1 ELSE 0 END), COUNT(sex)) * 100 FROM "patient" WHERE EXTRACT(YEAR FROM "birthday") = 1980 AND diagnosis = 'RA'
```

```
ERROR 42883: function divide(bigint, bigint) does not exist
```

**A query that did match, from the `self` run.**

```sql
SELECT (SUM(CASE WHEN sex='F' THEN 1 ELSE 0 END)::float / COUNT(sex)) * 100 FROM "patient" WHERE EXTRACT(YEAR FROM birthday) = 1980 AND diagnosis = 'RA'
```

```
1 rows x 1 cols  [?column?]
    100
```

</details>

---

### bird-0266 — superhero, moderate

**Question.** Provide the hair colour of the human superhero who is 185 cm tall.

**Evidence given with it.** 185 cm tall refers to height_cm = 185; human superhero refers to race = 'human'; hair colour refers to colour where hair_colour_id = colour.id;

**What we did.** Selected c.colour_name after joining the colour table and the query failed with Postgres 42703, column c.colour_name does not exist.

**What is expected.** The colour table has exactly two columns, id and colour, and gold selects DISTINCT colour.colour for human superheroes 185 cm tall.

**To fix it.** The picker put only superhero and attribute in the prompt, so colour and race columns had to be guessed - render the real columns of every table the model may join, or reject SQL that names a column absent from the rendered schema.

*Fails every time — a real defect, not run-to-run variance.*

<details>
<summary>Queries and results</summary>

Tables sent to the model: superhero, attribute

**Reference SQL — this is what correct means.**

```sql
SELECT DISTINCT T3.colour FROM superhero AS T1 INNER JOIN race AS T2 ON T1.race_id = T2.id INNER JOIN colour AS T3 ON T1.hair_colour_id = T3.id WHERE T1.height_cm = 185 AND T2.race = 'Human'
```

```
5 rows x 1 cols  [colour]
    Black
    Blond
    Brown
    Brown/White
    ... 1 more rows
```

**Our SQL — wrong.**

```sql
SELECT c."colour_name" FROM "superhero" s JOIN "race" r ON s."race_id" = r."id" JOIN "colour" c ON s."hair_colour_id" = c."id" WHERE r."race" = 'Human' AND s."height_cm" = 185
```

```
ERROR 42703: column c.colour_name does not exist
```

**A query that did match, from the `rows-v3` run.**

```sql
SELECT c."colour" FROM "superhero" s JOIN "race" r ON s."race_id" = r."id" JOIN "colour" c ON s."hair_colour_id" = c."id" WHERE r."race" = 'Human' AND s."height_cm" = 185
```

```
11 rows x 1 cols  [colour]
    Blond
    Brown
    Brown
    Black
    ... 7 more rows
```

</details>

