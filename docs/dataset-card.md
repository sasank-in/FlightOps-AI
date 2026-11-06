# Dataset Card: NASA DASHlink Four-Class Flight Anomaly Dataset

> Status: **NOT YET VERIFIED.** Fill in each field from the official source.
> Do not copy values from `documentation.md` without confirming them.

## Source

| Field | Value |
|-------|-------|
| Official dataset page URL | |
| Documentation URL / version | |
| Download URL(s) | |
| Access date | |
| License / usage terms | |
| Redistribution permitted? | |
| Citation | |

## Files

Generate with `python -m flightops.data.inspect --json-out artifacts/reports/dataset_inspection.json`.

| File | Size (bytes) | SHA-256 |
|------|--------------|---------|
| `DASHlink_full_fourclass_raw_comp.npz` | | |
| `DASHlink_full_fourclass_raw_meta.csv` | | |

## Structure (verified)

| Item | Candidate | Verified value | How verified |
|------|-----------|----------------|--------------|
| Archive keys | `data`, `label` (?) | | |
| Telemetry array shape | ~(99000, 160, 20) | | |
| Telemetry dtype | | | |
| Time axis | | | |
| Feature axis | | | |
| Sampling frequency | 1 Hz | | |
| Label values | 4 classes | | |
| Label-to-name mapping | | | |
| Metadata rows | | | |
| Metadata columns | | | |
| Flight/group identifier | | | |

## Known limitations

- 

## Transformations applied

| Version | Description | Date |
|---------|-------------|------|
| raw | Unmodified download | |
