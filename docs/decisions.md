# Settled decisions

Every open question in `PLAN.md` that was resolved in the grilling session of
**2026-07-29**. This file exists because the plan is executed across many
sessions: a session picking up Phase 6 was not present when the picker's table
budget was argued, and must not re-decide it.

Read this alongside [CONTEXT.md](../CONTEXT.md) (what the words mean) and
[adr/](./adr/) (the two decisions with consequences big enough to need their own
page). `KNOWN_ISSUES.md` holds the deliberate divergences from BIRD's own
evaluation and is not repeated here.

Each entry states the decision, why, and what would invalidate it. If you think
one is wrong, say so before writing code against a different assumption — an
unannounced reversal produces two numbers that cannot be compared.

---

## The row comparator (Phase 1)

**D1 — Numeric equality is coercion plus six decimal places.**
Any JS number, and any string matching `/^-?\d+(\.\d+)?$/`, becomes a `Number`;
two of them are equal when they agree to six decimal places.
*Why:* `pg` returns `integer` as a number but `bigint` and `numeric` as strings,
so `COUNT(*)` and `SUM(1)` on the same correct answer compare unequal without
coercion. Rounding absorbs float drift between two aggregation orders that are
both right.
*Accepted cost:* the text value `'0007'` equals the number `7`. Rare, and
preferable to failing every correct query that used a different aggregate.
*Invalidated if:* a failure triage shows text-vs-number false equality actually
scoring wrong answers as correct.

**D2 — A text rendering of a date equals the date.**
`Date` objects canonicalize from **local** components (`getFullYear()`, not
`toISOString()`), to `YYYY-MM-DD[ HH:MM:SS]`. A string of that exact shape is
treated as the same value.
*Why:* `pg` parses `date` and `timestamp` into local-time `Date` objects, so
`toISOString()` would shift every date by the machine's offset — reintroducing
the bug the timezone pin exists to kill. And `TO_CHAR(col,'YYYY-MM-DD')` is a
formatting choice, not a different answer.
*Note:* this is about *rendering* only. The session timezone is `Asia/Shanghai`
and that is settled in `KNOWN_ISSUES.md` §2 — do not revisit it. UTC costs
`bird-0307` and `bird-0308`, which is the entire difference between a 498 and a
500 denominator.

**D3 — Canonicalization is value-shape based, not type based.**
The comparator's signature stays `(actual: unknown[][], expected: unknown[][])`.
It never receives Postgres type OIDs.
*Why:* the same correct answer legitimately arrives as `int8` on one side and
`numeric` on the other, so declared types cannot be compared anyway — only
normalized. Keeping types out keeps "column names are never consulted"
structurally true rather than a rule to remember.

---

## Testing (Phase 0 onward)

**D4 — `npm test` never touches Postgres.**
Pure tests (comparator, recall extraction, prompt rendering) run under
`npm test`. Anything needing the container — the read-only role, the catalog,
the executor — runs under `npm run test:db`. Phase 2 and Phase 3 exit tests
point at `test:db`.
*Why:* every commit runs lint and test, and a native Postgres shadowing port
5433 is a normal state on this machine. A test suite that fails for
environmental reasons gets ignored, and then stops catching anything.

---

## What the model sees (Phases 3, 4, 6)

**D5 — Prompt schema text comes from `information_schema` only.**
Table names, column names, types, nullability, primary keys, foreign keys.
Verbatim. No BIRD column descriptions, no sample values.
*Why:* one source of truth, no second name-matching layer against BIRD's
mixed-case files, and EASY and HARD prompts differ in exactly one thing — the
table set.
*Deferred, not rejected:* BIRD ships per-column descriptions in
`data/minidev/MINIDEV/dev_databases/<db>/database_description/*.csv` (e.g.
`CreaionDate → "the creation date of the post"`). Measure them on the dev slice
after Phase 5 for ~$2 and report the delta as its own number. Do not slip them
into a measured configuration without recording it.

**D6 — A picker sends at most 10 tables.**
The keyword picker fills to 10; the LLM picker returns as many as it judges
necessary, up to 10.
*Why:* most gold queries touch 1–4 tables, so 10 leaves margin for a near-miss
without paying the 75-table token bill the picker exists to avoid.
*Invalidated if:* measured table recall shows misses where the needed table
ranked 11th–15th.

**D7 — Table recall is all-or-nothing, extracted by regex, and fails loudly.**
Parse table names out of the **gold SQL** over `FROM` / `JOIN`, strip aliases and
CTE names, then check every extracted name against the 75-table catalog. An
unrecognized name **throws**. A hit requires every gold table to be present in
the set sent to the model; there is no partial credit. Record how many tables
were sent, so precision is visible without being scored.
*Why:* a regex that silently returns `[]` scores 100% recall forever. The
catalog check is what makes the cheap approach safe. Verify the extractor once
across all 500 gold queries before trusting a recall number.

---

## Running an eval (Phases 5, 6, 7)

**D8 — Configuration arrives by environment variable, one eval file.**
`EVAL_MODE=hard PICKER=llm REPAIR=on CONCURRENCY=12 npx evalite run evals/main.eval.ts`,
wrapped in `package.json` scripts. Not one file per configuration.
*Why:* evalite's CLI accepts path filters plus `--threshold`, `--hideTable`,
`--outputPath` and `--no-cache` — **it does not accept custom flags**. The
`npm run eval:dev -- --mode=hard --picker=keyword` form in earlier drafts of
`PLAN.md` cannot work. Four copies of the wiring is also how the EASY and HARD
paths silently drift apart.

**Amended 2026-07-30 — the names are `EVAL_MODE` and `EVAL_DEV`, not `MODE` and
`DEV`.** evalite runs eval files inside vitest workers, and vite owns `MODE`,
`DEV`, `PROD` and `BASE_URL` there: it sets `MODE="test"` and `DEV="1"` in every
worker, so an eval configured with those names silently reads vite's values
instead. Found the expensive way — the first `eval:easy` run filtered itself to
the dev slice through vite's `DEV` and was voided (see `RUNS.md`). `PICKER`,
`REPAIR`, `TRIALS`, `LIMIT` and `CONCURRENCY` are not vite-owned and keep their
plain names. `LIMIT=N` (first N questions, wiring smoke) stamps `limit=N` into
the run name so its number can never read as a real one.

**D9 — `evalite.each` is used for exactly one job: the picker bake-off.**
Keyword versus LLM picker, one run, same data, same process.
*Why:* it removes "did anything else differ between those two runs?" from the
comparison that decides which picker gets the expensive full run. It is not used
elsewhere, because it runs every variant every time.

**D10 — Storage is persistent SQLite plus a committed JSON export per run.**
`evalite.config.ts` → `storage: () => createSqliteStorage('./.evalite/evalite.db')`,
gitignored, and `--outputPath runs/<date>-<id>.json` committed.
*Why:* **evalite v1 defaults to in-memory storage** — an unconfigured run keeps
nothing at all. (Older notes describing `node_modules/.evalite` describe v0.) The
SQLite file drives the UI and run-over-run diffing; the committed JSON is the
evidence the README points at, and it survives a clean install.

**D11 — Configuration is recorded twice: in the run name and in every row.**
Run name like `hard | picker=llm | prompt=v1 | terra`; the same fields repeated
in each result's `columns`.
*Why:* evalite diffs runs sharing a name, so the name carries the config to make
the run list readable, and the per-row copy makes a single exported result
self-describing. Consequence, and it is correct: HARD and EASY runs no longer
auto-diff against each other. They were never comparable.

**D12 — Start at 100 in flight and tune down from observed 429s.**
`CONCURRENCY=100` for EASY / picker / repair runs (small prompts). The 75-table
baseline starts lower — ~20 — because 100 × 20k tokens is 2M tokens a minute and
will exceed any tier below 5 instantly. Retry 429 and 5xx with exponential
backoff (`maxRetries: 5`).
*Why start high:* tokens-per-minute binds long before requests-per-minute, and
the ceiling is unknown until measured. Guessing low costs hours per run; guessing
high costs visible, retryable errors. Julian's call, and the right one — provided
the two guardrails below hold.

**Superseded in its numbers, 2026-07-30 — the ceiling is now measured.** Phase
4a's headers give 500 requests/minute and **500,000 tokens/minute** (recorded in
`RUNS.md`), which is well below the tier this decision assumed. Measured prompts
at v1 are 352 tokens for EASY and 8,611 for the 75-table baseline, so the
ceiling allows roughly 500 EASY questions a minute (requests bind) and 58
baseline questions a minute (tokens bind). At observed latency that is ~15 in
flight for EASY and ~2 for the baseline, not 100 and 20.
The reasoning above still holds — start from the ceiling and tune down from
observed 429s. **The replacement numbers are Julian's call and are not set here.**

**Superseded again, 2026-07-30 — those figures were `gpt-5.6-terra`'s and do not
transfer.** Both halves moved when the project switched to `claude-sonnet-5`,
and they moved in opposite directions. The ceiling went up roughly tenfold
(5,000 requests/minute, 5,000,000 **input** tokens/minute, 1,000,000 **output**
tokens/minute — re-measured in `RUNS.md`), and the prompts got bigger under a
different tokenizer: 811 tokens for EASY and 14,886 for the 75-table baseline,
against 352 and 8,611 before.

Input and output are now throttled *separately*, so there are two token ceilings
to divide by rather than one:

| Configuration | Input | Output | Binds on | Questions/min | ~In flight |
|---|---|---|---|---|---|
| EASY, 5 tables | 811 | 105 | requests | ~5,000 | ~375 |
| Baseline, all 75 tables | 14,886 | 118 | input tokens | ~336 | ~21 |

*Read those two right-hand columns as ceilings, not settings.* They come from
one trivially easy question that spent 14 and 21 thinking tokens; a real BIRD
question thinks far more, which raises output tokens and latency together. That
pushes EASY toward the **output** ceiling and pushes both in-flight numbers up,
because slower calls need more in flight to saturate the same rate. The API also
throttles sharp ramps independently of these limits, so the first run of a new
configuration ramps rather than opening at the ceiling.
**The replacement numbers, set 2026-07-30 (Julian's call, delegated):**
`CONCURRENCY=50` for EASY, dev-slice, picker and repair runs; `CONCURRENCY=15`
for the 75-table baseline. `maxRetries: 5` on the client, as this decision
always specified — now actually set, in `src/model.ts`.
*Why below the ceiling rather than at it:* 375 and 21 are the points where the
ceiling *binds*. Running there turns ordinary latency variance into 429s, and a
429 that survives every retry voids the entire run (D12b) — so headroom buys
protection against re-running, which is worth far more than wall-clock. 15 sits
~30% under the baseline's input-token ceiling.
*Why 50 and not 100 for EASY:* the dev slice is 100 questions, so 50 is two
waves and the slice finishes in well under a minute either way. There is nothing
above it to buy, and the smaller number keeps a ramp in the run for free.
*Still start from the ceiling and tune down from observed 429s* — these are
opening figures, not a floor discovered by measurement.

**D12a — The Postgres pool is capped at 20, independent of LLM concurrency.**
*Why:* Postgres `max_connections` defaults to 100 and every question runs two
queries, so 100 concurrent questions exhaust the server. That surfaces as
`too many clients already` — an *execution* error, which lands in the "never
valid" triage bucket and reads as the model writing bad SQL. A silently wrong
number, unlike a 429. DB work is milliseconds against a 30-second model call, so
20 is never the bottleneck.

**D12b — A 429 that survives every retry never scores 0.**
It voids that question and is reported as a count next to the accuracy figure. If
the count is not zero, the run is `void` in `RUNS.md`.
*Why:* otherwise the accuracy number quietly absorbs infrastructure failures, and
a throttled run looks like a worse model.
*How to get the real ceiling:* log the `anthropic-ratelimit-*` headers from the
Phase 4a smoke-test response — `input-tokens` and `output-tokens` are throttled
separately, so both `-limit` values matter, and `retry-after` is what a 429
carries. Those headers are authoritative for this key and model; published tier
tables are not.
*Known, not taken:* the Batch API is 50% cheaper and would halve the baseline
run, at up to 24 hours turnaround. Wrong for the dev loop; revisit only for the
one big run.

**D13 — A statement timeout is a plain failure, not a repair case.**
15 seconds, matching gold validation. Record the `57014` code so timeouts can be
counted.
*Why:* retrying the slowest queries in the set is where money goes to die.

**D14 — Self-repair: 2 retries, same tables, full failure history.**
The retry sees the original prompt plus **every** previous failed attempt and its
Postgres error. Table selection does not re-run on retry. Attempt count recorded
on every result.
*Why full history:* Julian's call — the model gets to see that it already tried
something and it failed, rather than repeating it.
*Why not re-picking tables:* repair and table selection would change together,
and neither delta in the README would be attributable to one thing.

**D18 — Thinking effort is pinned to `medium`, for every run.**
`EFFORT=medium`, read from env with that default in `src/model.ts` and sent as
`output_config.effort`, recorded in every run's configuration. Decided
2026-07-30.
*Why pinned at all:* omitting the parameter lets the API choose, and that choice
can move server-side. Every run would then record "whatever the provider was
doing that day" — the same failure the pinned model id exists to prevent. There
is no `auto` value; the set is `low | medium | high | xhigh | max`.
*Why medium:* it adapts to question difficulty rather than spending a fixed
budget, and it leaves room to move in either direction. Higher effort risks
compressing the very differences the project measures — a model thinking hard
enough to recover from a mediocre table set narrows the picker gap and softens
the recall ceiling, which are the two claims the README is built on.
*Verified:* the documented API default is `high`, so `medium` is one deliberate
step below it, not a restatement of the default. No response field reports the
effort actually applied, so the value matters because it is recorded.
*Invalidated if:* a dev-slice comparison at a second effort level moves accuracy
by more than the Phase 5c noise band. That experiment is deferred and optional —
if it is ever run, it is reported as its own number, never folded into a
measured configuration.
*Consequence:* changing this retires every number measured before it, exactly as
changing `MODEL` does.

**Amended 2026-07-30 — same decision, different provider.** The project moved
from `gpt-5.6-terra` to `claude-sonnet-5` before any eval run existed, so
nothing was retired. Two facts moved with it: the effort set lost `none` and
`minimal`, and the API's own default is now documented rather than guessed —
`high`, which is what makes `medium` a real choice. On this model, effort also
governs *whether and how much the model thinks*: thinking is on by default and
has no separate token budget, so `EFFORT` is the only lever on it.

**D19 — A safety refusal voids the question. It never scores 0.**
Same triage bucket as a 429 that survives every retry (D12b): counted and
reported next to the accuracy figure, and if the count is not zero the run is
`void` in `RUNS.md`. Decided 2026-07-30.
*Why:* a refusal is the provider's safety classifier declining the request, not
the model writing bad SQL. Scoring it 0 makes accuracy partly a measure of the
classifier — and one that moves whenever Anthropic retunes it. That is the same
silent contamination D12b exists to prevent.
*Why it is not an execution error either:* a refusal returns HTTP 200 with an
empty or partial body, so nothing reaches Postgres and there is no error code to
triage. It has to be caught at the model boundary or not at all.
*What the code does today:* `completeJson` throws on `stop_reason: "refusal"`,
carrying the category. Phase 5 catches that and counts it. Until Phase 5 exists,
a refusal is loud — correct for a path still debugged by hand.
*Why not server-side fallbacks:* the `fallbacks` parameter re-runs a refused
request on a different model and returns *its* answer. That is a silent model
switch, the exact failure the pinned `MODEL` exists to prevent, and it would
land in the run as an ordinary result. Not used, on any path.
*Expected volume:* text-to-SQL over retail, football and school databases should
trip nothing. If refusals are ever more than a handful, that is a finding about
the prompt, not a scoring problem to tune around.

---

## Reporting (Phases 8, 10)

**D15 — EASY mode is a yardstick, run once, never tuned.**
See [ADR 0002](./adr/0002-easy-mode-is-a-yardstick-not-a-tuning-target.md).

**D16 — The improvement table's baseline row is all 75 tables, no picker.**
See [ADR 0003](./adr/0003-baseline-row-is-no-picker-at-all.md).

**D17 — The demo has no hint box and no database selector.**
Question in, all 75 tables, winning picker, SQL and rows out.
*Why:* the demo shows the configuration that was measured. A database selector
demos EASY mode — the task deliberately labelled a yardstick — and a hint box
hands the visitor BIRD's evidence field, which no real user has.

---

## Every run leaves a record

`RUNS.md` gets one append-only entry per run: the run writes its own facts
(config, accuracy, recall, tokens, cost), and a human adds the verdict —
`kept`, `rejected`, or `void` — plus one line on what changed.
*Why a human writes the verdict:* a script cannot detect `void`. A run with the
wrong configuration looks perfectly healthy to itself.
