import Link from "next/link";

export default function NotFound() {
  return (
    <div className="auth-wrap">
      <div className="card stack" style={{ textAlign: "center" }}>
        <h1>Page not found</h1>
        <Link href="/" className="btn">Go home</Link>
      </div>
    </div>
  );
}
