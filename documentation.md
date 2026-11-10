# FlightOps AI

## End-to-End Project Documentation

**Project:** FlightOps AI --- Intelligent Flight Telemetry Analysis &
Anomaly Detection Platform\
**Initial implementation strategy:** ML-first (Python), followed by
backend and frontend integration\
**Primary language:** Python 3.12.10\
**Project type:** Applied ML / Aerospace Data Analytics / AI
Engineering\
**Status:** Phase 1 in progress. Dataset verified and data-quality
review completed on 2026-11-10 (see `docs/dataset-card.md`). The
exploratory analysis notebook (03) is pending.

------------------------------------------------------------------------

## 1. Project Overview

FlightOps AI is an experimental flight-telemetry analytics platform that
ingests aircraft telemetry, validates and processes time-series
measurements, detects unusual patterns, visualizes flight behavior, and
generates evidence-backed engineering summaries.

The initial version focuses on **flight-approach telemetry analysis**
using a public, de-identified dataset. Later iterations can add
simulated streaming, model monitoring, and an AI assistant for querying
analysis results.

### 1.1 Problem Statement

Flight telemetry consists of multiple measurements sampled over time.
Reviewing these signals manually can make it difficult to:

-   Explore relationships between sensor measurements.
-   Identify unusual temporal patterns.
-   Compare telemetry across flights.
-   Prioritize time intervals for engineering review.
-   Reproduce and document analytical findings.

FlightOps AI aims to provide a repeatable data and ML workflow for these
tasks.

### 1.2 Proposed Solution

The platform will:

1.  Import telemetry datasets and associated metadata.
2.  Validate schemas, timestamps, labels, and measurement values.
3.  Perform exploratory data analysis (EDA).
4.  Engineer time-series features.
5.  Train and evaluate anomaly-detection models.
6.  Store model outputs and anomaly events.
7.  Expose inference and analysis through APIs.
8.  Present flights, signals, and detected events in a dashboard.
9.  Optionally use an LLM to summarize verified analysis results with
    references to the underlying evidence.

### 1.3 Intended Users

-   Data scientists and ML engineers exploring flight telemetry.
-   Aerospace engineering students and researchers.
-   Engineering analysts reviewing experimental anomaly-detection
    outputs.
-   Developers evaluating time-series ML pipelines.

This is an educational and engineering analytics project. It is **not**
an aircraft control, dispatch, maintenance approval, or certified
flight-safety system.

------------------------------------------------------------------------

## 2. Goals and Non-Goals

### Goals

-   Build a reproducible telemetry ingestion and preprocessing pipeline.
-   Understand the dataset before selecting models.
-   Establish a measurable baseline.
-   Compare unsupervised and supervised approaches where labels permit.
-   Evaluate false positives and false negatives, not accuracy alone.
-   Provide traceable anomaly events with supporting measurements.
-   Package inference behind a maintainable API.
-   Build a usable dashboard and deployment workflow.

### Non-Goals

The initial project will not:

-   Predict or certify aircraft airworthiness.
-   Recommend operational actions to pilots.
-   Replace flight-data analysts or maintenance engineers.
-   Claim that statistical anomalies are confirmed mechanical faults.
-   Infer aircraft-specific safe operating limits without authoritative
    aircraft documentation.
-   Train on confidential or restricted aircraft data.

------------------------------------------------------------------------

## 3. Scope and Delivery Phases

| Phase | Scope | Main deliverables |
|-------|-------|-------------------|
| 1 | Dataset acquisition and EDA | Dataset manifest, environment, schema report, EDA notebook |
| 2 | Feature engineering and baseline ML | Reusable preprocessing, Isolation Forest baseline |
| 3 | Model comparison and evaluation | Autoencoder experiments, metrics, error analysis |
| 4 | Python inference API | FastAPI endpoints, validation, model loading |
| 5 | Application backend | Spring Boot services, authentication, flight and report APIs |
| 6 | Frontend | React dashboard, flight explorer, anomaly timeline |
| 7 | AI engineering assistant | Evidence-grounded summaries and report generation |
| 8 | MLOps and deployment | MLflow, Docker, CI, monitoring, deployment documentation |

The first milestone is deliberately ML-first. Do not build all
microservices before the data schema and model requirements are
understood.

------------------------------------------------------------------------

## 4. Dataset Strategy

### 4.1 Initial Dataset

The initial candidate is the NASA DASHlink curated four-class flight
anomaly dataset.

The dataset has been described as containing approximately 99,000 flight
snapshots, each with a 160-second window sampled at 1 Hz, 20 telemetry
variables, and four class labels. These details must be rechecked
against the current dataset files and accompanying documentation before
being treated as final project facts.

Candidate files:

``` text
DASHlink_full_fourclass_raw_comp.npz      (~1.6 GB)
DASHlink_full_fourclass_raw_meta.csv      (~3.9 MB)
DASHlink_full_data_documentation.pdf      (official data documentation)
```

Official source:

-   Dataset page: **Curated 4 Class Anomaly Detection Data Set**
    https://c3.ndc.nasa.gov/dashlink/resources/1018/ (shared by Bryan
    Matthews, NASA Ames; license listed as "N/A")
-   File URLs:
    `https://c3.ndc.nasa.gov/dashlink/static/media/dataset/<file name>`
-   DASHlink moved from `c3.nasa.gov` to `c3.ndc.nasa.gov`; the old
    domain no longer serves the site.

**Fallback when the NASA server is unreachable:** the Internet Archive
holds byte-for-byte captures of the official file URLs. Use a raw
(`id_`) capture, for example:

``` text
https://web.archive.org/web/20260426172441id_/https://c3.ndc.nasa.gov/dashlink/static/media/dataset/DASHlink_full_fourclass_raw_comp.npz
```

Only use a capture whose Wayback digest appears on several snapshots,
because truncated partial captures also exist. Verify the downloaded file
against that digest (base32-encoded SHA-1), then record both the archive
URL and the original NASA URL in `docs/dataset-card.md`.

**Acquisition rule:** Download data only from the dataset's official
NASA-hosted page, an explicitly linked official repository, or a
verified archival copy of the official file URLs (see above). Record the
exact download URL, access date, file size, checksum, license/usage
terms, and documentation version in `docs/dataset-card.md`.

Do not assume that a file name, label mapping, feature order, or array
shape is correct until it has been inspected.

### 4.2 Dataset Characteristics to Verify

| Item | Expected / candidate value | Verified (2026-11-10) |
|------|----------------------------|-----------------------|
| Number of snapshots | Approximately 99,000 | 99,837 |
| Window duration | 160 seconds | 160 (time axis = 1) |
| Sampling frequency | 1 Hz | 1 Hz (window "in seconds", per official docs) |
| Number of variables | 20 | 20 (feature axis = 2) |
| Number of classes | 4 | 4: 0 Nominal 89.8%, 1 Speed High 7.0%, 2 Path High 2.2%, 3 Flaps Late 1.0% |
| Data format | NumPy archive (`.npz`) | Keys `data` (float64) and `label` (float64) |
| Metadata | CSV | 99,837 rows, aligned 1:1 with arrays; `flight_record` unique per row |

Full details, checksums, and open data-quality questions are in
`docs/dataset-card.md` and `docs/data-dictionary.md`.

**Memory note:** at the candidate size (99,000 × 160 × 20 values), the
array is roughly 2.4 GB as float64 or 1.2 GB as float32. Arrays inside an
`.npz` cannot be memory-mapped, so check `dtype` and available RAM before
loading the full array, and avoid creating unnecessary full-size copies
(for example, during reshaping or casting).

### 4.3 Candidate Class Labels

The dataset has been described with four categories:

-   Nominal
-   High speed
-   High flight path
-   Late flap setting

Do not hard-code numeric label-to-name mappings until confirmed by the
official metadata/documentation.

### 4.4 Candidate Telemetry Variables

The following is a working list from the dataset description. Confirm
exact spelling, order, units, and definitions against the official
documentation.

1.  Left aileron position
2.  Right aileron position
3.  Corrected angle of attack
4.  Barometric corrected altitude
5.  Computed airspeed
6.  Selected course
7.  Drift angle
8.  Left elevator position
9.  Trailing-edge flap position
10. Glideslope deviation
11. Selected heading
12. Localizer deviation
13. Core speed average
14. Total pressure
15. Pitch angle
16. Roll angle
17. Rudder position
18. True heading
19. Vertical acceleration
20. Wind speed

Some variables may be discrete, circular, bounded, or correlated. Their
physical meaning must inform preprocessing and feature engineering.

### 4.5 Data Governance

Keep raw data immutable. Do not commit large datasets to Git.

Record:

-   Source URL and access date.
-   Dataset documentation URL/version.
-   License and permitted usage.
-   Original file names and byte sizes.
-   SHA-256 checksums.
-   Data transformations and output versions.

If dataset redistribution is restricted, provide acquisition
instructions rather than copying the data into the repository.

------------------------------------------------------------------------

## 5. Technology Stack

### 5.1 ML and Data Science

| Concern | Initial choice |
|---------|----------------|
| Runtime | Python 3.12.10 |
| Arrays | NumPy |
| Tabular processing | pandas |
| Scientific utilities | SciPy |
| Classical ML | scikit-learn |
| Deep learning | PyTorch |
| Visualization | Matplotlib and Plotly |
| Notebooks | JupyterLab |
| Configuration | YAML / environment variables |
| Testing | pytest |

Pin compatible dependency versions after the first environment has been
verified. Commit a lock file or fully pinned requirements file for
reproducible installs.

### 5.2 Backend and Frontend (later phases)

| Layer | Proposed technology |
|-------|---------------------|
| Application backend | Java 21, Spring Boot |
| ML inference API | Python, FastAPI |
| Frontend | React, TypeScript |
| Database | PostgreSQL |
| Time-series extension | TimescaleDB, if justified |
| Event streaming | Kafka, for streaming phase |
| Cache / task support | Redis, if needed |
| Experiment tracking | MLflow |
| Containers | Docker / Docker Compose |
| Orchestration | Kubernetes, only when deployment needs justify it |
| LLM provider | Groq or another configured provider |

Use a modular monolith initially where possible. Extract services when
there is a clear scaling, ownership, or deployment reason.

------------------------------------------------------------------------

## 6. High-Level Architecture

### 6.1 Initial ML-First Architecture

``` text
             Public flight telemetry dataset
                          |
                          v
                Dataset inspection
                          |
                          v
             Validation and preprocessing
                          |
                          v
                Feature engineering
                          |
                          v
               Train / validation split
                          |
                          v
                Anomaly detection
                          |
                          v
               Evaluation and analysis
                          |
             +------------+------------+
             |                         |
             v                         v
       Model artifacts           Evaluation reports
```

### 6.2 Target Application Architecture

``` text
                  React + TypeScript UI
                           |
                           v
                  Spring Boot backend
                 /        |         \
                /         |          \
        Auth / Users   Flight API   Report API
                           |
                           v
                    Python FastAPI
                     ML inference
                           |
             +-------------+-------------+
             |             |             |
             v             v             v
         Preprocess    ML models     Explanation
             |             |             |
             +-------------+-------------+
                           |
                           v
                       PostgreSQL

Optional later:
Telemetry producer -> Kafka -> ingestion worker -> inference
MLflow -> experiment and model tracking
LLM provider -> evidence-grounded report generation
```

### 6.3 Service Responsibilities

**Python ML package**

-   Dataset loading and validation.
-   Preprocessing and feature engineering.
-   Model training and evaluation.
-   Batch and online inference.
-   Model artifact loading and version checks.

**FastAPI inference service**

-   Accept validated inference requests.
-   Return model version, anomaly scores, and event information.
-   Apply request limits and structured error responses.
-   Never expose arbitrary model execution or filesystem paths.

**Spring Boot application**

-   Authentication and authorization.
-   User and flight metadata management.
-   Orchestrating inference requests.
-   Persisting analysis jobs and report metadata.
-   API access control and audit events.

**React application**

-   Flight list and detail pages.
-   Telemetry charts.
-   Anomaly timeline and event details.
-   Model and analysis metadata.
-   Report viewing and download.

------------------------------------------------------------------------

## 7. Repository Structure

Use a monorepo during initial development.

``` text
flightops-ai/
├── data/
│   ├── raw/                  # Original downloaded files; not committed
│   ├── processed/            # Versioned derived datasets; not committed
│   └── external/             # Other externally sourced data
│
├── notebooks/
│   ├── 01_dataset_overview.ipynb
│   ├── 02_data_quality.ipynb
│   ├── 03_exploratory_analysis.ipynb
│   ├── 04_baseline_anomaly_detection.ipynb
│   └── 05_model_comparison.ipynb
│
├── src/
│   └── flightops/
│       ├── __init__.py
│       ├── config.py
│       ├── data/
│       │   ├── __init__.py
│       │   ├── loaders.py
│       │   └── validation.py
│       ├── features/
│       │   ├── __init__.py
│       │   └── build_features.py
│       ├── models/
│       │   ├── __init__.py
│       │   ├── isolation_forest.py
│       │   └── autoencoder.py
│       ├── evaluation/
│       │   ├── __init__.py
│       │   └── metrics.py
│       ├── inference/
│       │   ├── __init__.py
│       │   └── predict.py
│       └── visualization/
│           ├── __init__.py
│           └── plots.py
│
├── services/
│   ├── inference-api/         # FastAPI, later phase
│   └── application-backend/   # Spring Boot, later phase
│
├── frontend/
│   └── dashboard/             # React, later phase
│
├── tests/
│   ├── unit/
│   └── integration/
│
├── configs/
│   ├── data.yaml
│   └── model.yaml
│
├── artifacts/
│   ├── models/                 # Not committed
│   └── reports/                # Generated outputs
│
├── docs/
│   ├── architecture.md
│   ├── dataset-card.md
│   ├── data-dictionary.md
│   ├── ml-approach.md
│   ├── evaluation-report.md
│   └── api-contracts.md
│
├── .env.example
├── .gitignore
├── requirements.txt
├── README.md
└── pyproject.toml              # Add when packaging is configured
```

------------------------------------------------------------------------

## 8. Environment Setup (WSL2 / Ubuntu)

The recommended development location is the Linux filesystem:

``` text
/home/<user>/projects/flightops-ai
```

Avoid placing the active virtual environment on `/mnt/c` unless there is
a specific reason.

### 8.1 Verify prerequisites

``` bash
python3.12 --version
git --version
```

The target Python version is 3.12.10. If that exact patch version is not
installed, install it using an appropriate Python version manager or
distribution-specific method before creating the environment.

### 8.2 Create the project and virtual environment

``` bash
mkdir -p ~/projects/flightops-ai
cd ~/projects/flightops-ai

git init

python3.12 -m venv .venv
source .venv/bin/activate

python --version
which python

python -m pip install --upgrade pip
```

Expected interpreter path:

``` text
.../flightops-ai/.venv/bin/python
```

### 8.3 Initial dependencies

Create `requirements.txt`:

``` text
numpy
pandas
scipy
scikit-learn
matplotlib
plotly
jupyterlab
ipykernel
tqdm
pyyaml
python-dotenv
pytest
```

Install:

``` bash
python -m pip install -r requirements.txt

python -m ipykernel install \
  --user \
  --name flightops-ai \
  --display-name "FlightOps AI (Python 3.12)"
```

Install PyTorch separately after checking whether CPU or CUDA execution
is appropriate for the machine. Follow the official PyTorch installation
selector: https://pytorch.org/get-started/locally/

### 8.4 Verify environment

``` bash
python - <<'PY'
import sys
import numpy
import pandas
import sklearn

print("Python:", sys.version)
print("NumPy:", numpy.__version__)
print("Pandas:", pandas.__version__)
print("Scikit-learn:", sklearn.__version__)
PY
```

Open the repository in VS Code from WSL:

``` bash
code .
```

Select `.venv/bin/python` as the interpreter and the
`FlightOps AI (Python 3.12)` Jupyter kernel.

### 8.5 Alternative: native Windows (PowerShell)

WSL2 is recommended, but a native Windows setup also works for the
Phase 1--3 ML work. From the project folder:

``` powershell
py -3.12 --version
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m ipykernel install --user --name flightops-ai --display-name "FlightOps AI (Python 3.12)"
```

If script execution is blocked, run
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once. The
interpreter path is `.venv\Scripts\python.exe`. Do not share a single
virtual environment between Windows and WSL; create one per platform.

------------------------------------------------------------------------

## 9. Phase 1: Dataset Acquisition and Inspection

### 9.1 Download and organize

Place the official dataset files in:

``` text
data/raw/
├── DASHlink_full_fourclass_raw_comp.npz
└── DASHlink_full_fourclass_raw_meta.csv
```

Do not rename files until the download and source have been recorded in
the dataset manifest.

Check files:

``` bash
ls -lh data/raw/
```

### 9.2 Inspect the CSV metadata

In `notebooks/01_dataset_overview.ipynb`:

``` python
from pathlib import Path
import numpy as np
import pandas as pd

PROJECT_ROOT = Path.cwd().parent  # Adjust if notebook starts at repository root
RAW_DIR = PROJECT_ROOT / "data" / "raw"

NPZ_PATH = RAW_DIR / "DASHlink_full_fourclass_raw_comp.npz"
META_PATH = RAW_DIR / "DASHlink_full_fourclass_raw_meta.csv"

assert NPZ_PATH.exists(), f"Missing file: {NPZ_PATH}"
assert META_PATH.exists(), f"Missing file: {META_PATH}"

metadata = pd.read_csv(META_PATH)

print("Metadata shape:", metadata.shape)
print("Columns:", metadata.columns.tolist())
display(metadata.head())
display(metadata.dtypes)
```

### 9.3 Inspect the NumPy archive safely

NumPy `.npz` files are ZIP archives containing named arrays. Inspect
keys and shapes before assuming their structure.

``` python
with np.load(NPZ_PATH, allow_pickle=False) as archive:
    print("Keys:", archive.files)

    for key in archive.files:
        array = archive[key]
        print(
            key,
            "shape=", array.shape,
            "dtype=", array.dtype,
            "size_GB=", round(array.nbytes / (1024**3), 3),
        )
```

Use `allow_pickle=False` for untrusted or externally obtained NumPy
data. Do not enable pickle loading unless the source and contents have
been reviewed and there is a specific justified need.

### 9.4 Validate array dimensions

Do not assume that the feature axis is the final dimension. Verify it
using the dataset documentation and observed shape.

``` python
# Replace these with the key names printed in section 9.3.
# "data" and "label" are placeholders, not confirmed archive keys.
DATA_KEY = "data"
LABEL_KEY = "label"

with np.load(NPZ_PATH, allow_pickle=False) as archive:
    X = archive[DATA_KEY]
    y = archive[LABEL_KEY]

print("X:", X.shape, X.dtype)
print("y:", y.shape, y.dtype)
print("Unique labels:", np.unique(y))
```

Check:

-   Is the first axis the number of snapshots?
-   Which axis represents time?
-   Which axis represents features?
-   Does each label map to one snapshot?
-   Does metadata have one row per snapshot or a different granularity?

Only after these checks should the data be reshaped or converted into a
DataFrame.

### 9.5 Label distribution

``` python
labels, counts = np.unique(y, return_counts=True)

distribution = pd.DataFrame({
    "label": labels,
    "count": counts,
    "percentage": counts / counts.sum() * 100,
})

display(distribution)
```

Check class imbalance before selecting metrics or thresholds.

### 9.6 Data dictionary

Create `docs/data-dictionary.md` with one row per variable:

| Field | Description | Unit | Type | Validity notes |
|-------|-------------|------|------|----------------|
| altitude | Confirm from official docs | ft, if documented | Continuous | Check physical plausibility |
| airspeed | Confirm from official docs | knots, if documented | Continuous | Check physical plausibility |
| heading | Confirm from official docs | degrees, if documented | Circular | Handle wraparound |
| flap position | Confirm from official docs | Dataset-defined | Discrete / categorical | Do not treat as ordinary continuous without justification |

Do not fill unknown units or definitions by guessing.

------------------------------------------------------------------------

## 10. Data Quality Analysis

Create `notebooks/02_data_quality.ipynb`.

### 10.1 Missing values

``` python
import numpy as np

missing_count = np.isnan(X).sum()
total_values = X.size

print("Missing values:", int(missing_count))
print("Missing percentage:", missing_count / total_values * 100)
```

This code assumes a numeric array. Check dtype first and handle masked
or non-finite values as appropriate.

### 10.2 Non-finite values

``` python
finite_mask = np.isfinite(X)

print("Finite:", int(finite_mask.sum()))
print("Non-finite:", int((~finite_mask).sum()))
```

### 10.3 Duplicate and constant measurements

Check duplicate snapshots and constant features after correctly
identifying the feature axis. For time-series data, also inspect
repeated timestamps, repeated windows, and repeated flight identifiers
if available.

### 10.4 Outliers

Use robust summaries and plots. An extreme value is not automatically an
error or an anomaly. It may represent a valid flight condition or a
data-quality issue.

### 10.5 Data quality report

Record:

-   Shape and dtype.
-   Missing and non-finite counts.
-   Duplicate counts.
-   Per-feature min, max, median, mean, and standard deviation.
-   Class distribution.
-   Metadata alignment.
-   Any excluded or corrected observations and why.

Never silently drop samples.

------------------------------------------------------------------------

## 11. Exploratory Data Analysis

Create `notebooks/03_exploratory_analysis.ipynb`.

### 11.1 Plot a telemetry signal

After verifying the array layout and feature names:

``` python
import matplotlib.pyplot as plt
import numpy as np

# Example only: `flight` must first be transformed into
# shape (time_steps, features) using verified axis information.
time_seconds = np.arange(flight.shape[0])

plt.figure(figsize=(12, 4))
plt.plot(time_seconds, flight[:, verified_altitude_index])
plt.xlabel("Time (seconds)")
plt.ylabel("Altitude (documented unit)")
plt.title("Flight altitude over the observation window")
plt.grid(True)
plt.tight_layout()
plt.show()
```

Replace `verified_altitude_index` only after confirming the feature
order in the official documentation.

### 11.2 EDA questions

1.  What are the distributions of each sensor?
2.  Which measurements change most during the observation window?
3.  Which sensors are strongly correlated?
4.  Are there distinct patterns across the four labels?
5.  Are there abrupt changes or discontinuities?
6.  Are variables circular, discrete, or bounded?
7.  Do train and test splits contain related windows from the same
    flight?

### 11.3 Circular features

Heading, course, and some angular measurements may wrap around at 360
degrees. A naive subtraction can make a small difference appear large
(for example, 359 degrees versus 1 degree).

Where appropriate, encode angles using:

``` python
angle_rad = np.deg2rad(angle_degrees)
sin_angle = np.sin(angle_rad)
cos_angle = np.cos(angle_rad)
```

Choose the correct transformation based on each field's documented
meaning.

------------------------------------------------------------------------

## 12. Feature Engineering

Create reusable transformations under `src/flightops/features/`.

Potential features:

### Point-level features

-   Raw sensor values.
-   Normalized sensor values.
-   Circular encodings.
-   Validity flags for missing or invalid measurements.

### Window-level features

-   Mean and standard deviation.
-   Minimum and maximum.
-   Median and interquartile range.
-   First differences.
-   Rate of change.
-   Rolling statistics.
-   Quantiles and variability.

### Temporal features

-   Local trend.
-   Change-point candidates.
-   Consecutive abnormal duration.
-   Cross-sensor relationships.

Fit scalers and other learned transformations on training data only.
Save fitted preprocessing artifacts with the model. Do not allow test or
validation data to influence training transformations.

------------------------------------------------------------------------

## 13. Machine Learning Strategy

The project will compare simple baselines before introducing deep
learning.

### 13.1 Model 1: Isolation Forest

**Purpose:** Establish an unsupervised baseline that identifies
observations unlike the learned reference distribution.

Workflow:

1.  Select appropriate features.
2.  Split data without leakage.
3.  Fit preprocessing on training data.
4.  Train Isolation Forest on nominal training samples if the task setup
    supports this.
5.  Score held-out samples.
6.  Select a threshold using validation data and a documented objective.
7.  Evaluate against labels only after model decisions are fixed.

Important: Isolation Forest's `contamination` parameter influences the
decision threshold. It is not a verified estimate of real-world fault
prevalence.

### 13.2 Model 2: Autoencoder

Train a neural network to reconstruct normal telemetry patterns.

Concept:

``` text
Input telemetry
      |
      v
Encoder
      |
      v
Latent representation
      |
      v
Decoder
      |
      v
Reconstructed telemetry
      |
      v
Reconstruction error
      |
      v
Anomaly score
```

Train using nominal training data when labels permit. Evaluate whether
reconstruction error separates nominal and labeled anomalous examples.

### 13.3 Model 3: LSTM Autoencoder

Use this only after the simpler baseline is understood.

An LSTM autoencoder can learn temporal patterns across sequences. It
requires careful sequence construction, chronological or group-aware
splitting, and sufficient training data.

### 13.4 Model comparison

Compare:

-   Isolation Forest.
-   Autoencoder.
-   LSTM Autoencoder.

Use the same held-out evaluation strategy wherever possible. Document
differences in input representation and training data.

------------------------------------------------------------------------

## 14. Evaluation Strategy

Accuracy alone is insufficient, particularly when anomaly classes are
imbalanced.

### Classification-style metrics

When labels are available and a threshold has been selected on
validation data, report:

-   Precision.
-   Recall.
-   F1-score.
-   PR-AUC.
-   ROC-AUC, with class imbalance caveats.
-   Confusion matrix.
-   False-positive rate.
-   False-negative rate.

For multiclass labels, report per-class metrics and the averaging
method.

### Unsupervised anomaly metrics

Where appropriate, report:

-   Precision at a selected alert budget.
-   Recall at a selected false-positive rate.
-   Precision-recall curve.
-   Score distributions by class.
-   Stability across random seeds and splits.

### Temporal evaluation

If the model produces time-level scores, also evaluate:

-   Event-level precision and recall.
-   Detection delay.
-   False alerts per observation window.
-   Event overlap or duration agreement, where ground-truth event
    intervals exist.

Do not claim event-level performance if only snapshot-level labels are
available.

### Data leakage prevention

A major risk is that multiple windows may originate from the same
flight. Randomly splitting windows can place highly related samples in
training and test sets.

Prefer flight-grouped splits when flight identifiers are available. If
they are not available, document the limitation and investigate metadata
for grouping information.

**Verified for this dataset:** `flight_record` is unique per window, so
there are no repeated windows per flight. Use a stratified split, given
the 1% minority class. As robustness checks, also try airport-held-out
splits, and splits by aircraft or date if the undocumented
`flight_record` encoding can be confirmed.

------------------------------------------------------------------------

## 15. Anomaly Event Contract

Use a consistent output structure for model predictions.

Example JSON:

``` json
{
  "flight_id": "example-flight-001",
  "window_start_seconds": 0,
  "window_end_seconds": 159,
  "model_name": "isolation_forest",
  "model_version": "0.1.0",
  "anomaly_score": 0.87,
  "threshold": 0.72,
  "is_anomaly": true,
  "supporting_features": [
    {
      "feature": "computed_airspeed",
      "observed_summary": "See measured window values",
      "contribution": "Requires validated explanation method"
    }
  ],
  "interpretation": "Experimental statistical anomaly; engineering review required."
}
```

The values above are illustrative only. Define the score direction,
scale, threshold semantics, and feature-attribution method explicitly
for each model. Do not present a feature as causal merely because it is
correlated with the score.

------------------------------------------------------------------------

## 16. AI Engineering Assistant

Add this after the ML outputs are reliable.

Potential questions:

-   Summarize the anomalies detected in this flight.
-   Which telemetry variables contributed to this alert?
-   Compare the anomaly scores of two flights.
-   Show the time interval with the highest score.
-   Generate an analysis report for this flight.

### Grounding requirements

The LLM should receive structured, verified analysis results rather than
raw unbounded telemetry.

Provide:

-   Flight and window identifiers.
-   Model name and version.
-   Score and threshold definitions.
-   Supporting sensor summaries.
-   Evaluation limitations.
-   Links or IDs for underlying charts and records.

The assistant must distinguish measured facts from model
interpretations. It must not invent aircraft limits, failure causes, or
maintenance recommendations.

------------------------------------------------------------------------

## 17. Backend API Design (Future Phase)

The following is a proposed contract, not an implemented API.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/v1/flights/upload` | Register or upload a flight dataset |
| GET | `/api/v1/flights` | List flights |
| GET | `/api/v1/flights/{id}` | Flight metadata |
| GET | `/api/v1/flights/{id}/telemetry` | Telemetry series |
| POST | `/api/v1/flights/{id}/analyses` | Start an analysis job |
| GET | `/api/v1/analyses/{id}` | Analysis status and results |
| GET | `/api/v1/flights/{id}/anomalies` | Detected anomaly events |
| POST | `/api/v1/reports` | Generate an engineering report |
| GET | `/api/v1/reports/{id}` | Retrieve report metadata |

Use asynchronous jobs for large uploads and long-running inference.
Include request validation, pagination, authorization, rate limits, and
structured error responses.

------------------------------------------------------------------------

## 18. Database Design (Future Phase)

Candidate entities:

### users

-   id
-   email
-   password_hash / identity provider reference
-   role
-   created_at

### flights

-   id
-   external_flight_reference
-   dataset_id
-   observation_start
-   observation_end
-   metadata_json
-   created_at

### telemetry_records

-   id
-   flight_id
-   timestamp_or_offset
-   sensor_name or structured feature columns
-   value
-   quality_status

For large time-series datasets, choose between normalized rows, wide
records, or file/object storage based on query patterns and volume. Do
not assume one database row per sensor sample is the best design without
measuring it.

### analysis_runs

-   id
-   flight_id
-   model_name
-   model_version
-   status
-   started_at
-   completed_at
-   metrics_json

### anomaly_events

-   id
-   analysis_run_id
-   start_offset
-   end_offset
-   score
-   threshold
-   severity_label
-   evidence_json

### reports

-   id
-   analysis_run_id
-   report_uri
-   status
-   created_at

Use database migrations and explicit retention policies.

------------------------------------------------------------------------

## 19. Frontend Dashboard (Future Phase)

Proposed pages:

1.  **Overview**
    -   Number of imported flights.
    -   Analysis runs.
    -   Anomaly counts.
    -   Recent activity.
2.  **Flight Explorer**
    -   Flight metadata.
    -   Dataset and observation details.
    -   Telemetry charts.
3.  **Anomaly Explorer**
    -   Event timeline.
    -   Model score and threshold.
    -   Supporting sensor values.
    -   Model version.
4.  **Flight Comparison**
    -   Compare selected telemetry variables.
    -   Compare anomaly scores.
    -   Clearly indicate differences in data quality and model versions.
5.  **AI Engineering Assistant**
    -   Questions about selected flights.
    -   Evidence-linked summaries.
    -   Report generation.
6.  **Model Evaluation**
    -   Precision, recall, F1, PR-AUC.
    -   Confusion matrix.
    -   Model comparison.
    -   Experiment history.

------------------------------------------------------------------------

## 20. MLOps and Deployment

### MLflow

Track:

-   Experiment name.
-   Dataset version or checksum.
-   Feature configuration.
-   Training parameters.
-   Model artifact.
-   Evaluation metrics.
-   Git commit.
-   Python and library versions.

### Docker

Containerize:

-   ML inference API.
-   Spring Boot application.
-   React frontend.
-   PostgreSQL.
-   Optional Kafka and Redis.

Use Docker Compose for local development first.

### Monitoring

Track:

-   API latency and errors.
-   Inference latency.
-   Queue length and job failures.
-   Data validation failures.
-   Feature distribution changes.
-   Anomaly score distribution changes.
-   Model version and prediction volume.

Data drift is not automatically model degradation. Monitor it as a
signal for investigation and evaluate model performance when
ground-truth labels become available.

### Security

-   Keep secrets in environment variables or a secret manager.
-   Do not commit `.env` files.
-   Validate uploaded file types and sizes.
-   Restrict file paths and prevent path traversal.
-   Authenticate and authorize report and flight access.
-   Avoid logging sensitive uploaded data.
-   Isolate any future code or model execution workloads.

------------------------------------------------------------------------

## 21. Testing Strategy

### Unit tests

-   Dataset schema validation.
-   Preprocessing functions.
-   Feature transformations.
-   Model input validation.
-   Score and threshold semantics.
-   API request and response schemas.

### Integration tests

-   Dataset upload to storage.
-   API to inference service.
-   Database persistence.
-   Analysis job lifecycle.
-   Report generation.

### ML tests

-   No train/test leakage.
-   Deterministic preprocessing where expected.
-   Model artifact can be loaded.
-   Output shape and values are valid.
-   Evaluation metrics are reproducible.
-   Baseline performance is compared against a documented reference.

### Example test command

``` bash
pytest -q
```

------------------------------------------------------------------------

## 22. Reproducibility and Git Workflow

Recommended branches:

``` text
main
develop
feature/dataset-ingestion
feature/data-quality
feature/eda
feature/isolation-forest
feature/autoencoder
feature/inference-api
```

Commit logical units of work. Include:

-   Dataset manifest.
-   Configuration files.
-   Source code.
-   Tests.
-   Documentation.
-   Small sample data only if redistribution is permitted.

Do not commit:

-   `.venv/`
-   Large raw datasets.
-   Secrets.
-   Temporary notebook checkpoints.
-   Large model artifacts unless using an appropriate artifact store or
    Git LFS intentionally.

------------------------------------------------------------------------

## 23. Definition of Done

### Phase 1 --- Data foundation

-   [ ] Official dataset source recorded.
-   [ ] Usage terms reviewed.
-   [ ] Files downloaded and checksummed.
-   [ ] Python environment reproducible.
-   [ ] Array shapes and feature axis verified.
-   [ ] Labels and metadata alignment verified.
-   [ ] Data dictionary documented.
-   [ ] Missing and non-finite values assessed.
-   [ ] EDA charts generated.
-   [ ] Dataset limitations documented.

### Phase 2 --- Baseline ML

-   [ ] Preprocessing pipeline implemented.
-   [ ] Train/validation/test strategy documented.
-   [ ] Leakage risks assessed.
-   [ ] Isolation Forest trained.
-   [ ] Threshold selection documented.
-   [ ] Evaluation report generated.

### Phase 3 --- Advanced ML

-   [ ] Autoencoder implemented.
-   [ ] Temporal model evaluated if justified.
-   [ ] Models compared fairly.
-   [ ] Error analysis completed.
-   [ ] Model artifacts versioned.

### Phase 4--8 --- Product delivery

-   [ ] Inference API tested.
-   [ ] Backend integration tested.
-   [ ] Dashboard usable.
-   [ ] AI assistant grounded in analysis evidence.
-   [ ] Containerized deployment works.
-   [ ] Monitoring and documentation completed.

------------------------------------------------------------------------

## 24. Suggested 8-Week Schedule

| Week | Focus | Expected outcome |
|------|-------|------------------|
| 1 | Dataset acquisition, environment, EDA | Validated data foundation |
| 2 | Data validation and feature engineering | Reusable preprocessing |
| 3 | Isolation Forest baseline | First measurable baseline |
| 4 | Autoencoder and model comparison | Advanced ML experiments |
| 5 | FastAPI inference | Working Python service |
| 6 | Spring Boot and React | Integrated application |
| 7 | AI assistant and reports | Evidence-grounded summaries |
| 8 | Testing, Docker, MLflow, deployment | Portfolio-ready release |

This is a planning estimate. Dataset issues, compute limits, and
evaluation findings may change the schedule.

------------------------------------------------------------------------

## 25. Portfolio and Interview Positioning

### Project summary (use after implementation and update with measured results)

**FlightOps AI --- Intelligent Flight Telemetry Analysis & Anomaly
Detection**

Developed an experimental flight telemetry analytics platform that
processes multivariate time-series data, applies machine-learning models
to identify unusual patterns, and visualizes anomaly evidence through an
engineering dashboard.

Potential technical highlights, only after implementation:

-   Built a reproducible data ingestion and preprocessing pipeline for
    flight telemetry.
-   Compared classical and deep-learning anomaly detection approaches.
-   Evaluated models using class-aware and anomaly-focused metrics.
-   Developed a Python inference API and integrated it with an
    application backend.
-   Implemented model tracking, containerization, and monitoring.

Do not add performance percentages, dataset scale claims, or deployment
claims to a resume until they have been measured and verified.

### Interview topics to prepare

-   Why anomaly detection instead of ordinary classification?
-   How did you avoid data leakage?
-   How did you choose the anomaly threshold?
-   How did you handle class imbalance?
-   Why compare Isolation Forest and Autoencoders?
-   How did you evaluate false positives?
-   What are the limitations of snapshot-level labels?
-   How would you process telemetry in real time?
-   How would you version and monitor models?
-   How would you keep an LLM from inventing engineering conclusions?

------------------------------------------------------------------------

## 26. Immediate Next Steps

Start with the following sequence:

1.  Create the repository and Python 3.12.10 virtual environment in
    WSL2.
2.  Install the initial dependencies.
3.  Download the official NASA dataset and metadata.
4.  Inspect archive keys, array shapes, dtypes, and label distribution.
5.  Verify the feature axis and official variable definitions.
6.  Build the dataset overview and data-quality notebooks.
7.  Generate the first telemetry plots.
8.  Record findings in `docs/dataset-card.md` and
    `docs/data-dictionary.md`.

**Do not begin model training until the dataset structure, feature
definitions, labels, and split strategy are understood.**

------------------------------------------------------------------------

## 27. References

-   NASA DASHlink: https://c3.ndc.nasa.gov/dashlink/
-   Curated 4 Class Anomaly Detection Data Set:
    https://c3.ndc.nasa.gov/dashlink/resources/1018/
-   Internet Archive captures of the dataset files:
    https://web.archive.org/web/*/c3.ndc.nasa.gov/dashlink/static/media/dataset/DASHlink_full*
-   PyTorch installation: https://pytorch.org/get-started/locally/
-   Python documentation: https://docs.python.org/3.12/
-   NumPy documentation: https://numpy.org/doc/
-   pandas documentation: https://pandas.pydata.org/docs/
-   scikit-learn documentation: https://scikit-learn.org/stable/
-   FastAPI documentation: https://fastapi.tiangolo.com/
-   Spring Boot documentation: https://docs.spring.io/spring-boot/
-   MLflow documentation: https://mlflow.org/docs/latest/

------------------------------------------------------------------------

**Document status:** Initial end-to-end implementation blueprint.
Dataset details, schema, class mapping, model performance, and system
design decisions must be verified and updated during implementation.
