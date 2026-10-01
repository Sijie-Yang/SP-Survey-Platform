import numpy as np

from sp_streetlevel.core import (
    PanoInfo, capture_filename, folder_for_point, folder_tags, merge_rows, normalize_options,
    normalize_point, parse_csv, plan_views, render_perspective, rows_to_csv, CSV_HEADERS,
)

PANO = PanoInfo(id="P1", lat=1.0, lng=2.0, heading=200.0, links=[14.8, 200.7])


def opts(**kw):
    return normalize_options(kw)


def test_normalize_accepts_panel_camel_case_and_clamps():
    o = normalize_options({"headingCount": 30, "folderMode": "set-per-point", "zoom": 9, "fov": 500, "folder": "a/../b c"})
    assert o["heading_count"] == 12 and o["folder_mode"] == "set-per-point"
    assert o["zoom"] == 5 and o["fov"] == 120 and o["folder"] == "a/b_c"
    p = normalize_point({"id": "x", "lat": "1.5", "lng": 2, "panoId": "Q", "heading": -30, "roadBearing": 370})
    assert p["heading"] == 330 and p["road_bearing"] == 10 and p["pano_id"] == "Q"
    assert normalize_point({"lat": 91, "lng": 0}) is None


def test_presets():
    pt = normalize_point({"id": "a", "lat": 1.0, "lng": 2.0, "heading": 90, "pitch": 5, "fov": 60})
    assert plan_views(pt, PANO, opts()) == [{"kind": "view", "heading": 90, "pitch": 5, "fov": 60}]
    assert plan_views(pt, PANO, opts(preset="pano")) == [{"kind": "pano"}]
    assert [v["heading"] for v in plan_views(pt, PANO, opts(preset="headings", heading_count=4))] == [90, 180, 270, 0]
    road = plan_views({**pt, "heading": 190}, PANO, opts(preset="road"))
    assert [round(v["heading"], 1) for v in road] == [200.7, 290.7, 20.7, 110.7]
    assert [v["road_offset"] for v in road] == [0, 90, 180, 270]
    bare = normalize_point({"id": "b", "lat": 1.0, "lng": 2.0})
    # batch default: follow the road (pano link nearest the car direction)
    assert plan_views(bare, PANO, opts())[0]["heading"] == 200.7
    assert plan_views(bare, PANO, opts(heading_mode="fixed", fixed_heading=-90))[0]["heading"] == 270
    assert plan_views({**bare, "road_bearing": 33}, PANO, opts())[0]["heading"] == 33
    # batch pitch / FOV apply unless the point carries its own (pasted URL / override)
    assert plan_views(bare, PANO, opts(pitch=7, fov=70))[0] == {"kind": "view", "heading": 200.7, "pitch": 7, "fov": 70}
    assert plan_views(pt, PANO, opts(heading_mode="fixed", fixed_heading=0, pitch=7, fov=70))[0] == \
        {"kind": "view", "heading": 90, "pitch": 5, "fov": 60}
    flat = PanoInfo(id="M", lat=1.0, lng=2.0, is_pano=False, provider="mapillary")
    assert plan_views(bare, flat, opts(preset="headings")) == [{"kind": "original"}]


def test_filenames_are_deterministic():
    assert capture_filename("Ab/c", {"kind": "view", "heading": 5.4, "pitch": -3, "fov": 60}) == "gsv-Ab_c-h005-m03-f060.jpg"
    assert capture_filename("P", {"kind": "pano"}) == "gsv-P-pano.jpg"
    assert capture_filename("123", {"kind": "original"}, "mapillary") == "mly-123-orig.jpg"


def test_folders_and_tags():
    o = opts(folder="sets", folder_mode="set-per-point")
    pt = normalize_point({"id": "pt_abcdef", "lat": 1, "lng": 2, "label": "Corner A"})
    assert folder_for_point(pt, o, 0) == "sets/Corner_A"
    assert folder_tags(["sets/Corner_A"], o) == {"sets/Corner_A": "set"}
    assert folder_tags([], opts(folder="streets")) == {"streets": "category"}


def test_render_perspective_faces_requested_heading():
    w = 16
    pano = np.zeros((8, w, 3), dtype=np.uint8)
    pano[:, :, 0] = (np.arange(w) * 15)[None, :]
    centre = lambda img: int(img[img.shape[0] // 2, img.shape[1] // 2, 0])  # noqa: E731
    ahead = render_perspective(pano, 200, 0, 10, 4, 4, pano_heading=200)
    east_of_center = render_perspective(pano, 290, 0, 10, 4, 4, pano_heading=200)
    assert abs(centre(ahead) - 7.5 * 15) < 16
    assert abs(centre(east_of_center) - 11.5 * 15) < 16


def test_csv_round_trip_and_merge():
    rows = [{"media_id": "k1", "name": "a,b", "pano_id": "P"}, {"media_id": "k2"}]
    text = rows_to_csv(rows)
    assert text.startswith("\ufeff" + ",".join(CSV_HEADERS[:3]))
    back = parse_csv(text)
    assert back[0]["name"] == "a,b"
    merged = merge_rows(back, [{"media_id": "k1", "name": "new"}])
    assert [r["name"] for r in merged] == ["new", ""]
