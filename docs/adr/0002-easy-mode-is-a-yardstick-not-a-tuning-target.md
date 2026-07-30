# EASY mode exists only as a yardstick

QueryProof's real task is harder than BIRD's: eleven databases live in one
`public` schema, so the model sees 75 tables with no label saying which database
a table came from (`races` is Formula 1, `race` is superheroes). BIRD's published
baselines are measured with the database already known, so the project's own
number is not comparable to them. EASY mode — every table of the record's
`db_id`, no picker — is kept solely to produce that comparable figure, gets
exactly one full 500-question run, and never appears as a row in the
improvement table.

## Considered alternatives

Deleting EASY was considered and rejected on two counts. Without it, a reader who
knows BIRD reads a HARD number below gpt-4-turbo's 36.00 as a worse system rather
than a harder task, with nothing to point at. And Phase 5 — the milestone that
retires the project's main risk — has to reach its first accuracy number before
any picker exists; EASY is the cheapest path to it, at roughly a third the token
cost of sending all 75 tables.

## Consequences

Two headline numbers, measured on two different task definitions, and the README
has to be explicit about which is which. Improvement deltas are only ever quoted
within HARD mode.
