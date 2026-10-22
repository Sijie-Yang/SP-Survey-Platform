"""Exceptions raised by the SP-Survey SDK."""


class SPSurveyError(Exception):
    """Base class for every SDK error."""


class AuthError(SPSurveyError):
    """No usable token, or the server rejected the token."""


class ApiError(SPSurveyError):
    """The platform returned an error for a call.

    ``code`` is the platform's short error code when it sent one
    (for example ``PROJECT_NOT_FOUND`` or ``insufficient_scope``).
    """

    def __init__(self, message: str, code: str = "", status: int = 0, details=None):
        super().__init__(message)
        self.code = code
        self.status = status
        self.details = details


class ConflictError(ApiError):
    """The draft changed since it was read (optimistic-concurrency token stale)."""
