// Best-of-N by execution agreement (Batch F run B). The model answers the same
// question N times; every attempt that executed cleanly votes with its result
// set; result sets count as the same vote when compareRows — the grader's own
// definition of "same rows" — says so; and the shipped answer is the first
// member of the largest group. No model judges anything: agreement between
// executed results is the whole signal, so a wrong rewrite can only be
// outvoted, never overwrite a right answer the way CHECK=self did 16 times.
//
// Attempts run sequentially, not in parallel: at eval concurrency 50 a
// parallel fan-out would multiply the input-token rate by N, which is how the
// desc-picker run died (35 voids of 429).

import { answerQuestion, type Answer } from './answer.ts';
import { compareRows } from './compare-rows.ts';

export type VotedAnswer = Answer & {
  // Attempts in the winning group. 0 when nothing executed cleanly and the
  // last failed attempt shipped instead.
  voteAgreement: number;
};

type AnswerParams = {
  question: string;
  evidence: string;
  schemaText: string;
  repair: boolean;
  rewrite?: boolean;
};

type Deps = {
  answer: (params: AnswerParams) => Promise<Answer>;
};

// deps exists for the pure tests on the grouping rules — the default is the
// only caller in production.
export async function voteAnswer(
  params: AnswerParams & { votes: number },
  deps: Deps = { answer: answerQuestion },
): Promise<VotedAnswer> {
  const { votes, ...answerParams } = params;
  if (!Number.isInteger(votes) || votes < 2) {
    throw new Error(`votes=${votes} — voting needs an integer of at least 2`);
  }

  const attempts: Answer[] = [];
  for (let i = 0; i < votes; i++) attempts.push(await deps.answer(answerParams));

  // Groups keep first-seen order, so a tie resolves to the earliest attempt —
  // deterministic, and biased toward nothing.
  const groups: Answer[][] = [];
  for (const attempt of attempts) {
    if (!attempt.execution.ok) continue;
    const rows = attempt.execution.rows;
    const group = groups.find(
      (members) => members[0].execution.ok && compareRows(members[0].execution.rows, rows),
    );
    if (group) group.push(attempt);
    else groups.push([attempt]);
  }

  let winner = attempts[attempts.length - 1];
  let agreement = 0;
  for (const group of groups) {
    if (group.length > agreement) {
      winner = group[0];
      agreement = group.length;
    }
  }

  // Cost and latency are the whole question's, not the winner's — N attempts
  // were paid for whichever one ships.
  return {
    ...winner,
    attempts: attempts.reduce((sum, a) => sum + a.attempts, 0),
    usage: {
      inputTokens: attempts.reduce((sum, a) => sum + a.usage.inputTokens, 0),
      outputTokens: attempts.reduce((sum, a) => sum + a.usage.outputTokens, 0),
      thinkingTokens: attempts.reduce((sum, a) => sum + a.usage.thinkingTokens, 0),
      totalTokens: attempts.reduce((sum, a) => sum + a.usage.totalTokens, 0),
    },
    modelMs: attempts.reduce((sum, a) => sum + a.modelMs, 0),
    executionMs: attempts.reduce((sum, a) => sum + a.executionMs, 0),
    voteAgreement: agreement,
  };
}
