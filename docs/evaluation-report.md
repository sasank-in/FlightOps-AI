# Evaluation Report: Isolation Forest Baseline (v0.1.0)

> Experimental statistical results on snapshot-level labels. These are not validated
> detection performance for any operational or safety use.

Reproduce with `python -m flightops.models.train_baseline` (about 1 minute). Full results are
written to `artifacts/reports/baseline_isolation_forest.json`. Plots are in
`notebooks/04_baseline_anomaly_detection.ipynb`.

## Setup

| Item | Value |
|------|-------|
| Data | 99,837 windows; 97 duplicate copies excluded → 99,740 |
| Features | v1: 23 preprocessed channels × 10 window statistics = 230 (`flightops.features.build_features`) |
| Preprocessing | Heading/course wrapped then sin/cos; altitude relative to window end; 3-sample median filter on vertical acceleration; standardisation fitted on training nominal windows |
| Model | `IsolationForest(n_estimators=200, max_samples="auto", random_state=42)` |
| Training windows | Nominal windows in the training split, excluding 39 `pressure_invalid` windows (60,957) |
| Score | Higher = more anomalous (negated `score_samples`) |
| Threshold | Alert budget: 95th percentile of **nominal validation** scores (5% target false-positive rate). No anomaly labels used |
| Primary split | Stratified 70 / 15 / 15 by label (seed 42) |
| Robustness | 5-fold `StratifiedGroupKFold` with aircraft as groups (7 aircraft held out per fold); threshold from 15% of each fold's training nominal windows |

## Results: stratified test split (anomaly = any non-nominal class)

| Threshold | Precision | Recall | F1 | FPR | PR-AUC | ROC-AUC |
|-----------|----------:|-------:|---:|----:|-------:|--------:|
| 5% nominal budget | 0.394 | 0.294 | 0.337 | 0.051 | 0.324 | 0.758 |
| Best-F1 on validation (reference only) | 0.356 | 0.350 | 0.353 | 0.072 | 0.324 | 0.758 |

Anomaly prevalence in test ≈ 10.2%, so a random detector has PR-AUC ≈ 0.10.

### Alert rate by class (5% budget)

| Class | Alert rate |
|-------|-----------:|
| Nominal (false alarms) | 0.051 |
| Speed High | 0.142 |
| Path High | 0.755 |
| Flaps Late Setting | 0.343 |

## Results: aircraft held out (5 folds)

| Metric | Mean | Std | Min | Max |
|--------|-----:|----:|----:|----:|
| PR-AUC | 0.339 | 0.015 | 0.327 | 0.368 |
| Recall | 0.311 | 0.067 | 0.182 | 0.370 |
| FPR | 0.050 | 0.005 | 0.045 | 0.058 |

Performance on unseen aircraft matches the stratified split, so the model is not relying on aircraft
identity. The low-recall fold (0.182) is the one that holds out aircraft 657.

## Label concern: aircraft 657

Aircraft 657 holds 2,237 of 7,013 Speed High labels (32%). Notebook 03 shows its Speed High windows
are indistinguishable from nominal approaches in airspeed (peak ≈160 kt vs ≈181 kt for Speed High on
other aircraft), flap timing and throttle. The baseline flags them at 5.0%, the same as the nominal
false-alarm rate.

| Test subset | Precision | Recall | PR-AUC | Speed High detection |
|-------------|----------:|-------:|-------:|---------------------:|
| All test windows | 0.394 | 0.294 | 0.324 | 0.142 |
| Without aircraft 657 | 0.386 | 0.365 | 0.349 | 0.186 |
| Aircraft 657 Speed High only | — | — | — | 0.050 |

These labels may follow an aircraft-specific rule or may be wrong. This cannot be resolved from the
dataset, so it has been raised as an open question for the dataset POC. Future results should be
reported both with and without aircraft 657.

## Interpretation and next steps

- The baseline is clearly better than random but weak for Speed High and Flaps Late.
- Notebook 03 shows single features with near-perfect separation (flap median for Flaps Late,
  altitude profile for Path High). The forest dilutes these across 230 redundant, correlated
  features.
- Phase 3 candidates:
  - autoencoder on per-second channels (documentation.md §13.2);
  - reduced or decorrelated feature set for the forest;
  - supervised classifier as an **upper-bound reference only**;
  - stability across random seeds.
