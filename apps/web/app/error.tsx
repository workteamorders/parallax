"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="standalone">
      <p className="eyebrow">CONNECTION INTERRUPTED</p>
      <h1>Let&apos;s get a fresh perspective.</h1>
      <p>The terminal could not render. No transaction was submitted.</p>
      <button className="button primary" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
