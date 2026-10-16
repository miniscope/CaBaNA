"""Real-data loaders in one namespace: ``cabana.loaders.load_boris(...)``.

Neural: ``load_minian``, ``load_caiman``, ``load_camap``.  Behavior: ``load_boris``,
``load_dlc`` (+ ``dlc_centroid``), ``load_moseq``.  Behavior times must be on the neural clock; see
``video_time_to_neural`` and ``docs/BRING_YOUR_OWN_DATA.md``.  Optional dependencies are imported
lazily; extras: ``cabana[minian]``, ``cabana[caiman]``, ``cabana[loaders]``.
"""

from __future__ import annotations

from ._loaders import (
    dlc_centroid,
    infer_fs,
    load_boris,
    load_caiman,
    load_camap,
    load_dlc,
    load_minian,
    load_moseq,
    validate_time,
    video_time_to_neural,
)

__all__ = [
    "dlc_centroid",
    "infer_fs",
    "load_boris",
    "load_caiman",
    "load_camap",
    "load_dlc",
    "load_minian",
    "load_moseq",
    "validate_time",
    "video_time_to_neural",
]
