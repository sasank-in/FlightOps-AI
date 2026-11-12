import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setToken } from "../api/client";
import { App } from "../App";
import { ChartCard } from "../components/ChartCard";
import { ReportCard } from "../components/ReportCard";
import { ToastProvider } from "../components/toast";
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

describe("engineering report", () => {
  const REPORT = {
    id: 5, flightId: 3, analysisId: 9, status: "COMPLETED", generator: "llm", llmProvider: "groq",
    llmModel: "openai/gpt-oss-120b", promptVersion: "r1", fallbackReason: null, error: null,
    createdAt: new Date().toISOString(), completedAt: new Date().toISOString(),
    content: {
      summary: "6 of 16 windows were above the threshold.",
      findings: [
        { statement: "Window 5 has the highest score, 1.", basis: "model_output", evidence: ["W5", "RUN"] },
        { statement: "Window 5 spans seconds 800 to 959.", basis: "measured", evidence: ["W5"] },
      ],
      removed: [{ statement: "The sensor should be replaced.", reason: "makes a claim outside the evidence (\"should be replaced\")" }],
      summaryReplaced: false,
    },
    evidence: {
      schema: "flightops.report-evidence/1",
      analysis: { analysis_id: 9, model_name: "if_tail_hybrid", model_version: "0.4.0", n_windows_scored: 16, n_windows_above_threshold: 6 },
      intervals: [], variables: [],
      windows: [{ ref: "W5", window_index: 5, start_seconds: 800, end_seconds: 959, anomaly_score: 1, threshold: 0.97, above_threshold: true }],
      limitations: ["Not a confirmed fault or a safety determination."],
    },
  };

  function renderCard(analysisId: number | null, reports: unknown[], onSelect = vi.fn()) {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "/api/v1/flights/3/reports") return json(reports);
      if (url === "/api/v1/reports/5") return json(REPORT);
      if (url === "/api/v1/reports" && init?.method === "POST") return json({ ...REPORT, id: 6, status: "PENDING", content: null, evidence: null }, 202);
      if (url === "/api/v1/reports/6") return json({ ...REPORT, id: 6, status: "RUNNING", content: null, evidence: null });
      return json({}, 404);
    }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><ToastProvider>
      <ReportCard flightId={3} analysisId={analysisId} onSelectWindow={onSelect} />
    </ToastProvider></QueryClientProvider>);
    return { calls, onSelect };
  }

  it("shows findings with their basis and evidence, removed statements, and selects cited windows", async () => {
    const { onSelect } = renderCard(9, [{ ...REPORT, content: undefined, evidence: undefined }]);
    expect(await screen.findByText("Window 5 has the highest score, 1.")).toBeInTheDocument();
    expect(screen.getByText("Written by openai/gpt-oss-120b")).toBeInTheDocument();
    expect(screen.getByText("Measured")).toBeInTheDocument();
    expect(screen.getByText("Model output")).toBeInTheDocument();
    expect(screen.getByText("Statements removed by validation (1)")).toBeInTheDocument();
    expect(screen.getByText(/1 removed/)).toBeInTheDocument();
    expect(screen.getByText("Not a confirmed fault or a safety determination.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Markdown" })).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getAllByRole("button", { name: "W5" })[0]!);
    expect(onSelect).toHaveBeenCalledWith(5);
    expect(screen.getAllByText("RUN")[0]!.tagName).toBe("SPAN");       // non-window refs are not buttons
  });

  it("needs a completed analysis, and starts a report on request", async () => {
    renderCard(null, []);
    expect(await screen.findByText("No report yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate report" })).toBeDisabled();
  });

  it("posts the analysis id and shows progress", async () => {
    const { calls } = renderCard(9, []);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Generate report" }));
    expect(await screen.findByText(/Writing report #6/)).toBeInTheDocument();
    expect(calls).toContain("POST /api/v1/reports");
    expect(screen.getByRole("button", { name: "Writing report…" })).toBeDisabled();
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
