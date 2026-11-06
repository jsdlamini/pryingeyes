import Link from "next/link";
export default function NotFound() {
  return <div className="narrow"><div className="card"><h1>Page not found</h1><p className="muted">The page you're looking for doesn't exist.</p><Link className="btn ghost" href="/">Home</Link></div></div>;
}
