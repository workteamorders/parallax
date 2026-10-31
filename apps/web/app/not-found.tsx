import Link from "next/link";
export default function NotFound() {
  return (
    <main className="standalone">
      <p className="eyebrow">404 / OUTSIDE THE OBSERVATORY</p>
      <h1>No market in sight.</h1>
      <p>This page does not exist. Your next perspective is one click away.</p>
      <Link className="button primary" href="/">
        Return to overview
      </Link>
    </main>
  );
}
