import { NavLink, Outlet, useLocation } from "react-router-dom";

import { useAuth } from "../lib/auth";
import { useTheme } from "../lib/theme";
import {
  IconAudit, IconCompare, IconFlights, IconLogout, IconMoon, IconModel, IconOverview, IconSun, IconUsers,
} from "./Icons";

const SECTIONS: Record<string, string> = {
  "": "Overview", flights: "Flights", compare: "Compare flights", model: "Model", users: "Users", audit: "Audit log",
};

export function AppShell() {
  const { me, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  const { pathname } = useLocation();
  const parts = pathname.split("/").filter(Boolean);
  const section = SECTIONS[parts[0] ?? ""] ?? "";
  const isAdmin = me?.role === "ADMIN";

  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand">
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
        <nav className="nav">
          <div className="nav-section">Analysis</div>
          <NavLink to="/" end><IconOverview />Overview</NavLink>
          <NavLink to="/flights"><IconFlights />Flights</NavLink>
          <NavLink to="/compare"><IconCompare />Compare flights</NavLink>
          <NavLink to="/model"><IconModel />Model</NavLink>
          {isAdmin && (
            <>
              <div className="nav-section">Administration</div>
              <NavLink to="/users"><IconUsers />Users</NavLink>
              <NavLink to="/audit"><IconAudit />Audit log</NavLink>
            </>
          )}
        </nav>
        <div className="sidebar-foot">
          Experimental analytics. Not for operational, maintenance or safety decisions.
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="crumbs" aria-label="Breadcrumb">
            <span>FlightOps AI</span>
            <span aria-hidden="true">/</span>
            <strong>{section}{parts[0] === "flights" && parts[1] ? ` · #${parts[1]}` : ""}</strong>
          </div>
          <div className="topbar-actions">
            <button className="btn btn-ghost icon-btn" onClick={toggle}
              aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
              title={theme === "light" ? "Dark theme" : "Light theme"}>
              {theme === "light" ? <IconMoon /> : <IconSun />}
            </button>
            <div className="user-chip">
              <div className="avatar" aria-hidden="true">{me?.username.slice(0, 2).toUpperCase()}</div>
              <div className="user-meta">
                <span className="name">{me?.username}</span>
                <span className="role">{me?.role === "ADMIN" ? "Administrator" : "Analyst"}</span>
              </div>
            </div>
            <button className="btn btn-sm" onClick={() => signOut()}><IconLogout size={14} />Sign out</button>
          </div>
        </header>
        <main className="content" id="main">
          <Outlet />
          <p className="disclaimer">
            FlightOps AI scores are statistical deviations from nominal approaches in the NASA DASHlink dataset.
            They are not confirmed faults and must not be used for flight-safety, dispatch or maintenance decisions.
          </p>
        </main>
      </div>
    </div>
  );
}
