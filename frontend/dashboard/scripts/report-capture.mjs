/**
 * Visual QA for the Phase 7 report card and the flights list: generates a report on a flight in the
 * running dashboard (Edge, headless) and saves light, dark and mobile screenshots. Fails on console
 * errors, failed requests, 5xx responses or horizontal overflow.
 *
 *   FLIGHTOPS_UI_USER=admin FLIGHTOPS_UI_PASSWORD=... node scripts/report-capture.mjs
 *   (optional) FLIGHTOPS_UI_URL=http://127.0.0.1:5173  FLIGHTOPS_UI_FLIGHT=3
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const BASE = process.env.FLIGHTOPS_UI_URL ?? "http://127.0.0.1:5173";
const USER = process.env.FLIGHTOPS_UI_USER;
const PASSWORD = process.env.FLIGHTOPS_UI_PASSWORD;
const FLIGHT = process.env.FLIGHTOPS_UI_FLIGHT ?? "3";
const OUT = new URL("../screenshots/report/", import.meta.url);
if (!USER || !PASSWORD) {
  console.error("Set FLIGHTOPS_UI_USER and FLIGHTOPS_UI_PASSWORD");
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });
const file = (name) => new URL(`${name}.png`, OUT).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const problems = [];
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("requestfailed", (r) => problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
page.on("response", (r) => { if (r.status() >= 500) problems.push(`HTTP ${r.status()}: ${r.url()}`); });

async function overflow(label) {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (o > 0) problems.push(`${label}: horizontal overflow ${o}px`);
}

await page.goto(BASE);
await page.getByLabel("Username").fill(USER);
await page.getByLabel("Password").fill(PASSWORD);
await page.getByRole("button", { name: "Sign in" }).click();
await page.getByRole("heading", { name: "Overview" }).waitFor();

// Flights list: search + latest-analysis columns
await page.goto(`${BASE}/flights`);
await page.getByRole("searchbox", { name: "Search flight reference" }).waitFor();
await page.waitForLoadState("networkidle");
await page.screenshot({ path: file("r01-flights"), fullPage: true });
await page.getByRole("searchbox", { name: "Search flight reference" }).fill("no-such-flight");
await page.getByRole("heading", { name: "No matching flights" }).waitFor();
await page.screenshot({ path: file("r02-flights-no-match"), fullPage: true });

// Flight detail: generate a report and wait for it
await page.goto(`${BASE}/flights/${FLIGHT}`);
const card = page.locator("section.card", { has: page.getByRole("heading", { name: "Engineering report" }) });
await card.waitFor();
await page.waitForLoadState("networkidle");
const generate = card.getByRole("button", { name: /Generate report|New report/ });
await generate.click();
await card.getByText(/Writing report #\d+/).waitFor();              // the new report, not the previous one
await card.getByRole("heading", { name: "Findings" }).waitFor({ timeout: 90_000 });
await page.waitForTimeout(300);
await card.scrollIntoViewIfNeeded();
await card.screenshot({ path: file("r03-report-light") });
console.log("generator:", await card.locator(".report-meta .badge").last().innerText());

// A window citation selects that window
const ref = card.locator("button.ref").first();
if (await ref.count()) {
  const label = await ref.innerText();
  await ref.click();
  await page.waitForTimeout(600);
  console.log("clicked", label, "-> window panel:", await page.locator("#window-detail h2").first().innerText());
}

await page.getByRole("button", { name: "Switch to dark theme" }).click();
await page.waitForTimeout(300);
await card.scrollIntoViewIfNeeded();
await card.screenshot({ path: file("r04-report-dark") });
await page.getByRole("button", { name: "Switch to light theme" }).click();
await overflow("desktop detail");

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
await card.scrollIntoViewIfNeeded();
await card.screenshot({ path: file("r05-report-mobile") });
await overflow("mobile detail");
await page.goto(`${BASE}/flights`);
await page.getByRole("searchbox", { name: "Search flight reference" }).waitFor();
await page.waitForLoadState("networkidle");
await page.screenshot({ path: file("r06-flights-mobile"), fullPage: true });
await overflow("mobile flights");

await browser.close();
if (problems.length) {
  console.error("PROBLEMS:\n" + problems.join("\n"));
  process.exit(1);
}
console.log("OK: no console errors, failed requests or overflow");
