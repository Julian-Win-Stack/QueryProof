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
  model other than `claude-sonnet-5`, or responses served from a cache. The
  number is discarded and never compared to anything.

A number that changed by less than the noise band did not change. Two numbers
measured under different modes are never compared to each other.

## Entry format

```
## YYYY-MM-DD — <what changed>
approach:      mode=hard picker=llm repair=on prompt=v2 model=claude-sonnet-5
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

### Superseded 2026-07-30 — `gpt-5.6-terra`, OpenAI key

Kept for the record. The project moved to `claude-sonnet-5` before any eval run
existed, so no number here was ever compared against; these figures describe a
key the project no longer uses.

```
x-ratelimit-limit-requests:      500        per minute
x-ratelimit-limit-tokens:        500,000    per minute
x-ratelimit-reset-requests:      120ms
x-ratelimit-reset-tokens:        3ms
```

| Configuration | Prompt tokens | Questions/min at the ceiling | Binds on |
|---|---|---|---|
| EASY, 5 tables | 352 | ~500 | requests |
| Baseline, all 75 tables | 8,611 | ~58 | tokens |

### Current — 2026-07-30, `claude-sonnet-5`, Anthropic key

Re-measured after the provider switch, same way: one Phase 4a smoke call for the
headers, then Phase 4b's `ask` twice on the same question for the prompt sizes.
The tier is Build, and Sonnet 5 draws on its own bucket rather than sharing the
Sonnet 4.x one.

```
anthropic-ratelimit-requests-limit:        5,000       per minute
anthropic-ratelimit-input-tokens-limit:    5,000,000   per minute
anthropic-ratelimit-output-tokens-limit:   1,000,000   per minute
anthropic-ratelimit-tokens-limit:          6,000,000   per minute  (input + output)
```

Input and output are throttled separately here, so there are two token ceilings
rather than one. Measured at prompt v1 on `bird-0000`, EASY with its evidence and
baseline without, `EFFORT=medium`:

| Configuration | Input tokens | Output tokens | Latency | Questions/min | Binds on |
|---|---|---|---|---|---|
| EASY, 5 tables | 811 | 105 (14 thinking) | 4.5s | ~5,000 | requests |
| Baseline, all 75 tables | 14,886 | 118 (21 thinking) | 3.7s | ~336 | input tokens |

Both are one easy question — a hard one thinks more, which raises output tokens
and latency together. Treat the output column as a floor.

**D12's concurrency figures do not survive either measurement, and the second
does not simply relax the first.** The ceiling went up ~10x while the prompts
got bigger, so the EASY and baseline cases now bind on different limits. See D12
in `docs/decisions.md`.

---
