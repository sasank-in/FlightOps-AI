# Dataset Card: NASA DASHlink Curated 4 Class Anomaly Detection Data Set

> Status: **Verified structure** (2026-11-10). Physical plausibility review in progress.

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

- `flight_record` is unique per row, so each window comes from a different flight
  record and there are **no repeated windows per flight**.
- `flight_record` looks like a structured ID (for example `652200101120916`). It
  may encode an aircraft and a date/time, but this is **not documented**. Before
  final evaluation, check whether splitting by any encoded aircraft or date changes
  results.
- 205 departure airports and 97 arrival airports. Consider an airport-held-out
  split as a robustness check.

## Known limitations and open questions

Value ranges observed across all samples (see `data-dictionary.md` for the full table):

1. **Flap position (idx 8)** is documented as "Discrete" but ranges 0–3766 with
   median 3654 and thousands of distinct values. The encoding is unknown, so don't
   treat it as degrees.
2. **Aileron positions (idx 0, 1)** range 41.9–124.5 with median ~84, which is not
   centred on 0 as expected for degrees of deflection. There may be an offset or
   a different encoding.
3. **True heading (idx 17)** spans −290 to +290, outside ±180 or 0–360. It may be
   unwrapped, so check before any circular encoding.
4. **Total pressure (idx 13)** has a minimum of −9.3 mbar, which is physically
   impossible. This may be a sensor dropout.
5. **Vertical acceleration (idx 18)** has a minimum of −4.03 g, which is likely spikes.
6. **Baro altitude (idx 3)** ranges from −170 to 14,039 ft, wide for a window near
   1,000 ft above touchdown.
7. Glideslope and localizer deviation are documented as "Percentage" but range
   ±0.8 and ±0.4, consistent with DDM units.
8. Only snapshot-level labels exist. There are no event intervals, so event-level
   metrics are not possible (documentation.md §14).

None of these values have been removed or changed.

## Transformations applied

| Version | Description | Date |
|---------|-------------|------|
| raw | Unmodified download (verified against archive digests) | 2026-11-10 |
