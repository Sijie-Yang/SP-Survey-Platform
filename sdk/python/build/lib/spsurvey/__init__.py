"""spsurvey: Python SDK for SP-Survey (https://sp-survey.org).

    from spsurvey import Client, pairwise_survey
    sp = Client()
    project = sp.create_project("Street safety", survey_config=pairwise_survey("Street safety", "Which street looks safer?"))
"""
from .auth import login, refresh, clear_credentials
from .client import Client, Draft, Project, Release, SiliconRun, UploadedImage, csv_rows, write_files_tree, write_files_zip
from .errors import ApiError, AuthError, ConflictError, SPSurveyError
from .surveys import (
    consent_question, demographics_page, pairwise_question, pairwise_survey, rating_question, rating_survey,
    slider_group_question, survey,
)

__version__ = "0.1.0"
__all__ = [
    "Client", "Draft", "Project", "Release", "SiliconRun", "UploadedImage",
    "ApiError", "AuthError", "ConflictError", "SPSurveyError",
    "login", "refresh", "clear_credentials",
    "survey", "pairwise_survey", "rating_survey", "pairwise_question", "rating_question", "slider_group_question",
    "consent_question", "demographics_page", "csv_rows", "write_files_tree", "write_files_zip",
]
