import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setToken } from "../api/client";
import { App } from "../App";
import { ChartCard } from "../components/ChartCard";
import { StatusBadge, ThresholdBadge } from "../components/ui";
import { AuthProvider } from "../lib/auth";
import { ThemeProvider } from "../lib/theme";

const STATS = {
  flights: 3, windows: 24, analysesCompleted: 2, analysesFailed: 1, analysesInProgress: 0,
  windowsScored: 16, windowsAboveThreshold: 4, lastAnalysisAt: new Date().toISOString(),
  recentAnalyses: [{ analysisId: 7, flightId: 1, externalFlightReference: "DEMO-1", status: "COMPLETED",
    startedAt: new Date().toISOString(), completedAt: null, nWindows: 8, nAboveThreshold: 3 }],
  flightsByAlerts: [{ flightId: 1, externalFlightReference: "DEMO-1", analysisId: 7, nWindows: 8, nAboveThreshold: 3 }],
};
const MODEL = { model_name: "if_tail_hybrid", model_version: "0.4.0", threshold: 0.9713, evaluation: { test_pr_auc: 0.41 } };

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

function renderApp(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(fetchImpl));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter><App /></MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  setToken(null);
});

describe("sign-in and overview", () => {
  it("signs in, stores the session (not in localStorage) and shows the overview", async () => {
    const calls: string[] = [];
    renderApp((url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "/api/v1/auth/login") return json({ access_token: "jwt-123", token_type: "Bearer", expires_in: 3600 });
      if (url === "/api/v1/me") return json({ id: 1, username: "admin", role: "ADMIN" });
      if (url === "/api/v1/stats") return json(STATS);
      if (url === "/api/v1/model") return json(MODEL);
      return json({}, 404);
    });

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Username"), "admin");
    await user.type(screen.getByLabelText("Password"), "correct-horse-battery");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(within(screen.getByLabelText("Flights")).getByText("3")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Above threshold")).getByText("4")).toBeInTheDocument();
    expect(screen.getByText("25.0% of analysed windows")).toBeInTheDocument();
    expect(await screen.findByText("if_tail_hybrid")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Users" })).toBeInTheDocument();     // admin navigation

    expect(sessionStorage.getItem("flightops.session")).toContain("jwt-123");
    expect(JSON.stringify(localStorage)).not.toContain("jwt-123");
    expect(calls).toContain("POST /api/v1/auth/login");
  });

  it("shows the server's message on failed sign-in and clears the password", async () => {
    renderApp((url) =>
      url === "/api/v1/auth/login" ? json({ detail: "Invalid username or password" }, 401) : json({}, 404));
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Username"), "admin");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid username or password");
    expect(screen.getByLabelText("Password")).toHaveValue("");
  });

  it("hides admin navigation from analysts and signs out on 401", async () => {
    let statsStatus = 200;
    renderApp((url) => {
      if (url === "/api/v1/auth/login") return json({ access_token: "t", token_type: "Bearer", expires_in: 3600 });
      if (url === "/api/v1/me") return json({ id: 2, username: "alice", role: "ANALYST" });
      if (url === "/api/v1/stats") return statsStatus === 200 ? json(STATS) : json({ detail: "expired" }, 401);
      if (url === "/api/v1/model") return json(MODEL);
      return json({}, 404);
    });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Username"), "alice");
    await user.type(screen.getByLabelText("Password"), "analyst-password-123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();

    statsStatus = 401;
    await user.click(screen.getByRole("button", { name: /sign out/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument());
    expect(sessionStorage.getItem("flightops.session")).toBeNull();
  });
});

describe("components", () => {
  it("status badges always pair an icon with a text label", () => {
    render(<><ThresholdBadge above /><ThresholdBadge above={false} /><StatusBadge status="FAILED" /></>);
    for (const text of ["Above threshold", "Below threshold", "Failed"]) {
      const badge = screen.getByText(text);
      expect(badge.querySelector("svg")).not.toBeNull();
    }
  });

  it("chart cards offer a table view of the same data", async () => {
    render(<ChartCard title="Scores" chart={<div>CHART</div>} table={<table><tbody><tr><td>ROW</td></tr></tbody></table>} />);
    expect(screen.getByText("CHART")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Table" }));
    expect(screen.getByText("ROW")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Table" })).toHaveAttribute("aria-pressed", "true");
  });
});
