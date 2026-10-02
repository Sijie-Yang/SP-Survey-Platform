"""Readable startup errors for missing native libraries."""

import sys

MAC_SYSTEM_DEPS = "brew install gettext && brew install inih"
_MAC_LIB_HINTS = ("libINIReader", "libinih", "libintl", "libexiv2", "pyexiv2")


def explain_import_error(err: BaseException, platform: str = sys.platform) -> str:
    """Message for an OSError raised while importing streetlevel (pyexiv2 loads libexiv2 at import)."""
    text = str(err)
    if platform == "darwin" and any(hint in text for hint in _MAC_LIB_HINTS):
        return (
            "sp_streetlevel could not start: streetlevel's image-metadata dependency pyexiv2 needs two\n"
            "Homebrew libraries on macOS (gettext and inih). Install them once, then start again:\n\n"
            f"    {MAC_SYSTEM_DEPS}\n\n"
            "No Homebrew? Install it from https://brew.sh first.\n"
            f"(Original error: {text})"
        )
    return f"sp_streetlevel could not start: {text}"
