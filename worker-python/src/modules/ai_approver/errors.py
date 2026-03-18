"""Errors for the AI approver workflow."""


class AiApproverConfigError(RuntimeError):
    """Raised when AI approver configuration is invalid."""


class AiApproverProcessorError(RuntimeError):
    """Raised when the AI approver workflow fails during processing."""
