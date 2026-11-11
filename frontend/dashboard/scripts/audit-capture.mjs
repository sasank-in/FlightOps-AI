/**
 * Design-audit capture: responsive widths, empty states (fresh analyst), keyboard focus and
 * validation errors, in the installed Microsoft Edge. Writes to screenshots/audit/.
 *
 *   FLIGHTOPS_UI_USER=admin FLIGHTOPS_UI_PASSWORD=... node scripts/audit-capture.mjs
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const BASE = process.env.FLIGHTOPS_UI_URL ?? "http://127.0.0.1:5173";
const USER = process.env.FLIGHTOPS_UI_USER;
const PASSWORD = process.env.FLIGHTOPS_UI_PASSWORD;
const FLIGHT = process.env.FLIGHTOPS_UI_FLIGHT ?? "3";
const ANALYST = "audit-analyst";
const ANALYST_PASSWORD = "audit-analyst-password-1";
const OUT = new URL("../screenshots/audit/", import.meta.url);
if (!USER || !PASSWORD) { console.error("Set FLIGHTOPS_UI_USER and FLIGHTOPS_UI_PASSWORD"); process.exit(2); }
mkdirSync(OUT, { recursive: true });
const path = (name) => new URL(`${name}.png`, OUT).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const problems = [];
const browser = await chromium.launch({ channel: "msedge", headless: true });

async function session(width, height, user, password) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("frame-ancestors")) problems.push(`[${width}] console: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`[${width}] pageerror: ${e.message}`));
  await page.goto(BASE);
  if (user) {
    await page.getByLabel("Username").fill(user);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("heading", { name: "Overview" }).waitFor();
  }
  return { ctx, page };
}

async function shot(page, name, fullPage = true) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(350);
  await page.screenshot({ path: path(name), fullPage });
  console.log(`saved ${name}`);
}

// The empty-state analyst is enabled only for the duration of this run, then disabled again
// (its password is in this file, so it must never stay usable).
const admin = await (async () => {
  const login = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASSWORD }) });
  const { access_token } = await login.json();
  return { "Content-Type": "application/json", Authorization: `Bearer ${access_token}` };
})();
async function setAnalystEnabled(enabled) {
  await fetch(`${BASE}/api/v1/users`, { method: "POST", headers: admin,
    body: JSON.stringify({ username: ANALYST, password: ANALYST_PASSWORD, role: "ANALYST" }) });   // 409 if it exists: fine
  const users = await (await fetch(`${BASE}/api/v1/users`, { headers: admin })).json();
  const u = users.find((x) => x.username === ANALYST);
  await fetch(`${BASE}/api/v1/users/${u.id}`, { method: "PATCH", headers: admin, body: JSON.stringify({ enabled }) });
}
await setAnalystEnabled(true);

// desktop: keyboard focus on login and in the shell
{
  const { ctx, page } = await session(1440, 900);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await shot(page, "a01-login-focus", false);
  await page.getByLabel("Username").fill(USER);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Overview" }).waitFor();
  for (let i = 0; i < 3; i++) await page.keyboard.press("Tab");
  await shot(page, "a02-shell-focus", false);
  // upload dialog with an invalid file
  await page.goto(`${BASE}/flights?upload=1`);
  await page.locator('input[type="file"]').setInputFiles({ name: "bad.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ externalFlightReference: "bad ref", windows: [{ windowStartSeconds: 0, telemetry: { flap: [1] } }] })) });
  await shot(page, "a03-upload-invalid", false);
  await page.keyboard.press("Escape");
  // flight detail table view + audit
  await page.goto(`${BASE}/flights/${FLIGHT}`);
  await page.getByRole("heading", { name: "Anomaly score by window" }).waitFor();
  await page.getByRole("button", { name: "Table" }).first().click();
  await shot(page, "a04-detail-table-view");
  await ctx.close();
}

// empty states: analyst without flights
{
  const { ctx, page } = await session(1440, 900, ANALYST, ANALYST_PASSWORD);
  await shot(page, "a05-overview-empty");
  await page.goto(`${BASE}/flights`);
  await shot(page, "a06-flights-empty");
  await page.goto(`${BASE}/compare`);
  await shot(page, "a07-compare-empty");
  await ctx.close();
}

// tablet and mobile
for (const [w, h, tag] of [[1024, 768, "tablet"], [390, 844, "mobile"]]) {
  const { ctx, page } = await session(w, h, USER, PASSWORD);
  await shot(page, `a08-overview-${tag}`);
  await page.goto(`${BASE}/flights/${FLIGHT}`);
  await page.getByRole("heading", { name: "Anomaly score by window" }).waitFor();
  await shot(page, `a09-detail-${tag}`);
  await page.goto(`${BASE}/compare`);
  await shot(page, `a10-compare-${tag}`);
  if (tag === "mobile") {
    await page.getByRole("button", { name: "Open menu" }).click();
    await shot(page, "a12-mobile-menu-open", false);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 0) problems.push(`mobile: page is ${overflow}px wider than the viewport`);
  }
  await ctx.close();
}
{
  const { ctx, page } = await session(390, 844);
  await shot(page, "a11-login-mobile", false);
  await ctx.close();
}

await browser.close();
await setAnalystEnabled(false);
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
console.log("done, no console errors");
