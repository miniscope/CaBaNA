"""summarize / format_summary, log_context, tqdm_context, merge_context."""

from __future__ import annotations

import logging
import sys
import types

import numpy as np
import pytest

import cabana
from cabana import AnalysisSpec, Pipeline, ProgressEvent, RunContext, ShuffleConfig
from cabana._results import RunError, RunWarning


@pytest.fixture(scope="module")
def run20(sim_session):
    shuf = ShuffleConfig(n_shuffles=20, seed=3, min_shift_s=20.0)
    pipe = Pipeline(
        analyses=[
            AnalysisSpec(
                name="info", metric={"name": "information_content"}, states="position", shuffle=shuf
            ),
            AnalysisSpec(
                name="auc",
                metric={"name": "auroc"},
                states="social",
                shuffle=ShuffleConfig(
                    n_shuffles=40, seed=3, min_shift_s=20.0, correction="max_stat"
                ),
            ),
            AnalysisSpec(name="plain", metric={"name": "auroc"}, states="syllables"),
        ]
    )
    return pipe.run(sim_session)[1]


COLS = [
    "analysis", "metric", "target", "level", "null", "n_shuffles", "correction", "n_tested",
    "n_significant", "frac_significant", "n_significant_adj", "frac_significant_adj",
    "median_z", "max_z", "median_value", "n_warnings", "error",
]  # fmt: skip


def test_summary_columns_and_hand_counts(run20):
    df = cabana.summarize(run20)
    assert list(df.columns) == COLS and list(df["analysis"]) == ["info", "auc", "plain"]
    r = run20["info"]
    p = r.shuffle.p_value
    row = df.iloc[0]
    assert row.n_tested == np.isfinite(p).sum() == 60
    assert row.n_significant == int((p < 0.05).sum())
    assert row.frac_significant == pytest.approx(row.n_significant / row.n_tested)
    z = r.shuffle.z_score
    assert row.median_z == pytest.approx(np.nanmedian(z))
    assert row.max_z == pytest.approx(np.nanmax(z))
    assert row.median_value == pytest.approx(np.nanmedian(r.values))
    assert row.n_shuffles == 20 and row.null == "circular_shift" and row.correction == "none"
    assert run20.summary().equals(df)


def test_summary_any_state_per_cell(run20):
    r = run20["auc"]
    p, sig = r.shuffle.p_value, r.shuffle.significant
    row = cabana.summarize(run20).iloc[1]
    assert row.n_tested == np.isfinite(p).any(axis=1).sum()
    assert row.n_significant == sig.any(axis=1).sum()
    assert row.n_significant_adj == r.shuffle.significant_adj.any(axis=1).sum()
    zc = np.nanmax(np.where(np.isfinite(r.shuffle.z_score), r.shuffle.z_score, -np.inf), axis=1)
    assert row.median_z == pytest.approx(np.median(zc[np.isfinite(zc)]))
    # alpha recomputes significance from the p-values
    strict = cabana.summarize(run20, alpha=0.001).iloc[1]
    assert strict.n_significant == (p < 0.001).any(axis=1).sum()
    assert strict.n_significant <= row.n_significant


def test_summary_without_shuffle_and_by_state(run20):
    plain = cabana.summarize(run20).iloc[2]
    assert plain.n_shuffles == 0 and np.isnan(plain.n_tested) and np.isfinite(plain.median_value)
    by = cabana.summarize(run20, by="state")
    assert "state" in by.columns
    assert set(by["analysis"]) == {"auc", "plain"}  # 'info' has no state axis
    auc = by[by.analysis == "auc"]
    r = run20["auc"]
    assert list(auc["state"]) == r.state_names
    for j in range(len(r.state_names)):
        assert auc.iloc[j].n_significant == int(r.shuffle.significant[:, j].sum())
    with pytest.raises(ValueError, match="by must be"):
        cabana.summarize(run20, by="cell")


def test_summary_errors_and_warnings(run20):
    rs = run20.model_copy(deep=True)
    rs.errors.append(
        RunError(analysis="bad", metric="auroc", target="x", error_type="KeyError", message="oops")
    )
    rs.warnings.append(RunWarning(analysis="info", category="UserWarning", message="w"))
    df = cabana.summarize(rs)
    bad = df[df.analysis == "bad"].iloc[0]
    assert bad.error == "KeyError: oops" and np.isnan(bad.n_tested)
    assert df[df.analysis == "info"].iloc[0].n_warnings == 1
    text = cabana.format_summary(df)
    assert "bad" in text and "KeyError: oops" in text


def test_format_summary(run20):
    text = cabana.format_summary(cabana.summarize(run20))
    assert text.strip() and "info" in text and "information_content" in text
    assert "error" not in text.splitlines()[0]  # dropped when nobody failed
    assert cabana.format_summary(cabana.summarize(cabana.ResultSet())) == "(no analyses)"


# ---- logging / progress -------------------------------------------------------


def _ev(stage, name="a", message="", frac=0.5, done=None, total=None):
    return ProgressEvent(
        stage, name, 0, 1, frac, shuffles_done=done, shuffles_total=total, message=message
    )


def test_log_context_records(caplog, sim_session):
    assert any(isinstance(h, logging.NullHandler) for h in cabana.logger.handlers)
    ctx = cabana.log_context()
    with caplog.at_level(logging.DEBUG, logger="cabana"):
        pipe = Pipeline(
            analyses=[
                AnalysisSpec(
                    name="speedcorr",
                    metric={"name": "signal_correlation"},
                    signal="speed",
                    shuffle=ShuffleConfig(n_shuffles=40, batch_size=20),
                )
            ]
        )
        pipe.run(sim_session, context=ctx)
    by_level = {}
    for r in caplog.records:
        by_level.setdefault(r.levelno, []).append(r.getMessage())
    info = " ".join(by_level[logging.INFO])
    assert "[analyze] speedcorr" in info and "started" in info and "finished" in info
    assert any("shuffle 20/40" in m for m in by_level[logging.DEBUG])
    assert not any("shuffle" in m for m in by_level[logging.INFO])


def test_log_context_level(caplog):
    ctx = cabana.log_context(logging.WARNING)
    with caplog.at_level(logging.INFO, logger="cabana"):
        ctx.log("hello")
        ctx.on_progress(_ev("analysis", message="start"))
    assert [r.levelno for r in caplog.records] == [logging.WARNING, logging.WARNING]


class _Bar:
    made: list = []

    def __init__(self, total=None, **kw):
        self.total, self.kw, self.n, self.closed, self.post = total, kw, 0, False, None
        _Bar.made.append(self)

    def update(self, k):
        self.n += k

    def set_postfix_str(self, s, refresh=True):
        self.post = s

    def close(self):
        self.closed = True


def test_tqdm_context_stub(monkeypatch, sim_session):
    _Bar.made = []
    monkeypatch.setitem(sys.modules, "tqdm", types.SimpleNamespace(tqdm=_Bar))
    ctx = cabana.tqdm_context(desc="x", leave=True, disable=False)
    bar = _Bar.made[0]
    assert bar.total == 1000 and bar.kw["desc"] == "x" and bar.kw["leave"] is True
    ctx.on_progress(_ev("shuffle", "info", frac=0.25))
    assert bar.n == 250 and bar.post == "shuffle:info"
    ctx.on_progress(_ev("shuffle", "info", frac=0.1))  # never goes backwards
    assert bar.n == 250
    ctx.on_progress(_ev("done", "", frac=1.0, message="done"))
    assert bar.n == 1000 and bar.closed
    ctx.on_progress(_ev("shuffle", frac=0.5))  # ignored after close
    assert bar.n == 1000
    # a real run reaches the end
    ctx = cabana.tqdm_context(total=500)
    pipe = Pipeline(
        analyses=[
            AnalysisSpec(
                metric={"name": "signal_correlation"},
                signal="speed",
                shuffle=ShuffleConfig(n_shuffles=40),
            )
        ]
    )
    pipe.run(sim_session, context=ctx)
    assert _Bar.made[-1].n == 500 and _Bar.made[-1].closed


def test_tqdm_missing_raises_with_hint(monkeypatch):
    monkeypatch.setitem(sys.modules, "tqdm", None)
    with pytest.raises(ImportError, match="pip install tqdm"):
        cabana.tqdm_context()


def test_merge_context():
    calls = []
    a = RunContext(
        on_progress=lambda e: calls.append("a"),
        log=lambda m: calls.append("la"),
        should_cancel=lambda: False,
        n_jobs=2,
    )
    b = RunContext(
        on_progress=lambda e: calls.append("b"),
        log=lambda m: calls.append("lb"),
        should_cancel=lambda: True,
        on_error="record",
    )
    m = cabana.merge_context(a, b)
    m.on_progress(_ev("done"))
    m.log("x")
    assert calls == ["a", "b", "la", "lb"]
    assert m.should_cancel() is True and m.on_error == "record" and m.n_jobs == 2
    only_a = cabana.merge_context(a, None)
    assert only_a.should_cancel() is False and only_a.on_progress is a.on_progress
    assert cabana.merge_context(None, None).on_progress is None
    neither = cabana.merge_context(
        RunContext(should_cancel=lambda: False), RunContext(should_cancel=lambda: False)
    )
    assert neither.should_cancel() is False
