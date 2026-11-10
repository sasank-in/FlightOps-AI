import numpy as np
import pytest

from flightops.data.splits import EXCLUDED, TEST, TRAIN, VAL, aircraft_folds, stratified_split
from flightops.evaluation.metrics import best_f1_threshold, binary_metrics, per_class_alert_rate, threshold_at_fpr
from flightops.models.isolation_forest import IForestDetector


def _labels(n=1000, seed=0):
    rng = np.random.default_rng(seed)
    return rng.choice([0, 1, 2, 3], size=n, p=[0.85, 0.08, 0.05, 0.02])


def test_stratified_split_disjoint_excludes_and_keeps_ratios():
    y = _labels()
    exclude = np.zeros(len(y), bool); exclude[:10] = True
    s = stratified_split(y, exclude)
    assert set(s[:10]) == {EXCLUDED} and EXCLUDED not in set(s[10:])
    assert abs((s == TEST).mean() - 0.15) < 0.02 and abs((s == VAL).mean() - 0.15) < 0.02
    for part in (TRAIN, VAL, TEST):
        assert abs((y[s == part] == 3).mean() - (y[10:] == 3).mean()) < 0.01


def test_aircraft_folds_never_share_aircraft():
    y = _labels(600)
    groups = np.repeat(np.arange(12), 50)
    folds = aircraft_folds(y, groups, n_splits=4)
    assert len(folds) == 4
    tested = np.concatenate([te for _, te in folds])
    assert sorted(tested) == list(range(600))
    for tr, te in folds:
        assert not set(groups[tr]) & set(groups[te])


def test_metrics_on_known_case():
    labels = np.array([0, 0, 0, 0, 1, 2])
    scores = np.array([0.1, 0.2, 0.3, 0.9, 0.8, 0.4])
    m = binary_metrics(labels, scores, threshold=0.35)
    assert (m["tp"], m["fp"], m["fn"], m["tn"]) == (2, 1, 0, 3)
    assert m["precision"] == pytest.approx(2 / 3) and m["recall"] == 1.0 and m["fpr"] == 0.25
    rates = per_class_alert_rate(labels, scores, 0.35, {0: "N", 1: "A", 2: "B"})
    assert rates == {"N": 0.25, "A": 1.0, "B": 1.0}


def test_thresholds():
    nominal = np.arange(100, dtype=float)
    assert threshold_at_fpr(nominal, 0.05) == pytest.approx(94.05)
    with pytest.raises(ValueError):
        threshold_at_fpr(nominal, 0)
    y = np.array([0, 0, 0, 1, 1]); s = np.array([0.1, 0.2, 0.6, 0.5, 0.9])
    assert best_f1_threshold(y, s) == pytest.approx(0.5)


def test_iforest_scores_outliers_higher_and_round_trips(tmp_path):
    rng = np.random.default_rng(0)
    nominal = rng.normal(size=(500, 4))
    outliers = rng.normal(loc=6, size=(20, 4))
    det = IForestDetector(n_estimators=50).fit(nominal, ["a", "b", "c", "d"])
    assert det.score(outliers).mean() > det.score(nominal).mean()
    det.threshold = threshold_at_fpr(det.score(nominal), 0.05)
    assert det.predict(outliers).mean() > 0.9

    loaded = IForestDetector.load(det.save(tmp_path / "m.joblib"))
    np.testing.assert_allclose(loaded.score(outliers), det.score(outliers))
    with pytest.raises(ValueError):
        loaded.score(outliers[:, :3])
