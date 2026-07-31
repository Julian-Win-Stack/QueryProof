'use client';

import { useState } from 'react';

type AskResponse = {
  sql?: string;
  columns?: string[];
  rows?: unknown[][];
  rowCount?: number;
  attempts?: number;
  tables?: string[];
  confidence?: 'low' | 'normal';
  error?: string;
};

const box: React.CSSProperties = {
  background: '#12161f',
  border: '1px solid #232a38',
  borderRadius: 8,
  padding: '0.9rem 1rem',
  marginTop: '1rem',
  overflowX: 'auto',
};

export default function Home() {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AskResponse | null>(null);

  async function ask() {
    if (question.trim() === '' || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      setResult((await response.json()) as AskResponse);
    } catch (err: unknown) {
      setResult({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: '3rem 1.5rem' }}>
      <h1 style={{ fontSize: '1.6rem', margin: 0 }}>QueryProof</h1>
      <p style={{ color: '#9aa4b5', marginTop: '0.4rem' }}>
        Ask a question in English. The system picks tables out of a 75-table Postgres database, writes
        SQL, runs it read-only, and retries on errors — the exact configuration that measured 54.8% on
        500 BIRD questions.
      </p>

      <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1.4rem' }}>
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void ask();
          }}
          placeholder="e.g. How many Formula 1 races were held in 2009?"
          style={{
            flex: 1,
            padding: '0.7rem 0.9rem',
            borderRadius: 8,
            border: '1px solid #232a38',
            background: '#12161f',
            color: '#e6e6e6',
            fontSize: '1rem',
          }}
        />
        <button
          onClick={() => void ask()}
          disabled={busy}
          style={{
            padding: '0.7rem 1.2rem',
            borderRadius: 8,
            border: 'none',
            background: busy ? '#2a3245' : '#3b6fe0',
            color: 'white',
            fontSize: '1rem',
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          {busy ? 'Thinking…' : 'Ask'}
        </button>
      </div>

      {result && (
        <section>
          {result.tables && result.tables.length > 0 && (
            <p style={{ color: '#9aa4b5', marginTop: '1rem', marginBottom: 0 }}>
              Tables picked: {result.tables.join(', ')}
              {result.attempts !== undefined && result.attempts > 1 && ` · ${result.attempts} attempts`}
            </p>
          )}

          {result.sql && (
            <pre style={{ ...box, whiteSpace: 'pre-wrap', fontSize: '0.9rem' }}>{result.sql}</pre>
          )}

          {result.error && (
            <div style={{ ...box, borderColor: '#5c2b2b', color: '#f0b4b4' }}>{result.error}</div>
          )}

          {result.confidence === 'low' && !result.error && (
            <div style={{ ...box, borderColor: '#5c4b2b', color: '#e8c98a' }}>
              Low confidence: on the measured run, answers like this one (empty result or repaired
              query) were right 2.5% of the time.
            </div>
          )}

          {result.columns && result.rows && (
            <div style={box}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9rem' }}>
                <thead>
                  <tr>
                    {result.columns.map((column, index) => (
                      <th
                        key={index}
                        style={{
                          textAlign: 'left',
                          padding: '0.3rem 0.7rem',
                          borderBottom: '1px solid #232a38',
                          color: '#9aa4b5',
                        }}
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((value, cellIndex) => (
                        <td key={cellIndex} style={{ padding: '0.3rem 0.7rem' }}>
                          {value === null ? '∅' : String(value)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.rowCount !== undefined && result.rowCount > result.rows.length && (
                <p style={{ color: '#9aa4b5', margin: '0.6rem 0 0' }}>
                  Showing {result.rows.length} of {result.rowCount} rows.
                </p>
              )}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
