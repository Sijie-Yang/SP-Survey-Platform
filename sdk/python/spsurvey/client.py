"""The high-level client.

    from spsurvey import Client, pairwise_survey

    sp = Client()                                   # token from `spsurvey login` or SPSURVEY_TOKEN
    p = sp.create_project("Street safety", survey_config=pairwise_survey("Street safety", "Which street looks safer?"))
    sp.upload_images(p.id, "./streets")             # real photos only
    print(sp.publish(p.id).live_url)                # share this link
    df = sp.responses_wide(p.id)                    # pandas DataFrame
    sp.download_dataset_package(p.id, "./release")  # citable ZIP contents

Every method maps onto one MCP tool the platform already exposes; nothing is
computed in the SDK that the platform does not compute itself."""
from __future__ import annotations

import base64
import csv
import io
import json
import mimetypes
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Union

from . import auth
from .errors import ApiError, SPSurveyError
from .transport import McpTransport

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
MAX_UPLOAD_BYTES = 8 * 1024 * 1024


@dataclass
class Project:
    id: str
    name: str
    description: str = ""
    published_version: int = 0
    published_at: Optional[str] = None
    updated_at: Optional[str] = None
    raw: dict = field(default_factory=dict, repr=False)

    @classmethod
    def from_api(cls, d: dict) -> "Project":
        return cls(id=str(d.get("id") or d.get("projectId") or ""), name=str(d.get("name") or ""), description=str(d.get("description") or ""),
                   published_version=int(d.get("publishedVersion") or 0), published_at=d.get("publishedAt"),
                   updated_at=d.get("updatedAt") or d.get("draftUpdatedAt"), raw=d)


@dataclass
class Draft:
    project_id: str
    survey_config: dict
    draft_updated_at: str
    validation: dict = field(default_factory=dict)
    urls: dict = field(default_factory=dict)

    @property
    def live_url(self) -> str:
        return str(self.urls.get("liveSurvey") or "")

    @property
    def questions(self) -> List[dict]:
        return [el for page in self.survey_config.get("pages", []) for el in page.get("elements", []) if isinstance(el, dict)]


@dataclass
class Release:
    project_id: str
    version: int
    live_url: str
    raw: dict = field(default_factory=dict, repr=False)


@dataclass
class UploadedImage:
    path: Path
    url: str
    key: str
    folder: str = ""


@dataclass
class SiliconRun:
    id: str
    project_id: str
    status: str
    model: str = ""
    created_at: Optional[str] = None
    raw: dict = field(default_factory=dict, repr=False)


class Client:
    """Talks to sp-survey.org (or a self-hosted instance via ``base_url``)."""

    def __init__(self, token: Optional[str] = None, base_url: Optional[str] = None, timeout: float = 120.0, transport=None):
        self.base_url = auth.resolve_base_url(base_url)
        if transport is not None:
            self._t = transport
        else:
            tok = auth.resolve_token(token, base_url=self.base_url)
            refresher = None if (token or auth.ENV_TOKEN in __import__("os").environ) else (lambda: auth.refresh(base_url=self.base_url)["access_token"])
            self._t = McpTransport(tok, base_url=self.base_url, timeout=timeout, on_auth_error=refresher)

    # ------------------------------------------------------------- discovery

    def capabilities(self) -> dict:
        """Design rules and the question-type catalog. Read this before writing a surveyConfig by hand."""
        return self._t.call("survey_capabilities")

    def tools(self) -> List[str]:
        return [t["name"] for t in self._t.list_tools()]

    # -------------------------------------------------------------- projects

    def list_projects(self) -> List[Project]:
        return [Project.from_api(p) for p in self._t.call("survey_list_projects").get("projects", [])]

    def create_project(self, name: str, survey_config: Optional[dict] = None, description: str = "") -> Project:
        res = self._t.call("survey_create_project", name=name, description=description or None, surveyConfig=survey_config)
        project = res.get("project") or {"id": res.get("projectId"), "name": name}
        p = Project.from_api(project)
        p.raw = res
        return p

    def import_qualtrics(self, qsf: Union[str, Path, dict], name: Optional[str] = None) -> Project:
        """Create a project from a Qualtrics .qsf file (path, JSON text or parsed dict).

        Conversion happens on the platform, the same as the Builder's import button.
        ``project.raw["qualtricsReport"]`` lists questions not converted and logic to rebuild.
        """
        if isinstance(qsf, dict):
            text = json.dumps(qsf)
        elif isinstance(qsf, Path) or (isinstance(qsf, str) and not qsf.lstrip().startswith("{")):
            text = Path(qsf).read_text(encoding="utf-8-sig")
        else:
            text = qsf
        res = self._t.call("survey_import_qualtrics", qsf=text, name=name)
        p = Project.from_api(res.get("project") or {"id": res.get("projectId"), "name": name or (res.get("qualtricsReport") or {}).get("title", "")})
        p.raw = res
        return p

    def create_from_template(self, template_id: str, name: Optional[str] = None, description: str = "") -> Project:
        res = self._t.call("survey_create_from_template", templateId=template_id, name=name, description=description or None)
        return Project.from_api(res.get("project") or {"id": res.get("projectId"), "name": name or ""})

    def list_templates(self) -> List[dict]:
        return self._t.call("survey_list_templates").get("templates", [])

    def update_project(self, project_id: str, **fields) -> dict:
        """name, description, author, year, category, tags, website, huggingfaceDataset."""
        return self._t.call("survey_update_project", projectId=project_id, **fields)

    def delete_project(self, project_id: str) -> dict:
        return self._t.call("survey_delete_project", projectId=project_id, confirm=True)

    def urls(self, project_id: str) -> dict:
        return self._t.call("survey_preview_urls", projectId=project_id).get("urls", {})

    # ----------------------------------------------------------------- draft

    def get_draft(self, project_id: str) -> Draft:
        res = self._t.call("survey_get_draft", projectId=project_id)
        return Draft(project_id=project_id, survey_config=res.get("surveyConfig") or {}, draft_updated_at=str(res.get("draftUpdatedAt") or ""),
                     validation=res.get("validation") or {}, urls=res.get("urls") or {})

    def replace_draft(self, project_id: str, survey_config: dict, expected_draft_updated_at: Optional[str] = None) -> dict:
        token = expected_draft_updated_at or self.get_draft(project_id).draft_updated_at
        return self._t.call("survey_replace_draft", projectId=project_id, surveyConfig=survey_config, expectedDraftUpdatedAt=token)

    def apply_operations(self, project_id: str, operations: List[dict], expected_draft_updated_at: Optional[str] = None) -> dict:
        token = expected_draft_updated_at or self.get_draft(project_id).draft_updated_at
        return self._t.call("survey_apply_operations", projectId=project_id, operations=operations, expectedDraftUpdatedAt=token)

    def validate(self, project_id: Optional[str] = None, survey_config: Optional[dict] = None) -> dict:
        return self._t.call("survey_validate", projectId=project_id, surveyConfig=survey_config)

    def publish(self, project_id: str, summary: str = "") -> Release:
        """Release the saved draft to the participant link."""
        draft = self.get_draft(project_id)
        res = self._t.call("survey_publish", projectId=project_id, expectedDraftUpdatedAt=draft.draft_updated_at, summary=summary or None, confirm=True)
        version = int(res.get("version") or res.get("publishedVersion") or (res.get("release") or {}).get("version") or 0)
        live = draft.live_url or self.urls(project_id).get("liveSurvey", "")
        return Release(project_id=project_id, version=version, live_url=live, raw=res)

    def versions(self, project_id: str) -> List[dict]:
        return self._t.call("survey_list_versions", projectId=project_id).get("versions", [])

    # ----------------------------------------------------------------- media

    def list_media(self, project_id: str) -> dict:
        return self._t.call("media_list", projectId=project_id)

    def upload_image(self, project_id: str, path: Union[str, Path], folder: str = "") -> UploadedImage:
        """Upload one real image file (max 8 MB). Never upload generated placeholders."""
        p = Path(path)
        data = p.read_bytes()
        if len(data) > MAX_UPLOAD_BYTES:
            raise SPSurveyError(f"{p.name} is {len(data) / 1e6:.1f} MB; the limit is 8 MB. Resize it first.")
        content_type = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
        res = self._t.call("media_upload", projectId=project_id, filename=p.name, data=base64.b64encode(data).decode("ascii"),
                           folder=folder or None, contentType=content_type)
        return UploadedImage(path=p, url=str(res.get("url") or ""), key=str(res.get("key") or ""), folder=folder)

    def upload_images(self, project_id: str, folder_or_paths: Union[str, Path, Iterable[Union[str, Path]]], folder: str = "",
                      on_progress=None) -> List[UploadedImage]:
        """Upload every image in a folder (or an explicit list of files) into the project media library."""
        if isinstance(folder_or_paths, (str, Path)):
            root = Path(folder_or_paths)
            paths = sorted(p for p in root.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES) if root.is_dir() else [root]
        else:
            paths = [Path(p) for p in folder_or_paths]
        if not paths:
            raise SPSurveyError("No image files found (jpg, png, webp, gif).")
        out = []
        for i, p in enumerate(paths):
            out.append(self.upload_image(project_id, p, folder=folder))
            if on_progress:
                on_progress(i + 1, len(paths), p)
        return out

    # --------------------------------------------------------------- results

    def _export(self, project_id: str, fmt: str, **filters) -> dict:
        return self._t.call("survey_export_responses", projectId=project_id, format=fmt, **_filters(filters))

    def responses(self, project_id: str, **filters) -> List[dict]:
        """Raw submissions (``responses``, ``displayed_images``, ``survey_metadata`` per row).

        Filters: data_source ('human' | 'practice' | 'silicon'), silicon_run_id, include_practice,
        exclude_flagged, date_from, date_to, session_id, survey_revision."""
        return self._export(project_id, "json", **filters).get("responses", [])

    def responses_wide_csv(self, project_id: str, **filters) -> str:
        return self._export(project_id, "wide_csv", **filters).get("wideCsv", "")

    def responses_wide(self, project_id: str, **filters):
        """One row per submission as a pandas DataFrame (``pip install spsurvey[pandas]``)."""
        pd = _pandas()
        text = self.responses_wide_csv(project_id, **filters)
        return pd.read_csv(io.StringIO(text)) if text.strip() else pd.DataFrame()

    def question_summary_csv(self, project_id: str, question_name: str, **filters) -> str:
        """The platform's per-question summary table (TrueSkill μ/σ per image, means, counts…)."""
        res = self._export(project_id, "summary_csv", questionName=question_name, **filters)
        return res.get("summaryCsv", "")

    def question_summary(self, project_id: str, question_name: str, **filters):
        """Per-question summary as a DataFrame with columns unit_key, unit_label, metric, value, n…"""
        pd = _pandas()
        text = self.question_summary_csv(project_id, question_name, **filters)
        return pd.read_csv(io.StringIO(text)) if text.strip() else pd.DataFrame()

    def image_scores(self, project_id: str, question_name: str, **filters):
        """Wide per-image table: one row per image, one column per metric (mu, sigma, rank, mean, sd…)."""
        pd = _pandas()
        df = self.question_summary(project_id, question_name, **filters)
        if df.empty:
            return df
        df = df[df["unit_key"] != "overall"]
        has_attr = "attribute_key" in df.columns and df["attribute_key"].notna().any()
        index = ["unit_key", "unit_label"] + (["attribute_key", "attribute_label"] if has_attr else [])
        wide = df.pivot_table(index=index, columns="metric", values="value", aggfunc="first").reset_index()
        wide.columns.name = None
        sort_by = "mu" if "mu" in wide.columns else ("mean" if "mean" in wide.columns else None)
        return wide.sort_values(sort_by, ascending=False).reset_index(drop=True) if sort_by else wide

    def results_summary(self, project_id: str, **filters) -> dict:
        return self._t.call("survey_results_summary", projectId=project_id, **_filters(filters))

    def analysis_bundle(self, project_id: str, **filters) -> List[dict]:
        """The full analysis pack as ``[{path, content}]`` (CSV tables, methods.txt, figures, CITATION.cff…)."""
        return (self._export(project_id, "analysis_bundle", **filters).get("analysisBundle") or {}).get("files", [])

    def dataset_package(self, project_id: str, **filters) -> dict:
        """The citable dataset package: ``{"folder": str, "files": [{path, content}]}``.

        Dataset details (title, authors, license, DOI, anonymisation) are the ones saved
        in Results → Export → Citable dataset package; stimulus image files are not bundled."""
        return self._export(project_id, "dataset_package", **filters).get("datasetPackage") or {}

    def download_dataset_package(self, project_id: str, dest: Union[str, Path], zip: bool = True, **filters) -> Path:
        """Write the dataset package to ``dest`` as a ZIP (default) or as a folder tree. Returns the path written."""
        pkg = self.dataset_package(project_id, **filters)
        files = pkg.get("files") or []
        if not files:
            raise ApiError("The dataset package came back empty.")
        folder = pkg.get("folder") or project_id
        dest = Path(dest)
        return write_files_zip(files, dest / f"{folder}.zip", prefix=folder) if zip else write_files_tree(files, dest / folder)

    # --------------------------------------------------------------- silicon

    def silicon_runs(self, project_id: str) -> List[SiliconRun]:
        """Silicon-sample (AI respondent) pretest runs. Start them in the browser; read them here."""
        runs = self._t.call("silicon_list_runs", projectId=project_id).get("runs", [])
        return [SiliconRun(id=str(r.get("id")), project_id=project_id, status=str(r.get("status") or ""), model=str(r.get("model") or ""),
                           created_at=r.get("created_at"), raw=r) for r in runs]

    def silicon_responses(self, run_id: str) -> List[dict]:
        return self._t.call("silicon_run_responses", runId=run_id).get("responses", [])


# ------------------------------------------------------------------ helpers

_FILTER_KEYS = {
    "data_source": "dataSource", "silicon_run_id": "siliconRunId", "include_practice": "includePractice", "exclude_flagged": "excludeFlagged",
    "date_from": "dateFrom", "date_to": "dateTo", "session_id": "sessionId", "survey_revision": "surveyRevision", "question_name": "questionName",
    "timezone": "timezone", "view": "view",
}


def _filters(filters: Dict[str, Any]) -> Dict[str, Any]:
    out = {}
    for k, v in filters.items():
        if v is None:
            continue
        out[_FILTER_KEYS.get(k, k)] = v
    return out


def _pandas():
    try:
        import pandas as pd  # noqa: WPS433 (optional dependency)
    except ImportError as err:
        raise SPSurveyError("pandas is needed for DataFrame results: pip install 'spsurvey[pandas]'") from err
    return pd


def write_files_tree(files: Iterable[dict], root: Union[str, Path]) -> Path:
    root = Path(root)
    for f in files:
        target = root / f["path"]
        target.parent.mkdir(parents=True, exist_ok=True)
        content = f.get("content", "")
        if isinstance(content, str):
            target.write_text(content, "utf-8")
        else:
            target.write_bytes(bytes(content))
    return root


def write_files_zip(files: Iterable[dict], zip_path: Union[str, Path], prefix: str = "") -> Path:
    zip_path = Path(zip_path)
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in files:
            name = f"{prefix}/{f['path']}" if prefix else f["path"]
            content = f.get("content", "")
            zf.writestr(name, content if isinstance(content, (str, bytes)) else bytes(content))
    return zip_path


def csv_rows(text: str) -> List[dict]:
    """Parse a platform CSV without pandas."""
    return list(csv.DictReader(io.StringIO(text)))
