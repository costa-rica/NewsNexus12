"""Typed errors returned by the AI Approver V02 workflow."""


class AiApproverV02Error(RuntimeError):
    code = "ai_approver_v02_error"
    status_code = 500


class AiApproverV02ConfigError(AiApproverV02Error):
    code = "v02_configuration_error"
    status_code = 503


class AiApproverV02ValidationError(AiApproverV02Error):
    code = "invalid_request"
    status_code = 400


class AiApproverV02NotFoundError(AiApproverV02Error):
    code = "run_not_found"
    status_code = 404


class AiApproverV02ConflictError(AiApproverV02Error):
    code = "v02_run_conflict"
    status_code = 409


class AiApproverV02BoundaryUnavailableError(AiApproverV02ValidationError):
    code = "approved_boundary_unavailable"


class AiApproverV02NoEligibleArticlesError(AiApproverV02ValidationError):
    code = "no_eligible_articles"


class AiApproverV02ExpiredPreviewError(AiApproverV02ConflictError):
    code = "preview_expired"


class AiApproverV02ExecutionError(AiApproverV02Error):
    code = "execution_failed"
