"""Pick the imagery backend for a job: Google Street View (default, no key) or Mapillary (free token)."""

from typing import Optional

from .google import GoogleStreetViewBackend
from .mapillary import GRAPH_API, MapillaryBackend


def make_backend(options: dict, upstream_override: Optional[str] = None, mapillary_api: Optional[str] = None):
    if options.get("source") == "mapillary":
        return MapillaryBackend(options.get("mapillary_token", ""), api_base=mapillary_api or GRAPH_API)
    return GoogleStreetViewBackend(upstream_override=upstream_override)
