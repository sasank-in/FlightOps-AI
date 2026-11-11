/**
 * Visual QA: drives the running dashboard in the locally installed Microsoft Edge (no browser
 * download) and saves screenshots of every page in light and dark themes. Fails if the browser
 * logs console errors or a request fails.
 *
 *   FLIGHTOPS_UI_USER=admin FLIGHTOPS_UI_PASSWORD=... npm run screenshots
 *   (optional) FLIGHTOPS_UI_URL=http://127.0.0.1:4173  FLIGHTOPS_UI_FLIGHT=3
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const BASE = process.env.FLIGHTOPS_UI_URL ?? "http://127.0.0.1:4173";
const USER = process.env.FLIGHTOPS_UI_USER;
const PASSWORD = process.env.FLIGHTOPS_UI_PASSWORD;
const FLIGHT = process.env.FLIGHTOPS_UI_FLIGHT ?? "3";
const OUT = new URL("../screenshots/", import.meta.url);
if (!USER || !PASSWORD) {
  console.error("Set FLIGHTOPS_UI_USER and FLIGHTOPS_UI_PASSWORD");
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

const problems = [];
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("requestfailed", (r) => problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
page.on("response", (r) => { if (r.status() >= 500) problems.push(`HTTP ${r.status()}: ${r.url()}`); });

async function shot(name, fullPage = true) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  await page.screenshot({ path: new URL(`${name}.png`, OUT).pathname.replace(/^\/([A-Za-z]:)/, "$1"), fullPage });
  console.log(`saved ${name}.png`);
}

await page.goto(BASE);
await shot("01-login", false);
await page.getByLabel("Username").fill(USER);
await page.getByLabel("Password").fill(PASSWORD);
await page.getByRole("button", { name: "Sign in" }).click();
await page.getByRole("heading", { name: "Overview" }).waitFor();

for (const theme of ["light", "dark"]) {
  if (theme === "dark") await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await page.goto(`${BASE}/`);
  await page.getByRole("heading", { name: "Overview" }).waitFor();
  await shot(`02-overview-${theme}`);
  await page.goto(`${BASE}/flights/${FLIGHT}`);
  await page.getByRole("heading", { name: "Anomaly score by window" }).waitFor();
  await page.getByText("Most unusual signals").waitFor();
  await shot(`03-flight-detail-${theme}`);
}
await page.getByRole("button", { name: "Switch to light theme" }).click();

await page.goto(`${BASE}/flights`);
await page.getByRole("heading", { name: "Flights" }).waitFor();
await shot("04-flights");
await page.getByRole("button", { name: "Upload flight" }).click();
await shot("05-upload-dialog", false);
await page.keyboard.press("Escape");

await page.goto(`${BASE}/compare`);
await page.getByRole("heading", { name: "Compare flights" }).waitFor();
await shot("06-compare");
await page.goto(`${BASE}/model`);
await page.getByRole("heading", { name: "Model card" }).waitFor();
await shot("07-model");
await page.goto(`${BASE}/users`);
await page.getByRole("heading", { name: "Users" }).waitFor();
await shot("08-users");
await page.goto(`${BASE}/audit`);
await page.getByRole("heading", { name: "Audit log" }).waitFor();
await shot("09-audit");

// table view and hover tooltip on the anomaly timeline
await page.goto(`${BASE}/flights/${FLIGHT}`);
await page.getByRole("heading", { name: "Anomaly score by window" }).waitFor();
const bars = page.locator(".recharts-bar-rectangle");
await bars.nth(2).hover();
await shot("10-tooltip", false);

await browser.close();
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n` + problems.join("\n"));
  process.exit(1);
}
console.log("\nNo console errors or failed requests.");
