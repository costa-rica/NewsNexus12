type PromptBody = {
  name?: unknown;
  description?: unknown;
  promptInMarkdown?: unknown;
  isActive?: unknown;
  promptRole?: unknown;
  promptKey?: unknown;
  pipelineVersion?: unknown;
  responseSchemaVersion?: unknown;
  modelName?: unknown;
};

type ActiveBody = {
  isActive?: unknown;
  confirmActivateGatekeeper?: unknown;
};

type HumanVerifyBody = {
  isHumanApproved?: unknown;
  reasonHumanRejected?: unknown;
};

type TopScoresBody = {
  articleIds?: unknown;
};

type ReviewPageStartJobBody = {
  articleId?: unknown;
  name?: unknown;
  promptInMarkdown?: unknown;
  sourcePromptVersionId?: unknown;
  promptRole?: unknown;
  promptKey?: unknown;
  pipelineVersion?: unknown;
  responseSchemaVersion?: unknown;
  modelName?: unknown;
};

const ALLOWED_PROMPT_ROLES = new Set([
  "category_score",
  "legacy_category_score",
  "gatekeeper",
]);

export function normalizePromptRole(value: unknown): string {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : "category_score";
}

function validateOptionalString(
  value: unknown,
  fieldName: string,
): { isValid: boolean; error?: string } {
  if (value !== undefined && value !== null && typeof value !== "string") {
    return {
      isValid: false,
      error: `${fieldName} must be a string if provided`,
    };
  }
  return { isValid: true };
}

export function validatePromptCreateRequest(body: PromptBody): {
  isValid: boolean;
  error?: string;
} {
  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    return {
      isValid: false,
      error: "name is required",
    };
  }

  if (
    typeof body.promptInMarkdown !== "string" ||
    body.promptInMarkdown.trim().length === 0
  ) {
    return {
      isValid: false,
      error: "promptInMarkdown is required",
    };
  }

  if (
    body.description !== undefined &&
    body.description !== null &&
    typeof body.description !== "string"
  ) {
    return {
      isValid: false,
      error: "description must be a string if provided",
    };
  }

  if (body.isActive !== undefined && typeof body.isActive !== "boolean") {
    return {
      isValid: false,
      error: "isActive must be a boolean if provided",
    };
  }

  const promptRole = normalizePromptRole(body.promptRole);
  if (!ALLOWED_PROMPT_ROLES.has(promptRole)) {
    return {
      isValid: false,
      error: "promptRole must be category_score, legacy_category_score, or gatekeeper",
    };
  }

  for (const [fieldName, value] of [
    ["promptKey", body.promptKey],
    ["pipelineVersion", body.pipelineVersion],
    ["responseSchemaVersion", body.responseSchemaVersion],
    ["modelName", body.modelName],
  ] as const) {
    const validation = validateOptionalString(value, fieldName);
    if (!validation.isValid) {
      return validation;
    }
  }

  return { isValid: true };
}

export function validatePromptActiveRequest(body: ActiveBody): {
  isValid: boolean;
  error?: string;
} {
  if (typeof body.isActive !== "boolean") {
    return {
      isValid: false,
      error: "isActive must be a boolean",
    };
  }

  if (
    body.confirmActivateGatekeeper !== undefined &&
    typeof body.confirmActivateGatekeeper !== "boolean"
  ) {
    return {
      isValid: false,
      error: "confirmActivateGatekeeper must be a boolean if provided",
    };
  }

  return { isValid: true };
}

export function parseNumericId(value: string | string[] | undefined): number | null {
  const normalized = Array.isArray(value) ? value[0] : value;
  if (!normalized) {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return parsed;
}

export function validatePromptHumanVerifyRequest(body: HumanVerifyBody): {
  isValid: boolean;
  error?: string;
} {
  const { isHumanApproved, reasonHumanRejected } = body;

  if (
    isHumanApproved !== true &&
    isHumanApproved !== false &&
    isHumanApproved !== null
  ) {
    return {
      isValid: false,
      error: "isHumanApproved must be true, false, or null",
    };
  }

  if (
    reasonHumanRejected !== undefined &&
    reasonHumanRejected !== null &&
    typeof reasonHumanRejected !== "string"
  ) {
    return {
      isValid: false,
      error: "reasonHumanRejected must be a string if provided",
    };
  }

  if (
    isHumanApproved === false &&
    (typeof reasonHumanRejected !== "string" ||
      reasonHumanRejected.trim().length === 0)
  ) {
    return {
      isValid: false,
      error: "reasonHumanRejected is required when rejecting a score",
    };
  }

  return { isValid: true };
}

export function validateTopScoresRequest(body: TopScoresBody): {
  isValid: boolean;
  error?: string;
} {
  const { articleIds } = body;

  if (!Array.isArray(articleIds) || articleIds.length === 0) {
    return {
      isValid: false,
      error: "articleIds must be a non-empty array",
    };
  }

  if (!articleIds.every((value) => Number.isInteger(value) && value > 0)) {
    return {
      isValid: false,
      error: "articleIds must contain positive integers only",
    };
  }

  return { isValid: true };
}

export function validateReviewPageStartJobRequest(
  body: ReviewPageStartJobBody,
): {
  isValid: boolean;
  error?: string;
} {
  if (!Number.isInteger(body.articleId) || Number(body.articleId) <= 0) {
    return {
      isValid: false,
      error: "articleId must be a positive integer",
    };
  }

  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    return {
      isValid: false,
      error: "name is required",
    };
  }

  if (
    typeof body.promptInMarkdown !== "string" ||
    body.promptInMarkdown.trim().length === 0
  ) {
    return {
      isValid: false,
      error: "promptInMarkdown is required",
    };
  }

  if (
    body.sourcePromptVersionId !== undefined &&
    body.sourcePromptVersionId !== null &&
    (!Number.isInteger(body.sourcePromptVersionId) ||
      Number(body.sourcePromptVersionId) <= 0)
  ) {
    return {
      isValid: false,
      error: "sourcePromptVersionId must be a positive integer if provided",
    };
  }

  const promptRole = normalizePromptRole(body.promptRole);
  if (!ALLOWED_PROMPT_ROLES.has(promptRole)) {
    return {
      isValid: false,
      error: "promptRole must be category_score, legacy_category_score, or gatekeeper",
    };
  }

  for (const [fieldName, value] of [
    ["promptKey", body.promptKey],
    ["pipelineVersion", body.pipelineVersion],
    ["responseSchemaVersion", body.responseSchemaVersion],
    ["modelName", body.modelName],
  ] as const) {
    const validation = validateOptionalString(value, fieldName);
    if (!validation.isValid) {
      return validation;
    }
  }

  return { isValid: true };
}
