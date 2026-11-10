# FlightOps AI

Experimental flight telemetry analysis and anomaly detection. **Not** an aircraft
control, maintenance, or certified flight-safety system.

The full plan is in [documentation.md](documentation.md). The project is currently in **Phase 1
(dataset acquisition and inspection)**.

## Setup (Windows PowerShell)

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements-lock.txt   # or requirements.txt for latest versions
python -m pip install -e .
python -m ipykernel install --user --name flightops-ai --display-name "FlightOps AI (Python 3.12)"
```

For WSL2/Linux, see section 8 of the documentation.

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
