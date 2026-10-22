import json
import zipfile

import pytest

from spsurvey import Client, pairwise_survey
from spsurvey.errors import SPSurveyError


def test_create_publish_and_links(client, fake):
    cfg = pairwise_survey("Street safety", "Which street looks safer?")
    p = client.create_project("Street safety", survey_config=cfg)
    assert p.id == "p-new"
    tool, args = fake.calls[-1]
    assert tool == "survey_create_project"
    assert args["surveyConfig"]["pages"][1]["elements"][0]["type"] == "imagepicker"

    rel = client.publish(p.id, summary="first release")
    assert rel.version == 3
    assert rel.live_url == "https://sp-survey.org/survey?project=p-new"
    assert fake.published[0]["summary"] == "first release"


def test_upload_folder_skips_non_images(client, fake, tmp_path):
    (tmp_path / "a.jpg").write_bytes(b"\xff\xd8 fake")
    (tmp_path / "b.PNG").write_bytes(b"\x89PNG fake")
    (tmp_path / "notes.txt").write_text("x")
    done = client.upload_images("p1", tmp_path, folder="set_a")
    assert [u.path.name for u in done] == ["a.jpg", "b.PNG"]
    assert done[0].url.endswith("/set_a/a.jpg")
    _, args = fake.calls[-1]
    assert args["folder"] == "set_a"
    assert args["contentType"] == "image/png"
    assert "data" in args and args["data"]


def test_upload_rejects_large_files(client, tmp_path):
    big = tmp_path / "huge.jpg"
    big.write_bytes(b"0" * (8 * 1024 * 1024 + 1))
    with pytest.raises(SPSurveyError, match="8 MB"):
        client.upload_image("p1", big)


def test_results_filters_are_camel_cased(client, fake):
    rows = client.responses("p1", data_source="human", exclude_flagged=True, date_from="2026-09-01")
    assert rows[0]["id"] == "r1"
    _, args = fake.calls[-1]
    assert args == {"projectId": "p1", "format": "json", "dataSource": "human", "excludeFlagged": True, "dateFrom": "2026-09-01"}


def test_dataframes(client):
    pd = pytest.importorskip("pandas")
    df = client.responses_wide("p1")
    assert list(df["participant_id"]) == ["P0001", "P0002"]
    scores = client.image_scores("p1", "safe")
    assert list(scores["unit_label"]) == ["a.jpg", "b.jpg"]
    assert set(["mu", "sigma", "rank"]).issubset(scores.columns)
    assert "overall" not in set(scores["unit_key"])


def test_dataset_package_zip_and_tree(client, tmp_path):
    z = client.download_dataset_package("p1", tmp_path)
    assert z.name == "street_v1.0_2026-10-22.zip"
    with zipfile.ZipFile(z) as zf:
        names = zf.namelist()
    assert "street_v1.0_2026-10-22/CITATION.cff" in names
    assert "street_v1.0_2026-10-22/data/responses_wide.csv" in names
    tree = client.download_dataset_package("p1", tmp_path / "tree", zip=False)
    assert (tree / "README.md").read_text() == "# Street"


def test_silicon_reads(client):
    runs = client.silicon_runs("p1")
    assert runs[0].model == "qwen-vl" and runs[0].status == "completed"
    assert client.silicon_responses(runs[0].id)[0]["persona_id"] == "a"


def test_json_roundtrip_of_survey_config():
    cfg = pairwise_survey("T", "Which looks safer?", trials=8, allow_tie=True, demographics=True, intro_html="<p>Hi</p>")
    json.dumps(cfg)
    names = [el["name"] for page in cfg["pages"] for el in page["elements"]]
    assert names == ["intro", "consent", "which_looks_safer", "age", "gender"]
    q = cfg["pages"][1]["elements"][0]
    assert q["trialCount"] == 8 and q["imageCount"] == 2 and q["allowTie"] is True and q["choices"] == []
