# The 21 winnable failures

Every question the current default (72.4%) gets wrong **and** a known mechanism
could still win. This is the work list.

> **Provenance (2026-08-01, evening).** This file held 99 entries when it was
> built against the 61.0% run. Three promoted changes since — Batch G, the
> evidence-union, the v5 bundle — fixed 59 of them; those entries are deleted
> (git history keeps every one). 19 more were reclassified as dead after the v6
> experiment measured their fixes as net losses — each is matchable on its own,
> but every rule that converted one broke a mirror question that reads the same
> way. They are deleted too, and counted in the README's out-of-reach box. For
> the record, the 19 and why:
>
> - **0281, 0353, 0391, 0480** — hint-vs-English contradictions. Gold follows
>   the hint on one question and the English on its mirror; v6's rule won 0281's
>   reading and broke 0080 with it.
> - **0249, 0441, 0273, 0308** — gold output conventions (rank columns, id vs
>   name, label vs boolean) knowable only by peeking at the answer; v6's rank
>   rule bled into passing questions instead.
> - **0120, 0361, 0127** — counting convention. Gold counts join rows here and
>   distinct entities on twin questions; a rule picking either side trades
>   wins for losses (prompt v3, measured tie). 0127 joined this bucket on
>   2026-08-01: the evidence-union now sends it the examination table and the
>   current SQL carries the coagulation filter, so the only gap left is
>   `COUNT(DISTINCT id)` = 1 against gold's join-row `COUNT(T1.ID)` = 7.
> - **0351, 0446** — the same English cue maps to opposite joins: "find all
>   cards and their rulings" gets INNER, "list schools with the phone if any"
>   gets LEFT. A rule for one breaks the other.
> - **0075, 0138, 0152, 0218, 0319, 0461** — residue. Four (0075, 0138, 0319,
>   0461) got their own targeted v6 rule and did not convert cleanly; 0218's
>   gold contradicts its own evidence; 0152 needs a keep-ties shape that 83
>   other golds punish.
>
> Entry bodies below are kept verbatim from when the list was built (the 61.0%
> run) and stamped per later run — the "What we did" text describes that run's
> SQL, not necessarily the current default's.

## Read this first

The current default answers 500 questions and gets **362 right** (the
2026-08-01 v5-bundle run). Of the 138 it gets wrong:

- **116 are out of reach.** 97 could never be scored correct — broken reference
  SQL or an unguessable output format. 19 more are the measured dead ends
  listed above.
- **21 are winnable.** They are all here.
- **1 is churn** — a question that passes in most runs and happened to fail in
  this one. In neither list.

So the ceiling on this benchmark is **384 of 500, 76.8%**, and the live
headroom over the current 362 is these 21 questions — about 4.2 points.

## How grading works

A query is correct when it returns **the same rows** as the reference query.

- Row order is ignored.
- Column order **matters**.
- Column names are never compared.
- Duplicate rows are ignored — two rows or ten of the same values are the same answer.
- Numbers are compared to 6 decimal places.

The practical consequence: returning one extra column makes an otherwise perfect
answer wrong.

## Where the entries came from

Built from the 61.0% run (`runs/2026-07-31-152120-exp-rows-full.json`); every
query was re-executed against the live database while writing, so results shown
were current then. Status stamps were added per later run. To reproduce the
current default:

```bash
PICKER=llm npm run eval:hard
```

---

## Agent-reachable (8)

The answer is knowable from the data, and only a per-question lookup can know
it. Five are twin-column traps — two near-identical columns or tables
(`type` vs `types`, a cost stored in two tables) where the question's words
do not pick one and static sample rows make both look plausible; one SELECT on
each candidate would show which column actually holds the value. 0225 needs the
stored value format read off real rows. 0494 and 0432 need a schema fact
(a filter value, the right of two join paths) the data hints at.

### bird-0023 — debit_card_specializing, simple

**Status: still failing in the 2026-08-01 `union` run (68.8%).**
**Status: still failing in the 2026-08-01 `v5-bundle` run (72.4%).**

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

### bird-0366 — card_games, moderate

**Status: passing in the 2026-08-01 `union` run (68.8%).**
**Status: still failing in the 2026-08-01 `v5-bundle` run (72.4%).**

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

**Status: still failing in the 2026-08-01 `union` run (68.8%).**
**Status: still failing in the 2026-08-01 `v5-bundle` run (72.4%).**

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

**Status: passing in the 2026-08-01 `union` run (68.8%).**
**Status: still failing in the 2026-08-01 `v5-bundle` run (72.4%).**

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

### bird-0447 — california_schools, challenging

**Status: still failing in the 2026-08-01 `union` run (68.8%).**
**Status: still failing in the 2026-08-01 `v5-bundle` run (72.4%).**

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

### bird-0225 — formula_1, simple

**Status: still failing in the 2026-08-01 `union` run (68.8%).**
**Status: still failing in the 2026-08-01 `v5-bundle` run (72.4%).**

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

### bird-0494 — financial, challenging

**Status: still failing in the 2026-08-01 `union` run (68.8%).**
**Status: still failing in the 2026-08-01 `v5-bundle` run (72.4%).**

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

---

### bird-0432 — toxicology, challenging

**Status: still failing in the 2026-08-01 `union` run (68.8%).**
**Status: still failing in the 2026-08-01 `v5-bundle` run (72.4%).**

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

## Pipeline-fixable, below the noise band (3)

Each has a known, measured-safe fix. 0462 and 0372 converted in the v6
experiment with no traced collateral damage; 0058 joined them on 2026-08-01
(see its entry). But 3 of 500 is 0.6 points against a ±2.5-point noise band, so
a run claiming them cannot prove itself on the headline — it is judged by these
three ids converting with no regressions elsewhere.

### bird-0058 — student_club, moderate

**Status: still failing in the 2026-08-01 `union` run (68.8%).**
**Status: still failing in the 2026-08-01 `v5-bundle` run (72.4%).**

**Reclassified 2026-08-01: pipeline-fixable, not agent-reachable.** The
twin-column half of this is fixed — the current default is sent the expense
table and sums `ex.cost`. What is left is float precision: ours divides then
multiplies (21.530166268348694), gold multiplies then divides
(21.530166915170767). They diverge at the 6th decimal, exactly where the
comparator stops. The v6 rule "multiply before dividing when computing a
percentage" converts it.

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

### bird-0462 — california_schools, moderate

**Status: still failing in the 2026-08-01 `union` run (68.8%).**
**Status: still failing in the 2026-08-01 `v5-bundle` run (72.4%).**

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

### bird-0372 — card_games, challenging

**Status: passing in the 2026-08-01 `union` run (68.8%).**
**Status: still failing in the 2026-08-01 `v5-bundle` run (72.4%).**

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

## Re-roll only (10)

No mechanism exists. Each fails because the model ignores a rule it usually
follows — an extra column, wrong column order — roughly 10% of the time. v6
measured that pushing harder in the prompt breaks as many questions as it
fixes, and best-of-5 voting measured a tie. These flip in and out on their own.

### bird-0013 — debit_card_specializing, simple

**Status: still failing in the 2026-08-01 `union` run (68.8%).**
**Status: still failing in the 2026-08-01 `v5-bundle` run (72.4%).**

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

### bird-0029 — debit_card_specializing, moderate

**Status: still failing in the 2026-08-01 `union` run (68.8%).**
**Status: still failing in the 2026-08-01 `v5-bundle` run (72.4%).**

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

**Status: still failing in the 2026-08-01 `union` run (68.8%).**
**Status: still failing in the 2026-08-01 `v5-bundle` run (72.4%).**

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

### bird-0109 — thrombosis_prediction, moderate

**Status: still failing in the 2026-08-01 `union` run (68.8%).**
**Status: still failing in the 2026-08-01 `v5-bundle` run (72.4%).**

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

### bird-0199 — formula_1, moderate

**Status: still failing in the 2026-08-01 `union` run (68.8%).**
**Status: still failing in the 2026-08-01 `v5-bundle` run (72.4%).**

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

### bird-0236 — formula_1, challenging

**Status: still failing in the 2026-08-01 `union` run (68.8%).**
**Status: still failing in the 2026-08-01 `v5-bundle` run (72.4%).**

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

### bird-0323 — codebase_community, moderate

**Status: still failing in the 2026-08-01 `union` run (68.8%).**
**Status: still failing in the 2026-08-01 `v5-bundle` run (72.4%).**

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

### bird-0449 — california_schools, moderate

**Status: passing in the 2026-08-01 `union` run (68.8%).**
**Status: still failing in the 2026-08-01 `v5-bundle` run (72.4%).**

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

### bird-0459 — california_schools, simple

**Status: passing in the 2026-08-01 `union` run (68.8%).**
**Status: still failing in the 2026-08-01 `v5-bundle` run (72.4%).**

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

### bird-0466 — california_schools, moderate

**Status: still failing in the 2026-08-01 `union` run (68.8%).**
**Status: still failing in the 2026-08-01 `v5-bundle` run (72.4%).**

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
