# The improvement table's baseline is all 75 tables, no picker

The README's improvement table is HARD mode throughout, and its first row is the
configuration with **no table selection at all** — all 75 tables in every prompt,
measured across all 500 validated questions. Rows two and three add the winning
picker and then self-repair. That makes the headline claim *"choosing the right
tables was worth +X points"* rather than *"a smarter picker beat a dumber
picker"*, which is the difference between demonstrating the project's thesis and
reporting a tuning result.

## Considered alternatives

Using the keyword picker as the first row costs ~$3 instead of ~$27 and leaves
~$22 of the ~$70 credit budget as slack for re-runs. It was rejected because the
delta it produces is small, and any reader familiar with the problem immediately
asks what no picker at all scored — leaving the strongest measured claim in the
project unmeasured to save a third of the budget.

EASY mode as the first row was rejected outright: rows would then differ by task
definition rather than by one component, so no delta would mean anything.

## Consequences

One run costs ~$27, the largest single spend in the project, and it is the run
worth not repeating by accident. It is therefore run on the 100-question dev
slice first (~$5) to confirm the pipeline, the recorded configuration, and a sane
number before the full run is launched. Watch the credit balance immediately
before it.
