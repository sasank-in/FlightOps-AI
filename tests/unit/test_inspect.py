import json

from flightops.data import inspect as inspect_mod


def test_inspect_reports_files_arrays_and_metadata(synthetic_dataset, monkeypatch, tmp_path):
    monkeypatch.setenv("FLIGHTOPS_PROJECT_ROOT", str(synthetic_dataset["root"]))
    out = tmp_path / "report.json"

    code = inspect_mod.main(["--config", str(synthetic_dataset["config"]), "--json-out", str(out)])

    assert code == 0
    report = json.loads(out.read_text(encoding="utf-8"))
    assert report["files"]["npz"]["exists"]
    assert len(report["files"]["npz"]["sha256"]) == 64
    assert {a["name"] for a in report["npz_arrays"]} == {"data", "label"}
    assert report["metadata"]["n_rows"] == 12


def test_inspect_missing_files_returns_nonzero(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("FLIGHTOPS_PROJECT_ROOT", str(tmp_path))
    cfg = tmp_path / "data.yaml"
    cfg.write_text("npz_file: none.npz\nmetadata_file: none.csv\n", encoding="utf-8")
    assert inspect_mod.main(["--config", str(cfg)]) == 1
    assert "[missing]" in capsys.readouterr().out
