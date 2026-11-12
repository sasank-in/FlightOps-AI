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

describe("flights list", () => {
  const flight = (id: number, ref: string, latestAnalysis: unknown) => ({
    id, externalFlightReference: ref, datasetId: null, nWindows: 8, ownerId: 1,
    createdAt: new Date().toISOString(), latestAnalysis,
  });
  const page = (items: unknown[]) => ({ items, page: 0, size: 20, totalItems: items.length, totalPages: 1 });

  it("shows each flight's latest analysis and searches by reference through the URL", async () => {
    const flightCalls: string[] = [];
    renderApp((url) => {
      if (url === "/api/v1/auth/login") return json({ access_token: "t", token_type: "Bearer", expires_in: 3600 });
      if (url === "/api/v1/me") return json({ id: 1, username: "admin", role: "ADMIN" });
      if (url === "/api/v1/stats") return json(STATS);
      if (url === "/api/v1/model") return json(MODEL);
      if (url.startsWith("/api/v1/flights?")) {
        flightCalls.push(url);
        if (url.includes("q=zulu")) return json(page([]));
        if (url.includes("q=alpha")) return json(page([flight(1, "ALPHA-1", { id: 9, status: "COMPLETED", nAboveThreshold: 3, nWindows: 8 })]));
        return json(page([
          flight(2, "BRAVO-2", null),
          flight(1, "ALPHA-1", { id: 9, status: "COMPLETED", nAboveThreshold: 3, nWindows: 8 }),
          flight(3, "CHARLIE-3", { id: 10, status: "RUNNING", nAboveThreshold: null, nWindows: null }),
        ]));
      }
      return json({}, 404);
    });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Username"), "admin");
    await user.type(screen.getByLabelText("Password"), "correct-horse-battery");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await user.click(await screen.findByRole("link", { name: "Flights" }));

    const bravo = (await screen.findByRole("link", { name: "BRAVO-2" })).closest("tr")!;
    expect(within(bravo).getByText("Not analysed")).toBeInTheDocument();
    const alpha = screen.getByRole("link", { name: "ALPHA-1" }).closest("tr")!;
    expect(within(alpha).getByText("Completed")).toBeInTheDocument();
    expect(within(alpha).getByText("3 / 8")).toHaveClass("badge-critical");
    expect(within(screen.getByRole("link", { name: "CHARLIE-3" }).closest("tr")!).getByText("Running")).toBeInTheDocument();

    const search = screen.getByRole("searchbox", { name: "Search flight reference" });
    await user.type(search, "alpha");
    await waitFor(() => expect(screen.queryByRole("link", { name: "BRAVO-2" })).not.toBeInTheDocument());
    expect(screen.getByText("1 match")).toBeInTheDocument();
    expect(flightCalls.at(-1)).toContain("q=alpha");
    expect(flightCalls.some((u) => /q=a(&|$)/.test(u))).toBe(false);      // debounced: no request per keystroke

    await user.clear(search);
    await user.type(search, "zulu");
    expect(await screen.findByRole("heading", { name: "No matching flights" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(await screen.findByRole("link", { name: "BRAVO-2" })).toBeInTheDocument();
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
