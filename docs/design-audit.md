# Dashboard Design Audit (2026-11-11)

Scope: `frontend/dashboard`, the Phase 6 analyst dashboard.

**Method:**
- Captured every page in light and dark themes at desktop (1440 px), tablet (1024 px) and mobile
  (390 px) widths.
- Also captured empty states (a fresh analyst account), keyboard focus, upload validation errors, and
  the table views.
- Used the installed Microsoft Edge (`npm run screenshots`, `scripts/audit-capture.mjs`).
- Computed text contrast numerically, and added an automatic horizontal-overflow check for mobile.

All findings below are **fixed** and re-verified on the production build: no console errors, and no
horizontal overflow on any page.

| # | Severity | Area | Finding | Change |
|---|----------|------|---------|--------|
| 1 | High | Responsive | At ≤ 860 px the navy sidebar gradient sat behind the content (page title unreadable), the page scrolled sideways, the full navigation stacked above every page, and the top bar overflowed | Compact sticky top bar with a menu button (Escape and navigation close it); gradient only on desktop; user details collapse to the avatar; sign-out becomes an icon below 480 px; automated check that `scrollWidth` equals the viewport |
| 2 | High | Responsive | The Compare page's scores table was not in the scrollable table wrapper and was 112 px wider than the phone screen | Wrapped like every other table; overflow check now runs on each page |
| 3 | High | Consistency | The Compare empty state dropped the page header | Header rendered in every state (loading, error, empty, data) |
| 4 | Medium | Navigation | Breadcrumbs were plain text and showed "#3" instead of the flight | Linked breadcrumbs (`FlightOps AI / Flights / <flight reference>`); on phones only the current page shows |
| 5 | Medium | Layout | Paired cards stretched to equal height, leaving large blank areas (Users accounts, Overview chart, anomaly chart beside a taller evidence panel) | Grid cards size to content by default; `.equal` pairs used deliberately, with charts that grow to fill. Flight detail restructured as master/detail: full-width score timeline, then the selected window's evidence beside its telemetry |
| 6 | Medium | UX | 20 ungrouped signal chips wrapped over three lines | Signals grouped as an analyst reads an approach (Speed & energy, Flight path, Configuration & controls, Heading & course); selected count, Clear and Reset; the same groups in the Compare signal selector |
| 7 | Medium | Content | Evidence showed model channel names ("aileron lh (rel. median)", "iqr", "mean_abs_diff") | Readable signal and statistic names ("Trailing-edge flap", "Interquartile range, relative to window end"); units shown under the value |
| 8 | Medium | Feedback | Actions gave no consistent confirmation (analysis start and completion, delete, upload, account changes) | Toast notifications (polite live region, auto-dismiss, errors stay longer); inline success banners removed |
| 9 | Medium | Upload | Validation errors listed every missing variable (an unreadable wall of text); no example file | Errors summarised ("missing 19 of 20 signals (… and 16 more)"); **Download template** button gives a valid starter file |
| 10 | Medium | Readability | The score had no visual context against the threshold; time was shown in raw seconds (800–959) | Score meter with a threshold marker; times as clock values (`13:20–16:00 into the flight`), also in the window selectors and flight duration |
| 11 | Low | Consistency | The disclaimer appeared twice (sidebar and a card on every page) | Page notice is now a quiet footer line; the sidebar keeps the short form |
| 12 | Low | Consistency | Mixed number and icon sizes (stat values 26/28 px, icons 14/15/16 px) | One stat scale (28 px tiles, 24 px panel value); all button icons 16 px |
| 13 | Low | Tables | The Flights ID column was isolated at the far right; the model card listed raw field names only | ID first, references emphasised, duration as a clock; model card shows readable name, field name, unit, and whether the signal is a model input |
| 14 | Low | Admin | The audit log had no filtering | Outcome filter (All / Success / Denied / Failure) with counts |
| 15 | Low | Safety of actions | The second "Confirm delete" click looked the same as the first | Armed state is a filled red button and disarms on blur or after 4 s |
| 16 | Low | Accessibility | No skip link for keyboard users | "Skip to content" link; main region focusable |

Carried over from the first review (still in force):
- validated chart palette in both themes;
- a table view for every chart;
- status always shown as icon + label;
- WCAG AA text contrast, computed: muted text 4.8:1 on the page; links 6.6:1 light / 8.3:1 dark.

**Verification:**
- 17 dashboard unit and integration tests, strict TypeScript (`noUncheckedIndexedAccess`).
- `npm run screenshots` and `node scripts/audit-capture.mjs` pass on the production build: no console
  errors, no failed requests, no mobile overflow.
- The audit's temporary analyst account is enabled only during a capture run and disabled again
  afterwards.
