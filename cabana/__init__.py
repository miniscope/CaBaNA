"""CaBaNA — Calcium Behavioral and Neural Analysis."""
from .session import Session

try:
    from ._version import __version__
except ImportError:  # running from a source tree that was never installed
    __version__ = "0.0.0"

__all__ = ["Session", "__version__"]
