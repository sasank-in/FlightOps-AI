import numpy as np
import pytest

from flightops.models.hybrid import HybridDetector, TailScorer
from flightops.models.isolation_forest import IForestDetector


def test_tail_scorer_matches_exact_empirical_tail():
    rng = np.random.default_rng(0)
    ref = rng.standard_t(df=3, size=(20000, 2))          # heavy-tailed, like some flight features
    ts = TailScorer().fit(ref)
    x = np.array([[0.0, 0.0], [2.0, -2.0], [8.0, 30.0]])
    e = ts.neg_log_tail(x)
    exact = [-np.log10(max(2 * min((ref[:, j] <= v).mean(), (ref[:, j] >= v).mean()), 1 / 20000))
             for v, j in ((2.0, 0), (-2.0, 1))]
    assert e[0].max() < 0.1                                # median value: tail ~0.5 -> ~0
    np.testing.assert_allclose(e[1], exact, atol=0.05)
    assert e[2, 1] == pytest.approx(np.log10(20000))       # beyond all reference: floored at 1/n


def test_heavy_tailed_feature_does_not_dominate():
    rng = np.random.default_rng(1)
    ref = np.column_stack([rng.normal(size=5000), rng.standard_cauchy(size=5000)])
    ts = TailScorer().fit(ref)
    # a value of 50 is unremarkable for the Cauchy feature but extreme for the Gaussian one
    e = ts.neg_log_tail(np.array([[0.0, 50.0], [6.0, 0.0]]))
    assert e[0, 1] < 2.0 and e[1, 0] > 3.0


def test_tied_values_match_exact_ecdf():
    # 40% of nominal windows share one value (like flap IQR); the common value must carry little evidence
    rng = np.random.default_rng(3)
    ref = np.where(rng.random(20000) < 0.4, 0.0, rng.exponential(5.0, 20000))[:, None]
    ts = TailScorer().fit(ref)
    x = np.array([[0.0], [2.0], [40.0]])
    exact = []
    for v in x[:, 0]:
        tail = min((ref[:, 0] <= v).mean(), (ref[:, 0] >= v).mean())
        exact.append(-np.log10(max(2 * tail, 1 / 20000)))
    e = ts.neg_log_tail(x)[:, 0]
    assert e[0] < 0.2                                  # the most common value: almost no evidence (exact 0.097)
    np.testing.assert_allclose(e[:2], exact[:2], atol=0.06)
    assert abs(e[2] - exact[2]) < 0.15                  # deep tail (~1e-4): only a few reference samples


def test_constant_feature():
    ts = TailScorer().fit(np.column_stack([np.ones(100), np.arange(100.0)]))
    e = ts.neg_log_tail(np.array([[1.0, 50.0], [2.0, 50.0]]))
    assert e[0, 0] == 0.0 and e[1, 0] == pytest.approx(2.0)


def test_hybrid_flags_single_extreme_feature_and_keeps_budget(tmp_path):
    rng = np.random.default_rng(2)
    d = 40
    fit, cal = rng.normal(size=(3000, d)), rng.normal(size=(1000, d))
    det = HybridDetector(forest=IForestDetector(n_estimators=50)).fit(fit, [f"f{i}" for i in range(d)])
    det.calibrate(cal, target_fpr=0.05)

    fresh = rng.normal(size=(4000, d))
    assert abs(det.predict(fresh).mean() - 0.05) < 0.02    # false-alarm budget holds on new nominal data
    # One abnormal signal: several statistics of the same channel extreme (e.g. flap mean/median/first),
    # everything else nominal. The forest alone tends to average this away.
    single = rng.normal(size=(50, d)); single[:, 7:10] = 9.0
    assert det.predict(single).mean() > 0.95
    assert (det.score(single) > det.score(fresh).max() - 1e-3).mean() > 0.9

    loaded = HybridDetector.load(det.save(tmp_path / "h.joblib"))
    np.testing.assert_allclose(loaded.score(single), det.score(single))
