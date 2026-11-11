import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";

import { endpoints } from "../api/endpoints";
import { useAuth } from "../lib/auth";
import { useTheme } from "../lib/theme";
import {
  IconAudit, IconCompare, IconFlights, IconLogout, IconMenu, IconMoon, IconModel, IconOverview, IconSun, IconUsers,
} from "./Icons";

const SECTIONS: Record<string, { label: string; to: string }> = {
  "": { label: "Overview", to: "/" },
  flights: { label: "Flights", to: "/flights" },
  compare: { label: "Compare flights", to: "/compare" },
  model: { label: "Model", to: "/model" },
  users: { label: "Users", to: "/users" },
  audit: { label: "Audit log", to: "/audit" },
};

function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="#ffffff">
        <path d="M2.5 16.5 10 13l-1.2-7.2 2.6-.9 4.3 6 5.8-2.2c1.1-.4 2 .9 1.1 1.6L6 19.4c-1.4.6-3-.3-3.5-1.7z" />
      </svg>
    </div>
  );
}

function Breadcrumbs() {
  const { pathname } = useLocation();
  const parts = pathname.split("/").filter(Boolean);
  const section = SECTIONS[parts[0] ?? ""];
  const flightId = parts[0] === "flights" && parts[1] ? Number(parts[1]) : null;
  const flight = useQuery({
    queryKey: ["flight", flightId],
    queryFn: () => endpoints.flight(flightId!),
    enabled: flightId !== null && Number.isInteger(flightId) && flightId > 0,
  });
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      <Link to="/">FlightOps AI</Link>
      <span aria-hidden="true">/</span>
      {flightId !== null ? (
        <>
          <Link to="/flights">Flights</Link>
          <span aria-hidden="true">/</span>
          <strong aria-current="page">{flight.data?.flight.externalFlightReference ?? `Flight #${flightId}`}</strong>
        </>
      ) : (
        <strong aria-current="page">{section?.label ?? "Not found"}</strong>
      )}
    </nav>
  );
}

export function AppShell() {
  const { me, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const isAdmin = me?.role === "ADMIN";

  useEffect(() => { setMenuOpen(false); }, [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <aside className={`sidebar ${menuOpen ? "open" : ""}`} aria-label="Main navigation">
        <div className="brand">
          <BrandMark />
          <div>
            <div className="brand-name">FlightOps AI</div>
            <div className="brand-sub">Telemetry analytics</div>
          </div>
          <button className="btn icon-btn menu-toggle" aria-expanded={menuOpen} aria-controls="main-nav"
            aria-label={menuOpen ? "Close menu" : "Open menu"} onClick={() => setMenuOpen((o) => !o)}>
            <IconMenu size={18} />
          </button>
        </div>
        <nav className="nav" id="main-nav">
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
          <Breadcrumbs />
          <div className="topbar-actions">
            <button className="btn btn-ghost icon-btn" onClick={toggle}
              aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
              title={theme === "light" ? "Dark theme" : "Light theme"}>
              {theme === "light" ? <IconMoon /> : <IconSun />}
            </button>
            <div className="user-chip" title={`${me?.username} · ${me?.role === "ADMIN" ? "Administrator" : "Analyst"}`}>
              <div className="avatar" aria-hidden="true">{me?.username.slice(0, 2).toUpperCase()}</div>
              <div className="user-meta">
                <span className="name">{me?.username}</span>
                <span className="role">{me?.role === "ADMIN" ? "Administrator" : "Analyst"}</span>
              </div>
            </div>
            <button className="btn btn-sm" onClick={() => signOut()} aria-label="Sign out">
              <IconLogout size={16} /><span className="btn-label">Sign out</span>
            </button>
          </div>
        </header>
        <main className="content" id="main" tabIndex={-1}>
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
