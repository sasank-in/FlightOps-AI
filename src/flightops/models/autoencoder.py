"""1D-convolutional sequence autoencoder (documentation.md §13.2).

Learns to reconstruct nominal 160-second windows of preprocessed channels. The anomaly
score is the mean squared reconstruction error (higher = more anomalous). The per-channel
error is kept as *supporting evidence* for an alert. It is not a causal explanation.

Runs on CPU, CUDA, or Apple MPS (device="auto" picks the best available).
Requires PyTorch: `pip install torch` (CPU) or a CUDA build on a GPU machine.
"""

from __future__ import annotations

import copy
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np
import torch
from torch import nn

MODEL_NAME = "conv_autoencoder"
# 0.2.0: channel set v2 (no absolute heading/course inputs); 0.4.0: channel set v3 (relative offsets)
MODEL_VERSION = "0.4.0"


def resolve_device(device: str = "auto") -> torch.device:
    if device != "auto":
        return torch.device(device)
    if torch.cuda.is_available():
        return torch.device("cuda")
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


@dataclass
class AEConfig:
    width: int = 64            # conv channels
    latent_channels: int = 8   # bottleneck: latent_channels x (T / 8) values
    epochs: int = 30
    batch_size: int = 256
    lr: float = 1e-3
    weight_decay: float = 1e-5
    patience: int = 5          # early stopping on validation nominal loss
    seed: int = 42


class ConvAutoencoder(nn.Module):
    """(batch, C, T) -> (batch, C, T). T must be divisible by 8 (160 is)."""

    def __init__(self, n_channels: int, width: int = 64, latent_channels: int = 8):
        super().__init__()
        act = nn.GELU
        self.encoder = nn.Sequential(
            nn.Conv1d(n_channels, width, 5, padding=2), act(),
            nn.Conv1d(width, width, 5, stride=2, padding=2), act(),      # T/2
            nn.Conv1d(width, width, 5, stride=2, padding=2), act(),      # T/4
            nn.Conv1d(width, width, 5, stride=2, padding=2), act(),      # T/8
            nn.Conv1d(width, latent_channels, 1),
        )
        self.decoder = nn.Sequential(
            nn.Conv1d(latent_channels, width, 1), act(),
            nn.ConvTranspose1d(width, width, 4, stride=2, padding=1), act(),  # T/4
            nn.ConvTranspose1d(width, width, 4, stride=2, padding=1), act(),  # T/2
            nn.ConvTranspose1d(width, width, 4, stride=2, padding=1), act(),  # T
            nn.Conv1d(width, n_channels, 5, padding=2),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.decoder(self.encoder(x))


def _batches(idx: np.ndarray, batch_size: int, rng: np.random.Generator | None = None):
    order = rng.permutation(idx) if rng is not None else idx
    for s in range(0, len(order), batch_size):
        yield np.sort(order[s : s + batch_size])  # sorted reads are faster on memmaps


@dataclass
class AEDetector:
    config: AEConfig = field(default_factory=AEConfig)
    channel_names: list[str] = field(default_factory=list)
    threshold: float | None = None
    mean: np.ndarray | None = None
    std: np.ndarray | None = None
    history: list[dict] = field(default_factory=list)
    model: ConvAutoencoder | None = None
    device: str = "cpu"

    # -- normalisation ---------------------------------------------------------------
    def _fit_normaliser(self, channels: np.ndarray, idx: np.ndarray, batch: int = 4096) -> None:
        n, total, total_sq = 0, 0.0, 0.0
        for b in _batches(idx, batch):
            x = np.asarray(channels[b], dtype=np.float64)
            n += x.shape[0] * x.shape[1]
            total = total + x.sum(axis=(0, 1))
            total_sq = total_sq + (x**2).sum(axis=(0, 1))
        mean = total / n
        std = np.sqrt(np.maximum(total_sq / n - mean**2, 0))
        self.mean = mean.astype(np.float32)
        self.std = np.where(std < 1e-6, 1.0, std).astype(np.float32)

    def _to_tensor(self, x: np.ndarray, device: torch.device) -> torch.Tensor:
        x = (np.asarray(x, dtype=np.float32) - self.mean) / self.std   # (B, T, C)
        return torch.from_numpy(np.ascontiguousarray(x.transpose(0, 2, 1))).to(device)

    # -- training --------------------------------------------------------------------
    def fit(
        self,
        channels: np.ndarray,
        train_idx: np.ndarray,
        val_idx: np.ndarray,
        channel_names: list[str] | None = None,
        device: str = "auto",
        preload: bool | None = None,
        log=print,
    ) -> "AEDetector":
        """Train on `train_idx` windows; early-stop on reconstruction loss of `val_idx` windows.

        Both index sets should contain nominal windows only. `preload` copies the training
        windows into RAM (defaults to True on GPU, where memmap reads would be the bottleneck).
        """
        cfg = self.config
        torch.manual_seed(cfg.seed)
        rng = np.random.default_rng(cfg.seed)
        dev = resolve_device(device)
        self.device = str(dev)
        self.channel_names = list(channel_names or [])
        self._fit_normaliser(channels, train_idx)

        source, tr = channels, np.asarray(train_idx)
        if preload if preload is not None else dev.type == "cuda":
            source, tr = np.asarray(channels[np.sort(tr)]), np.arange(len(tr))

        self.model = ConvAutoencoder(channels.shape[2], cfg.width, cfg.latent_channels).to(dev)
        opt = torch.optim.AdamW(self.model.parameters(), lr=cfg.lr, weight_decay=cfg.weight_decay)
        sched = torch.optim.lr_scheduler.ReduceLROnPlateau(opt, factor=0.5, patience=2)
        best, best_state, stale = float("inf"), None, 0
        self.history = []

        for epoch in range(1, cfg.epochs + 1):
            t0 = time.perf_counter()
            self.model.train()
            tr_loss, seen = 0.0, 0
            for b in _batches(tr, cfg.batch_size, rng):
                x = self._to_tensor(source[b], dev)
                loss = torch.mean((self.model(x) - x) ** 2)
                opt.zero_grad(set_to_none=True)
                loss.backward()
                opt.step()
                tr_loss += loss.item() * len(b); seen += len(b)
            val_loss = float(self.score(channels, val_idx)[0].mean())
            sched.step(val_loss)
            self.history.append({"epoch": epoch, "train_loss": tr_loss / seen, "val_loss": val_loss,
                                 "lr": opt.param_groups[0]["lr"], "seconds": round(time.perf_counter() - t0, 1)})
            log(f"epoch {epoch:3d}  train {tr_loss / seen:.4f}  val {val_loss:.4f}  ({self.history[-1]['seconds']}s)")
            if val_loss < best - 1e-5:
                best, best_state, stale = val_loss, copy.deepcopy(self.model.state_dict()), 0
            else:
                stale += 1
                if stale >= cfg.patience:
                    log(f"early stopping (best val {best:.4f})")
                    break
        if best_state is not None:
            self.model.load_state_dict(best_state)
        return self

    # -- scoring ---------------------------------------------------------------------
    @torch.no_grad()
    def score(self, channels: np.ndarray, idx: np.ndarray | None = None, batch_size: int = 1024
              ) -> tuple[np.ndarray, np.ndarray]:
        """Return (window score (n,), per-channel mean squared error (n, C)) in `idx` order."""
        if self.model is None:
            raise RuntimeError("Model is not fitted")
        if self.mean is not None and channels.shape[2] != len(self.mean):
            raise ValueError(f"Model expects {len(self.mean)} channels, got {channels.shape[2]} "
                             "(trained on a different channel set)")
        idx = np.arange(channels.shape[0]) if idx is None else np.asarray(idx)
        dev = torch.device(self.device)
        self.model.eval()
        order = np.argsort(idx, kind="stable")
        per_channel = np.empty((len(idx), channels.shape[2]), dtype=np.float32)
        for s in range(0, len(idx), batch_size):
            pos = order[s : s + batch_size]
            x = self._to_tensor(channels[idx[pos]], dev)
            per_channel[pos] = torch.mean((self.model(x) - x) ** 2, dim=2).float().cpu().numpy()
        return per_channel.mean(axis=1), per_channel

    def predict(self, channels: np.ndarray, idx: np.ndarray | None = None) -> np.ndarray:
        if self.threshold is None:
            raise RuntimeError("Threshold not set; calibrate on validation data first")
        return self.score(channels, idx)[0] >= self.threshold

    # -- persistence -----------------------------------------------------------------
    def save(self, path: str | Path) -> Path:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        torch.save({
            "name": MODEL_NAME, "version": MODEL_VERSION, "config": asdict(self.config),
            "channel_names": self.channel_names, "threshold": self.threshold,
            "mean": self.mean.tolist(), "std": self.std.tolist(), "history": self.history,
            "n_channels": len(self.mean), "state_dict": self.model.state_dict(),
        }, path)
        return path

    @staticmethod
    def load(path: str | Path, device: str = "auto") -> "AEDetector":
        dev = resolve_device(device)
        ckpt = torch.load(path, map_location=dev, weights_only=True)  # no arbitrary pickle
        if ckpt.get("name") != MODEL_NAME:
            raise ValueError(f"Not a {MODEL_NAME} checkpoint: {path}")
        det = AEDetector(config=AEConfig(**ckpt["config"]), channel_names=ckpt["channel_names"],
                         threshold=ckpt["threshold"], mean=np.array(ckpt["mean"], np.float32),
                         std=np.array(ckpt["std"], np.float32), history=ckpt["history"], device=str(dev))
        det.model = ConvAutoencoder(ckpt["n_channels"], det.config.width, det.config.latent_channels).to(dev)
        det.model.load_state_dict(ckpt["state_dict"])
        return det
