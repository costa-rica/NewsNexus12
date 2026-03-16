"""Location scorer specific error types."""


class LocationScorerError(Exception):
    """Base exception for all location scorer module errors."""


class LocationScorerConfigError(LocationScorerError):
    """Raised when location scorer configuration is invalid or incomplete."""


class LocationScorerDatabaseError(LocationScorerError):
    """Raised for repository or SQLite related failures."""


class LocationScorerProcessorError(LocationScorerError):
    """Raised when a location scorer pipeline processor fails."""
