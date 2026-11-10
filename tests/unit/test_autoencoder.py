import numpy as np
import pytest

torch = pytest.importorskip("torch")

from flightops.data.download import FILES, is_valid  # noqa: E402
from flightops.features.build_features import FEATURE_SET_VERSION, channel_names, load_or_build_channels  # noqa: E402
from flightops.models.autoencoder import AEConfig, AEDetector, ConvAutoencoder  # noqa: E402


def _smooth_windows(n, T=32, C=4, seed=0):
    rng = np.random.default_rng(seed)
    t = np.linspace(0, 2 * np.pi, T)
    phase = rng.uniform(0, 2 * np.pi, size=(n, 1, C))
    return (np.sin(t[None, :, None] + phase) + 0.05 * rng.normal(size=(n, T, C))).astype(np.float32)


def test_conv_autoencoder_shape():
    m = ConvAutoencoder(n_channels=23)
    assert m(torch.zeros(2, 23, 160)).shape == (2, 23, 160)


def test_autoencoder_learns_and_flags_outliers(tmp_path):
    normal = _smooth_windows(300)
    outliers = np.random.default_rng(1).normal(scale=2, size=(20, 32, 4)).astype(np.float32)
    data = np.concatenate([normal, outliers])
    det = AEDetector(config=AEConfig(width=16, latent_channels=2, epochs=15, batch_size=32, lr=3e-3, patience=15))
    det.fit(data, np.arange(250), np.arange(250, 300), ["a", "b", "c", "d"], device="cpu", log=lambda *_: None)

    assert det.history[-1]["train_loss"] < det.history[0]["train_loss"]
    scores, per_channel = det.score(data)
    assert per_channel.shape == (320, 4)
    assert scores[300:].min() > np.median(scores[250:300])

    det.threshold = float(np.quantile(scores[250:300], 0.95))
    loaded = AEDetector.load(det.save(tmp_path / "ae.pt"), device="cpu")
    np.testing.assert_allclose(loaded.score(data, np.array([5, 1, 310]))[0], scores[[5, 1, 310]], rtol=1e-5)
    assert loaded.threshold == det.threshold


def test_score_preserves_requested_order():
    data = _smooth_windows(40)
    det = AEDetector(config=AEConfig(width=8, latent_channels=2, epochs=1, batch_size=16))
    det.fit(data, np.arange(30), np.arange(30, 40), device="cpu", log=lambda *_: None)
    idx = np.array([7, 2, 39, 0])
    np.testing.assert_allclose(det.score(data, idx)[0], det.score(data)[0][idx], rtol=1e-6)


def test_score_rejects_different_channel_count():
    data = _smooth_windows(20)
    det = AEDetector(config=AEConfig(width=8, latent_channels=2, epochs=1, batch_size=16))
    det.fit(data, np.arange(15), np.arange(15, 20), device="cpu", log=lambda *_: None)
    with pytest.raises(ValueError, match="different channel set"):
        det.score(_smooth_windows(5, C=5))


def test_channel_cache(tmp_path):
    X = np.random.default_rng(0).normal(size=(6, 16, 20)).astype(np.float32)
    ch = load_or_build_channels(X, tmp_path, batch_size=4)
    assert ch.shape == (6, 16, len(channel_names())) and isinstance(ch, np.memmap)
    np.testing.assert_array_equal(load_or_build_channels(X, tmp_path), ch)
    del ch


def test_channel_cache_rebuilds_when_stale(tmp_path):
    # A cache with a different shape (e.g. from an older channel set) must be replaced, also on Windows.
    old = np.zeros((6, 16, 3), dtype=np.float32)
    np.save(tmp_path / f"channels_{FEATURE_SET_VERSION}.npy", old)
    X = np.random.default_rng(0).normal(size=(6, 16, 20)).astype(np.float32)
    assert load_or_build_channels(X, tmp_path).shape == (6, 16, len(channel_names()))


def test_channel_cache_rebuilds_on_definition_or_data_change(tmp_path, monkeypatch):
    import flightops.features.build_features as bf
    X = np.random.default_rng(0).normal(size=(6, 16, 20)).astype(np.float32)
    first = np.array(load_or_build_channels(X, tmp_path))
    # same shape, different transformation -> must rebuild, not reuse
    monkeypatch.setattr(bf, "RELATIVE_TO_MEDIAN", tuple(n for n in bf.RELATIVE_TO_MEDIAN if n != "rudder"))
    monkeypatch.setattr(bf, "channel_names", lambda: [c.replace("rudder_rel_median", "rudder") for c in channel_names()])
    changed = np.array(bf.load_or_build_channels(X, tmp_path))
    assert not np.allclose(first, changed)
    monkeypatch.undo()
    # same shape, different data -> must rebuild
    X2 = X.copy(); X2[3] += 1.0
    again = np.array(load_or_build_channels(X2, tmp_path))
    np.testing.assert_allclose(again, np.array(load_or_build_channels(X2, tmp_path)))
    assert not np.allclose(again, first)


def test_download_validation(tmp_path):
    f = FILES[1]
    path = tmp_path / f.name
    assert not is_valid(path, f)
    path.write_bytes(b"x" * 10)
    assert not is_valid(path, f)  # wrong size
