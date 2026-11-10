"""Anomaly-detection metrics. Convention: higher score = more anomalous; label 0 = nominal."""

from __future__ import annotations

import numpy as np
from sklearn.metrics import average_precision_score, precision_recall_curve, roc_auc_score


def threshold_at_fpr(nominal_scores: np.ndarray, target_fpr: float) -> float:
    """Score threshold that flags `target_fpr` of the given nominal windows (alert budget)."""
    if not 0 < target_fpr < 1:
        raise ValueError("target_fpr must be in (0, 1)")
    return float(np.quantile(np.asarray(nominal_scores), 1 - target_fpr))


def best_f1_threshold(y_anomaly: np.ndarray, scores: np.ndarray) -> float:
    """Threshold maximising F1 on the given data. Use only on validation data."""
    precision, recall, thresholds = precision_recall_curve(y_anomaly, scores)
    f1 = 2 * precision[:-1] * recall[:-1] / np.clip(precision[:-1] + recall[:-1], 1e-12, None)
    return float(thresholds[int(np.argmax(f1))])


def binary_metrics(labels: np.ndarray, scores: np.ndarray, threshold: float) -> dict:
    """Metrics for anomaly (label > 0) vs nominal at a fixed threshold, plus threshold-free AUCs."""
    labels, scores = np.asarray(labels), np.asarray(scores)
    truth = labels > 0
    alert = scores >= threshold
    tp = int(np.sum(alert & truth)); fp = int(np.sum(alert & ~truth))
    fn = int(np.sum(~alert & truth)); tn = int(np.sum(~alert & ~truth))
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    both = truth.any() and (~truth).any()
    return {
        "threshold": float(threshold),
        "n": int(len(labels)),
        "n_anomalous": int(truth.sum()),
        "tp": tp, "fp": fp, "fn": fn, "tn": tn,
        "precision": precision,
        "recall": recall,
        "f1": 2 * precision * recall / (precision + recall) if precision + recall else 0.0,
        "fpr": fp / (fp + tn) if fp + tn else 0.0,
        "fnr": fn / (fn + tp) if fn + tp else 0.0,
        "pr_auc": float(average_precision_score(truth, scores)) if both else float("nan"),
        "roc_auc": float(roc_auc_score(truth, scores)) if both else float("nan"),
        "anomaly_prevalence": float(truth.mean()),
    }


def per_class_alert_rate(labels: np.ndarray, scores: np.ndarray, threshold: float, names: dict[int, str]) -> dict:
    """Share of windows alerted per class: false-alarm rate for nominal, detection rate otherwise."""
    labels, alert = np.asarray(labels), np.asarray(scores) >= threshold
    return {names[k]: float(alert[labels == k].mean()) for k in names if np.any(labels == k)}
