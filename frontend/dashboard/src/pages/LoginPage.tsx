import { useState, type FormEvent } from "react";

import { ApiError } from "../api/client";
import { IconCheck } from "../components/Icons";
import { ErrorBanner, InfoBanner } from "../components/ui";
import { useAuth } from "../lib/auth";

export function LoginPage() {
  const { signIn, notice } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(username.trim(), password);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "Sign-in failed."));
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <section className="login-hero">
        <div className="brand" style={{ padding: 0, border: 0 }}>
          <div className="brand-mark" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#ffffff">
              <path d="M2.5 16.5 10 13l-1.2-7.2 2.6-.9 4.3 6 5.8-2.2c1.1-.4 2 .9 1.1 1.6L6 19.4c-1.4.6-3-.3-3.5-1.7z" />
            </svg>
          </div>
          <div>
            <div className="brand-name">FlightOps AI</div>
            <div className="brand-sub">Telemetry analytics</div>
          </div>
        </div>
        <div>
          <h1>Flight-approach telemetry analysis and anomaly detection</h1>
          <p>Review final-approach telemetry, run anomaly analyses and inspect the evidence behind every alert.</p>
          <ul className="login-points">
            <li><IconCheck size={18} />Window-level anomaly scores with a calibrated alert threshold</li>
            <li><IconCheck size={18} />Supporting evidence and data-quality flags for every window</li>
            <li><IconCheck size={18} />Role-based access with a complete audit trail</li>
          </ul>
        </div>
        <p style={{ fontSize: 12.5, marginTop: 32 }}>
          Experimental analytics on the NASA DASHlink dataset. Not for operational or safety decisions.
        </p>
      </section>

      <div className="login-panel">
        <div className="card login-card">
          <h2>Sign in</h2>
          <p className="secondary" style={{ marginTop: 4, marginBottom: 20 }}>Use your FlightOps AI account.</p>
          <form onSubmit={submit} className="stack" noValidate>
            {notice && <InfoBanner tone="warn">{notice}</InfoBanner>}
            <ErrorBanner error={error} />
            <div className="field">
              <label htmlFor="username">Username</label>
              <input id="username" className="input" autoComplete="username" value={username} maxLength={64}
                onChange={(e) => setUsername(e.target.value)} required autoFocus />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input id="password" className="input" type="password" autoComplete="current-password" value={password}
                maxLength={200} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <button className="btn btn-primary" type="submit" disabled={busy || !username.trim() || !password}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
