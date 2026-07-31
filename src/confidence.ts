// Phase 9b — confidence, validated before shipping. Two signals separate
// correct from wrong on the measured repair run
// (runs/2026-07-30-194223-hard-llm-repair-full.json, 500 questions):
//
//   flagged (empty result OR repaired):  40 questions ->  2.5% correct
//   everything else:                    460 questions -> 63.7% correct
//
// Re-measured 2026-07-31 under set comparison (D23). The flagged rate did not
// move; the unflagged rate rose from 59.3%, so the two groups separate wider
// now than when the heuristic was chosen.
//
// An empty result was *never* correct on the measured set, and a query that
// needed repair was right 1 time in 11. Thinking depth, tables-picked count,
// and result size were tested the same way, barely separated, and were cut —
// an unvalidated confidence score is decoration.

export type Confidence = 'low' | 'normal';

export function confidenceOf(params: { attempts: number; rowsReturned: number }): Confidence {
  return params.rowsReturned === 0 || params.attempts > 1 ? 'low' : 'normal';
}
