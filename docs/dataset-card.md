# Dataset Card: NASA DASHlink Curated 4 Class Anomaly Detection Data Set

> Status: **Verified structure and data-quality review complete** (2026-11-10).

## Source

| Field | Value |
|-------|-------|
| Title | Curated 4 Class Anomaly Detection Data Set |
| Official dataset page | https://c3.ndc.nasa.gov/dashlink/resources/1018/ |
| Shared by / resource admin | Bryan Matthews (NASA Ames) |
| Documentation POC | Milad Memarzadeh (named in the data documentation PDF) |
| Documentation | `DASHlink_full_data_documentation.pdf` (3 pages, undated) |
| Full raw source data (per documentation) | https://c3.nasa.gov/dashlink/projects/85/ (Sample Flight Data) |
| Description (official page) | 160-second window snapshot of ~99K flights on final approach, crossing 1,000 ft before touchdown; 3 anomaly types and 1 nominal class |
| Last updated (official page) | 2022-12-22 |
| License / usage terms | Listed as "N/A" on the dataset page. No explicit license found. Treat redistribution as **not permitted**: do not commit or re-host the files |
| Access date | 2026-11-10 |

## Acquisition

On 2026-11-10 the NASA server (`c3.ndc.nasa.gov`, 128.102.105.71) did not accept
connections. The files were downloaded from Internet Archive raw captures of the
official file URLs:

| File | Archive capture used |
|------|----------------------|
| `DASHlink_full_fourclass_raw_comp.npz` | https://web.archive.org/web/20260426172441id_/https://c3.ndc.nasa.gov/dashlink/static/media/dataset/DASHlink_full_fourclass_raw_comp.npz |
| `DASHlink_full_fourclass_raw_meta.csv` | https://web.archive.org/web/20250602160955id_/https://c3.ndc.nasa.gov/dashlink/static/media/dataset/DASHlink_full_fourclass_raw_meta.csv |
| `DASHlink_full_data_documentation.pdf` | https://web.archive.org/web/20260427195548id_/https://c3.ndc.nasa.gov/dashlink/static/media/dataset/DASHlink_full_data_documentation.pdf |

**Integrity:** each file's SHA-1 matches the Wayback content digest, and the same
digest appears on several independent captures between 2024 and 2026
(the `.npz` digest `RZS5E3GBHTYIWU3TD56CUBNHURVG3ORW` appears on 4 captures). Some
earlier `.npz` captures have different digests and are truncated partial copies.
When the NASA server is reachable again, re-download from the official URL and
compare SHA-256 values.

## Files

| File | Size (bytes) | SHA-256 | Wayback SHA-1 (base32) |
|------|--------------|---------|------------------------|
| `DASHlink_full_fourclass_raw_comp.npz` | 1,759,319,547 | `c5807fe88e34b838e669d385e50e967c14032c0843c8b3cf915642480393d6a2` | `RZS5E3GBHTYIWU3TD56CUBNHURVG3ORW` |
| `DASHlink_full_fourclass_raw_meta.csv` | 4,101,030 | `aa464d2badc19553cea0cda419cb2c31277f9520728ace13a6278714b37bdc2e` | `Q4ETSNFD4N23E5CMWEXNQZZ3UPVYLPKR` |
| `DASHlink_full_data_documentation.pdf` | 435,573 | not recorded | `PBSNRTPHH2HHF6A55WOO4QNSKQW6SZKF` |

## Structure (verified)

| Item | Verified value | How verified |
|------|----------------|--------------|
| Archive keys | `data`, `label` | Documentation + `describe_npz` |
| Telemetry array | shape (99837, 160, 20), float64, 2.38 GB in memory | Inspection |
| Time axis | 1 (160 seconds; 1 Hz inferred from "window of time in seconds") | Documentation |
| Feature axis | 2 (20 variables, order in `data-dictionary.md`) | Documentation |
| Labels | shape (99837,), float64 with integer values 0–3 | Inspection |
| Label mapping | 0 Nominal, 1 Speed High, 2 Path High, 3 Flaps Late Setting | Documentation |
| Metadata | 99,837 rows; columns `data_instance`, `flight_record`, `departure_airport`, `departure_runway`, `arrival_airport`, `arrival_runway`, `label` | Inspection |
| Metadata alignment | `data_instance` = row index (unique); metadata `label` equals array label for all rows | `check_metadata_alignment` |
| Missing / non-finite | 0 in telemetry; 0 missing in metadata | `validate_snapshot_arrays` |

### Class distribution

| Label | Class | Count | Share |
|-------|-------|------:|------:|
| 0 | Nominal | 89,663 | 89.81% |
| 1 | Speed High | 7,013 | 7.02% |
| 2 | Path High | 2,207 | 2.21% |
| 3 | Flaps Late Setting | 954 | 0.96% |

The data is heavily imbalanced, so accuracy is not a useful metric (see documentation.md §14).

### Grouping and leakage

- `flight_record` is unique per row, so there are no repeated windows per flight *record*.
- **Inferred layout** (undocumented, but all 99,837 records match it): 3-digit aircraft id +
  `YYYYMMDDHHMM`. This gives **35 aircraft** (2,236–3,474 windows each) and record
  dates 1998–2010, mostly 2001–2004. Parsed by `flightops.data.quality.parse_flight_record`.
- **Aircraft 657 is an outlier, and its labels are questionable:** 89% of its windows are
  anomalous (2,237 Speed High), about 32% of all Speed High labels. Other aircraft range
  6.7–9%. Its Speed High windows match nominal approaches in airspeed, flap timing and
  throttle (notebook 03), and the baseline flags them at the nominal false-alarm rate. Evaluate
  with **aircraft held out**, report results with and without 657, and ask the dataset POC.
- **97 exact duplicate window pairs** (identical telemetry, aircraft, route and label).
  One copy is dated 2001–2002 and the other 2009, sometimes a day apart. They look
  like the same flight stored twice, so drop the second copy before splitting. The
  2009–2010 dates are suspect.
- 205 departure airports and 97 arrival airports.

## Data-quality findings (notebooks/02_data_quality.ipynb)

Per-window flags are written to `artifacts/reports/data_quality_flags.csv`. None of
these values have been removed or changed in the raw or processed data.

| # | Variable | Finding | Phase 2 decision |
|---|----------|---------|------------------|
| 1 | Flap (8) | Raw position count, not degrees or detents: steps of ~110–125 while moving, final setting ~3,650–3,700. 43 windows have >1,000-count glitches | Continuous; derive time to reach ≥3,600; flag jumps |
| 2 | Aileron LH/RH (0, 1) | Centred ~83–85, hard floor at 41.9, LH/RH correlation only 0.18. "Degree" does not match | Standardise only; low confidence in explanations; ask dataset owner |
| 3 | True heading (17) | Degrees, but wrapping past ±180° is inconsistent (12.2% of windows reach ±290). Wrapping fixes all of them | Wrap to [-180, 180), then sin/cos; same for course and selected heading |
| 4 | Total pressure (13) | 39 windows at 26–107 mbar for the whole window, **all from aircraft 684** (sensor fault) | Flag; exclude from nominal training |
| 5 | Vertical accel (18) | 1–2-sample spikes outside [-1, 2.5] g in 10.7% of windows, similar rate in all classes | Robust statistics; optional median filter |
| 6 | Altitude (3) | Barometric MSL. High values are high-elevation airports (KASE, KDEN, KSLC) | Use altitude relative to window end or airport |
| 7 | Glideslope / localizer (9, 11) | Documented as "Percentage" but range ±0.8 / ±0.4, consistent with DDM | Use as-is |
| 8 | Selected course / heading (5, 10) | Constant in 98% / 76% of windows | Low within-window information |

### Other observations

- Windows **end at touchdown** (flare and throttle cut in the last ~10 s) and start about
  1,700–2,300 ft above that point.
- Class behaviour matches the label names (time to final flaps, glideslope deviation,
  approach speed). See `notebooks/01_dataset_overview.ipynb`.
- Only snapshot-level labels exist. There are no event intervals, so event-level metrics
  are not possible (documentation.md §14).

## Transformations applied

| Version | Description | Date |
|---------|-------------|------|
| raw | Unmodified download (verified against archive digests) | 2026-11-10 |
| processed v1 | `data/processed/telemetry_float32.npy` (float64→float32, max abs error 4.8e-4, max rel error 6.0e-8) and `labels_int8.npy`. Built by `python -m flightops.data.processed`; provenance in `manifest.json` | 2026-11-10 |
