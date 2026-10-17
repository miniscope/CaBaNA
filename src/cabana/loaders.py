"""Real-data loaders in one namespace: ``cabana.loaders.load_boris(...)``.

Neural: ``load_minian``, ``load_caiman``, ``load_camap``.  Behavior: ``load_boris``,
``load_dlc`` (+ ``dlc_centroid``), ``load_moseq``, ``load_position_csv``, ``load_epochs_csv``,
``load_head_orientation``.  Whole folder: ``load_session_dir`` (config-driven; ``SessionDirConfig``,
``write_session_dir_template``).  Clock helpers: ``fit_clock``, ``apply_clock``.  Timing: ``load_miniscope_timestamps``, ``timing_report``.  Behavior times must be on the neural clock; see
``video_time_to_neural`` and ``docs/BRING_YOUR_OWN_DATA.md``.  Optional dependencies are imported
lazily; extras: ``cabana[minian]``, ``cabana[caiman]``, ``cabana[loaders]``.
"""

from __future__ import annotations

from ._alignment import apply_clock, fit_clock
from ._loaders import (
    SessionDirConfig,
    load_session_dir,
    write_session_dir_template,
    dlc_centroid,
    infer_fs,
    load_boris,
    load_caiman,
    load_camap,
    load_dlc,
    load_minian,
    load_epochs_csv,
    load_head_orientation,
    load_calab,
    load_miniscope_timestamps,
    load_moseq,
    load_position_csv,
    timing_report,
    validate_time,
    video_time_to_neural,
)

__all__ = [
    "SessionDirConfig",
    "load_session_dir",
    "write_session_dir_template",
    "apply_clock",
    "dlc_centroid",
    "fit_clock",
    "infer_fs",
    "load_boris",
    "load_caiman",
    "load_camap",
    "load_dlc",
    "load_minian",
    "load_epochs_csv",
    "load_head_orientation",
    "load_calab",
    "load_miniscope_timestamps",
    "load_moseq",
    "load_position_csv",
    "timing_report",
    "validate_time",
    "video_time_to_neural",
]
