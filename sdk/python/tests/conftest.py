"""A fake MCP transport: records calls, replays canned tool results. No network."""
import json
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from spsurvey.client import Client  # noqa: E402

WIDE_CSV = "participant_id,created_at,safe__trial_1\nP0001,2026-09-01,a.jpg\nP0002,2026-09-01,b.jpg\n"
SUMMARY_CSV = (
    "question_name,question_type,n_responses,attribute_key,attribute_label,unit_key,unit_label,metric,value,n\n"
    "safe,imagepicker,40,,,https://m/a.jpg,a.jpg,mu,27.1,30\n"
    "safe,imagepicker,40,,,https://m/a.jpg,a.jpg,sigma,0.9,30\n"
    "safe,imagepicker,40,,,https://m/a.jpg,a.jpg,rank,1,30\n"
    "safe,imagepicker,40,,,https://m/b.jpg,b.jpg,mu,23.4,28\n"
    "safe,imagepicker,40,,,https://m/b.jpg,b.jpg,sigma,1.1,28\n"
    "safe,imagepicker,40,,,https://m/b.jpg,b.jpg,rank,2,28\n"
    "safe,imagepicker,40,,,overall,overall,krippendorff_alpha,0.4,40\n"
)


class FakeTransport:
    def __init__(self):
        self.calls = []
        self.draft_token = "2026-10-22T10:00:00Z"
        self.published = []

    def list_tools(self):
        return [{"name": n} for n in ["survey_capabilities", "survey_list_projects", "survey_export_responses", "silicon_list_runs"]]

    def call(self, tool, **args):
        self.calls.append((tool, args))
        if tool == "survey_list_projects":
            return {"success": True, "projects": [{"id": "p1", "name": "Street", "publishedVersion": 2, "updatedAt": "2026-10-01"}]}
        if tool == "survey_create_project":
            return {"success": True, "project": {"id": "p-new", "name": args["name"]}, "draftUpdatedAt": self.draft_token,
                    "urls": {"liveSurvey": "https://sp-survey.org/survey?project=p-new"}}
        if tool == "survey_import_qualtrics":
            json.loads(args["qsf"])
            return {"success": True, "project": {"id": "p-qsf", "name": args.get("name") or "Pilot"},
                    "qualtricsReport": {"title": "Pilot", "converted": 3, "skipped": [{"id": "QID7", "reason": "heat map has no native equivalent"}], "notes": ["display_logic"]}}
        if tool == "survey_get_draft":
            return {"success": True, "surveyConfig": {"pages": [{"elements": [{"name": "safe", "type": "imagepicker"}]}]},
                    "draftUpdatedAt": self.draft_token, "urls": {"liveSurvey": f"https://sp-survey.org/survey?project={args['projectId']}"}}
        if tool == "survey_publish":
            assert args["confirm"] is True
            assert args["expectedDraftUpdatedAt"] == self.draft_token
            self.published.append(args)
            return {"success": True, "projectId": args["projectId"], "version": 3}
        if tool == "survey_preview_urls":
            return {"success": True, "urls": {"liveSurvey": f"https://sp-survey.org/survey?project={args['projectId']}", "admin": "https://sp-survey.org/admin"}}
        if tool == "media_upload":
            return {"success": True, "url": f"https://media.sp-survey.org/{args.get('folder') or 'root'}/{args['filename']}", "key": f"k/{args['filename']}"}
        if tool == "survey_export_responses":
            fmt = args["format"]
            if fmt == "json":
                return {"success": True, "responses": [{"id": "r1", "responses": {"safe": {"trials": []}}}]}
            if fmt == "wide_csv":
                return {"success": True, "wideCsv": WIDE_CSV}
            if fmt == "summary_csv":
                return {"success": True, "summaryCsv": SUMMARY_CSV}
            if fmt == "analysis_bundle":
                return {"success": True, "analysisBundle": {"files": [{"path": "README.txt", "content": "hi"}, {"path": "responses_wide.csv", "content": WIDE_CSV}]}}
            if fmt == "dataset_package":
                return {"success": True, "datasetPackage": {"folder": "street_v1.0_2026-10-22", "files": [
                    {"path": "README.md", "content": "# Street"}, {"path": "CITATION.cff", "content": "cff-version: 1.2.0\n"},
                    {"path": "data/responses_wide.csv", "content": WIDE_CSV}]}}
        if tool == "silicon_list_runs":
            return {"success": True, "runs": [{"id": "run1", "status": "completed", "model": "qwen-vl", "created_at": "2026-10-20"}]}
        if tool == "silicon_run_responses":
            return {"success": True, "responses": [{"id": "s1", "persona_id": "a", "responses": {}}]}
        if tool == "survey_capabilities":
            return {"success": True, "questionTypes": ["imagepicker", "imagerating"]}
        raise AssertionError(f"unexpected tool {tool}")


@pytest.fixture
def fake():
    return FakeTransport()


@pytest.fixture
def client(fake):
    return Client(transport=fake, base_url="https://sp-survey.org")


@pytest.fixture
def tmp_credentials(tmp_path, monkeypatch):
    path = tmp_path / "credentials.json"
    monkeypatch.setenv("SPSURVEY_CREDENTIALS", str(path))
    monkeypatch.delenv("SPSURVEY_TOKEN", raising=False)
    return path
