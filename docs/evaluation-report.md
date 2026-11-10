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

## Conv autoencoder v0.1.0 (CPU run, 2026-11-10)

Reproduce: `python -m flightops.models.train_autoencoder` (full run 20 min on CPU, 30 epochs × ~38 s).
Input: 23 preprocessed channels × 160 s, standardised on training nominal windows. Same split as the
forest (identical `split_fingerprint`), same training windows and threshold policy.

| Model / test subset | Precision | Recall | PR-AUC | ROC-AUC | Speed High | Path High | Flaps Late |
|---------------------|----------:|-------:|-------:|--------:|-----------:|----------:|-----------:|
| Isolation Forest, all | 0.394 | 0.294 | 0.324 | 0.758 | 0.142 | 0.755 | 0.343 |
| Autoencoder, all | 0.395 | 0.292 | 0.279 | 0.744 | 0.240 | 0.495 | 0.203 |
| Isolation Forest, without 657 | 0.386 | 0.365 | 0.349 | 0.815 | 0.186 | 0.755 | 0.343 |
| Autoencoder, without 657 | 0.270 | 0.213 | 0.192 | 0.713 | 0.083 | 0.495 | 0.203 |

Validation loss was still decreasing at epoch 30 (0.094), so the model is under-trained.

**The autoencoder's apparent Speed High gain is an artifact.** It flags aircraft 657's Speed High
windows (56%) because of the faulty *selected course* channel. The channels with the largest error
increase for Speed High are absolute heading/course (true-heading-cos error 24× nominal). Without
aircraft 657, it detects only 8% of Speed High. Path High and Flaps Late errors do concentrate in
the expected channels (altitude profile; flap 66× nominal).

**Next:** input channels v2 should drop the absolute heading/course channels, which encode runway
direction and carry the 657 fault, and keep only relative ones such as turn rate and drift angle.
Then retrain both models, ideally on a GPU with more epochs and aircraft-held-out folds.

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
