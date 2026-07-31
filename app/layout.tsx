import type { ReactNode } from 'react';

export const metadata = {
  title: 'QueryProof',
  description: 'Ask a question in English, get SQL and rows back — with a measured accuracy number behind it.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'ui-sans-serif, system-ui, sans-serif', background: '#0b0e14', color: '#e6e6e6' }}>
        {children}
      </body>
    </html>
  );
}
