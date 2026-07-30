# Run log

Append-only. One entry per eval run, written when the run finishes. **Never edit
a past entry** — locking the number is the entire point of this file. A run with
no entry here did not happen.

The numbers are the same ones evalite exported to `runs/<id>.json`. This file is
the readable mirror, plus the judgement the export cannot hold.

## Verdicts

- **kept** — valid run, beat the previous best by more than the noise band. The
  approach stays.
- **rejected** — valid run, did not beat the previous best. The number stands as
  evidence; the approach is abandoned. A rejected run is not a failed run.
- **void** — the run is not evidence: wrong configuration, crashed mid-run, a
  model other than `gpt-5.6-terra`, or responses served from a cache. The number
  is discarded and never compared to anything.

A number that changed by less than the noise band did not change. Two numbers
measured under different modes are never compared to each other.

## Entry format

```
## YYYY-MM-DD — <what changed>
approach:      mode=hard picker=llm repair=on prompt=v2 model=gpt-5.6-terra
question set:  dev-slice (100) | full (500 validated)
accuracy:      00.0% (n/denominator)
table recall:  00.0%
noise band:    ±0.0 points (3 trials, YYYY-MM-DD)
verdict:       kept | rejected | void
note:          what changed since the last run, and what the number says
export:        runs/YYYY-MM-DD-<id>.json
```

---

## Rate-limit ceiling for this key

Measured 2026-07-30 from the Phase 4a smoke-test response headers, per D12b.
Authoritative for this key and model; published tier tables are not. Re-measure
if the key or the tier changes.

```
x-ratelimit-limit-requests:      500        per minute
x-ratelimit-limit-tokens:        500,000    per minute
x-ratelimit-reset-requests:      120ms
x-ratelimit-reset-tokens:        3ms
```

Measured prompt sizes at prompt v1, same question both ways:

| Configuration | Prompt tokens | Questions/min at the ceiling | Binds on |
|---|---|---|---|
| EASY, 5 tables | 352 | ~500 | requests |
| Baseline, all 75 tables | 8,611 | ~58 | tokens |

**D12's concurrency figures were set before this was measured and do not survive
it.** 500k tokens/minute is far below the tier D12 assumed. See D12 in
`docs/decisions.md`.

---
