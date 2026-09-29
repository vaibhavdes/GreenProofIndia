"""Small geometry helpers. Polygons are lists of [lat, lng] points, as Leaflet draws them."""

import math

EARTH_R = 6_371_008.8  # metres
# Phone GPS is typically accurate to 5–20 m, and lake outlines follow the waterline while photos are taken from the bank.
GPS_TOLERANCE_M = 30


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lng1, lat2, lng2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 2 * EARTH_R * math.asin(math.sqrt(h))


def near_or_inside(polygon: list[list[float]], lat: float, lng: float) -> bool:
    return distance_to_polygon_m(polygon, lat, lng) <= GPS_TOLERANCE_M


def contains(polygon: list[list[float]], lat: float, lng: float) -> bool:
    """Ray casting; fine for site-sized polygons."""
    inside = False
    n = len(polygon)
    for i in range(n):
        y1, x1 = polygon[i]
        y2, x2 = polygon[(i + 1) % n]
        if (y1 > lat) != (y2 > lat):
            x_cross = x1 + (lat - y1) * (x2 - x1) / (y2 - y1)
            if lng < x_cross:
                inside = not inside
    return inside


def _local_xy(lat0: float, lat: float, lng: float, lng0: float) -> tuple[float, float]:
    x = math.radians(lng - lng0) * EARTH_R * math.cos(math.radians(lat0))
    y = math.radians(lat - lat0) * EARTH_R
    return x, y


def distance_to_polygon_m(polygon: list[list[float]], lat: float, lng: float) -> float:
    """0 inside; otherwise the distance to the nearest edge."""
    if len(polygon) < 3:
        return float("inf")
    if contains(polygon, lat, lng):
        return 0.0
    pts = [_local_xy(lat, p[0], p[1], lng) for p in polygon]
    best = float("inf")
    for i in range(len(pts)):
        (x1, y1), (x2, y2) = pts[i], pts[(i + 1) % len(pts)]
        dx, dy = x2 - x1, y2 - y1
        seg = dx * dx + dy * dy
        t = 0.0 if seg == 0 else max(0.0, min(1.0, -(x1 * dx + y1 * dy) / seg))
        best = min(best, math.hypot(x1 + t * dx, y1 + t * dy))
    return best


def area_ha(polygon: list[list[float]]) -> float:
    """Spherical polygon area (same method as Leaflet.GeometryUtil / Google's computeArea)."""
    if len(polygon) < 3:
        return 0.0
    total = 0.0
    n = len(polygon)
    for i in range(n):
        lat1, lng1 = polygon[i]
        lat2, lng2 = polygon[(i + 1) % n]
        total += math.radians(lng2 - lng1) * (2 + math.sin(math.radians(lat1)) + math.sin(math.radians(lat2)))
    return abs(total * EARTH_R * EARTH_R / 2) / 10_000

