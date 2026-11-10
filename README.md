# FlightOps AI

Experimental flight telemetry analysis and anomaly detection. **Not** an aircraft
control, maintenance, or certified flight-safety system.

The full plan is in [documentation.md](documentation.md). The project is currently in **Phase 1
(dataset acquisition and inspection)**.

## Setup: conda env `environ` (Windows, CPU PyTorch)

The project runs in the existing conda env `environ` (Python 3.12, PyTorch CPU build):

```powershell
conda activate environ
$env:PYTHONNOUSERSITE = "1"     # ignore packages in %APPDATA%\Python (a broken ipykernel lives there)
python -m pip install -r requirements.txt
python -m pip install -e .
# PyTorch CPU (already installed in environ):
# python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
python -m ipykernel install --user --name flightops-ai --display-name "FlightOps AI (conda: environ)"
```

The Jupyter kernel `flightops-ai` points at `environ` and sets `PYTHONNOUSERSITE=1` itself. The env also
sets it on `conda activate`, via `conda env config vars set PYTHONNOUSERSITE=1 -n environ`, so the manual
line above is only needed outside an activated env.

A plain venv also works (`py -3.12 -m venv .venv`, then the same pip commands). For WSL2/Linux,
see section 8 of the documentation.

## Getting the data

```powershell
python -m flightops.data.download   # official NASA URL, else the verified archive copy; SHA-256 checked
```

The dataset is never committed or re-hosted (licence listed as "N/A"; 1.7 GB).

## Phase 1 workflow

1. Download the dataset files from the official NASA DASHlink page into `data/raw/`.
2. Inspect them (reads array headers only, safe for large files):

   ```powershell
   python -m flightops.data.inspect --json-out artifacts/reports/dataset_inspection.json
   ```

3. Record the source, checksums, and array keys in [docs/dataset-card.md](docs/dataset-card.md).
4. Set `data_key`, `label_key`, `time_axis`, and `feature_axis` in [configs/data.yaml](configs/data.yaml).
5. Fill in [docs/data-dictionary.md](docs/data-dictionary.md) from the official documentation.
6. Build the memory-mappable float32 working copy (~45 s, low RAM use):

   ```powershell
   python -m flightops.data.processed
   ```

7. Run the notebooks with the **FlightOps AI (Python 3.12)** kernel:
   - [notebooks/01_dataset_overview.ipynb](notebooks/01_dataset_overview.ipynb): class balance, aircraft, airports, per-class behaviour
   - [notebooks/02_data_quality.ipynb](notebooks/02_data_quality.ipynb): integrity, duplicates, variable issues, quality flags

Steps 1–7 are complete. The data is downloaded and verified, and the findings are in the dataset card.

## Phase 2: baseline

```powershell
python -m flightops.models.train_baseline   # ~1 min: features, splits, Isolation Forest, evaluation
```

- [notebooks/03_exploratory_analysis.ipynb](notebooks/03_exploratory_analysis.ipynb): variability, correlation, class separation, aircraft 657
- [notebooks/04_baseline_anomaly_detection.ipynb](notebooks/04_baseline_anomaly_detection.ipynb): baseline results
- [docs/evaluation-report.md](docs/evaluation-report.md): metrics, threshold policy, label concern

## Phase 4: inference API

```powershell
python -m pip install -e ".[api]"
uvicorn app.main:app --app-dir services/inference-api --host 127.0.0.1 --port 8000   # docs at /docs
python services/inference-api/examples/demo_client.py --per-class 2                  # second terminal
```

Serves `if_tail_hybrid` 0.4.0. Train it with `python -m flightops.models.train_hybrid`. See
[services/inference-api/README.md](services/inference-api/README.md) and
[docs/api-contracts.md](docs/api-contracts.md).

## Phase 3: autoencoder (CPU or cloud GPU)

```powershell
python -m flightops.models.train_autoencoder --smoke          # 1-minute pipeline check
python -m flightops.models.train_autoencoder                  # full run: ~15-20 min on CPU
python -m flightops.models.train_autoencoder --aircraft-cv    # + 5 aircraft-held-out folds (GPU recommended)
```

### Training on a cloud GPU (Kaggle or Colab)

1. Make the code reachable, either way:
   - **GitHub (default, `CODE_SOURCE = "git"`):** `git push`. The repo is public, so Kaggle clones it without a login.
   - **Zip (`CODE_SOURCE = "zip"`):** `git archive --format=zip -o dist/flightops_src.zip HEAD`. On Kaggle,
     upload it as a dataset (Kaggle extracts it, and the notebook finds the extracted folder).
2. Import [notebooks/05_autoencoder_cloud_gpu.ipynb](notebooks/05_autoencoder_cloud_gpu.ipynb) (Kaggle: *File → Import
   Notebook*). Enable GPU, and on Kaggle also turn **Internet on**.
3. *Run All*. The notebook downloads and verifies the dataset itself. On Kaggle everything heavy stays in
   `/tmp`, so only `flightops_results.zip` lands in `/kaggle/working`.
4. Download `flightops_results.zip` and unzip it at the repo root. It contains only `artifacts/`.

## Tests

```powershell
pytest
```

## Layout

```text
configs/            data and model configuration
data/raw/           original downloads (not committed)
docs/               dataset card, data dictionary
src/flightops/      Python package (data loading, validation, inspection)
tests/              unit tests (synthetic data only)
artifacts/          generated models and reports (not committed)
```
