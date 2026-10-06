export type PhaseSixRecoveryJsonRecord = Record<string, unknown>;

export interface PhaseSixIncompatibleAttempt {
  jobId: string;
  jobCreatedAt: string;
  detectedAt: Date;
  missingParameterFields: string[];
  lastStatus?: string;
  cancellationRequestedAt?: Date;
  cancellationOutcome?: string;
  verification?: PhaseSixRecoveryJsonRecord;
}

export interface PhaseSixIncompatibleRecoveryV06 {
  attempts: PhaseSixIncompatibleAttempt[];
}

export interface PhaseSixIncompatibleRecoveryV04 {
  sourceJobId: string;
  sourceJobCreatedAt: string;
  detectedAt: Date;
  missingParameterFields: string[];
  lastStatus: string;
  cancellationRequestedAt?: Date;
  cancellationOutcome?: string;
  verification?: PhaseSixRecoveryJsonRecord;
  replacementJobId?: string;
  replacementStartedAt?: Date;
}

export class PhaseSixRecoveryStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhaseSixRecoveryStateError';
  }
}

const isRecord = (value: unknown): value is PhaseSixRecoveryJsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const nonemptyString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PhaseSixRecoveryStateError(`${field} must be a non-empty string`);
  }
  return value;
};

const timestampString = (value: unknown, field: string): string => {
  const parsed = nonemptyString(value, field);
  if (!Number.isFinite(Date.parse(parsed))) {
    throw new PhaseSixRecoveryStateError(`${field} must be a valid timestamp`);
  }
  return parsed;
};

const dateValue = (value: unknown, field: string): Date =>
  new Date(timestampString(value, field));

const missingFields = (value: unknown, field: string): string[] => {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((item) => typeof item === 'string' && item.trim() !== '')
  ) {
    throw new PhaseSixRecoveryStateError(`${field} must be a non-empty string array`);
  }
  return [...value] as string[];
};

const optionalString = (
  value: unknown,
  field: string
): string | undefined => (value === undefined ? undefined : nonemptyString(value, field));

const optionalDate = (value: unknown, field: string): Date | undefined =>
  value === undefined ? undefined : dateValue(value, field);

const optionalRecord = (
  value: unknown,
  field: string
): PhaseSixRecoveryJsonRecord | undefined => {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new PhaseSixRecoveryStateError(`${field} must be an object`);
  }
  return { ...value };
};

const parseAttempt = (
  value: unknown,
  field = 'Phase 6 incompatible attempt'
): PhaseSixIncompatibleAttempt => {
  if (!isRecord(value)) {
    throw new PhaseSixRecoveryStateError(`${field} must be an object`);
  }
  const lastStatus = optionalString(value.lastStatus, `${field} lastStatus`);
  const cancellationRequestedAt = optionalDate(
    value.cancellationRequestedAt,
    `${field} cancellationRequestedAt`
  );
  const cancellationOutcome = optionalString(
    value.cancellationOutcome,
    `${field} cancellationOutcome`
  );
  const verification = optionalRecord(value.verification, `${field} verification`);
  return {
    jobId: nonemptyString(value.jobId, `${field} jobId`),
    jobCreatedAt: timestampString(value.jobCreatedAt, `${field} jobCreatedAt`),
    detectedAt: dateValue(value.detectedAt, `${field} detectedAt`),
    missingParameterFields: missingFields(
      value.missingParameterFields,
      `${field} missingParameterFields`
    ),
    ...(lastStatus === undefined ? {} : { lastStatus }),
    ...(cancellationRequestedAt === undefined ? {} : { cancellationRequestedAt }),
    ...(cancellationOutcome === undefined ? {} : { cancellationOutcome }),
    ...(verification === undefined ? {} : { verification })
  };
};

const parseV06 = (value: PhaseSixRecoveryJsonRecord): PhaseSixIncompatibleRecoveryV06 => {
  if (!Array.isArray(value.attempts)) {
    throw new PhaseSixRecoveryStateError('Phase 6 incompatible attempts must be an array');
  }
  const attempts = value.attempts.map((attempt, index) =>
    parseAttempt(attempt, `Phase 6 incompatible attempt ${index + 1}`)
  );
  const identities = new Set<string>();
  for (const attempt of attempts) {
    const identity = incompatibleAttemptIdentity(attempt.jobId, attempt.jobCreatedAt);
    if (identities.has(identity)) {
      throw new PhaseSixRecoveryStateError('Phase 6 incompatible attempts contain a duplicate identity');
    }
    identities.add(identity);
  }
  return { attempts };
};

const parseV04 = (value: PhaseSixRecoveryJsonRecord): PhaseSixIncompatibleRecoveryV06 => {
  const sourceJobId = nonemptyString(value.sourceJobId, 'Phase 6 V04 sourceJobId');
  const sourceJobCreatedAt = timestampString(
    value.sourceJobCreatedAt,
    'Phase 6 V04 sourceJobCreatedAt'
  );
  const detectedAt = dateValue(value.detectedAt, 'Phase 6 V04 detectedAt');
  const sourceMissingFields = missingFields(
    value.missingParameterFields,
    'Phase 6 V04 missingParameterFields'
  );
  const hasReplacement = value.replacementJobId !== undefined;
  if (hasReplacement) {
    nonemptyString(value.replacementJobId, 'Phase 6 V04 replacementJobId');
    optionalDate(value.replacementStartedAt, 'Phase 6 V04 replacementStartedAt');
  }

  if (hasReplacement) {
    return {
      attempts: [
        {
          jobId: sourceJobId,
          jobCreatedAt: sourceJobCreatedAt,
          detectedAt,
          missingParameterFields: sourceMissingFields
        }
      ]
    };
  }

  const lastStatus = nonemptyString(value.lastStatus, 'Phase 6 V04 lastStatus');
  const cancellationRequestedAt = optionalDate(
    value.cancellationRequestedAt,
    'Phase 6 V04 cancellationRequestedAt'
  );
  const cancellationOutcome = optionalString(
    value.cancellationOutcome,
    'Phase 6 V04 cancellationOutcome'
  );
  const verification = optionalRecord(value.verification, 'Phase 6 V04 verification');
  return {
    attempts: [
      {
        jobId: sourceJobId,
        jobCreatedAt: sourceJobCreatedAt,
        detectedAt,
        missingParameterFields: sourceMissingFields,
        lastStatus,
        ...(cancellationRequestedAt === undefined ? {} : { cancellationRequestedAt }),
        ...(cancellationOutcome === undefined ? {} : { cancellationOutcome }),
        ...(verification === undefined ? {} : { verification })
      }
    ]
  };
};

export const parsePhaseSixIncompatibleRecovery = (
  value: unknown
): PhaseSixIncompatibleRecoveryV06 | null => {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) {
    throw new PhaseSixRecoveryStateError('Phase 6 incompatible recovery must be an object');
  }
  return Object.prototype.hasOwnProperty.call(value, 'attempts')
    ? parseV06(value)
    : parseV04(value);
};

export const incompatibleAttemptIdentity = (jobId: string, jobCreatedAt: string): string =>
  `${jobId.length}:${jobId}|${jobCreatedAt}`;

export const findPhaseSixIncompatibleAttempt = (
  recovery: PhaseSixIncompatibleRecoveryV06 | null,
  jobId: string,
  jobCreatedAt: string
): PhaseSixIncompatibleAttempt | null =>
  recovery?.attempts.find(
    (attempt) => attempt.jobId === jobId && attempt.jobCreatedAt === jobCreatedAt
  ) ?? null;

export const upsertPhaseSixIncompatibleAttempt = (
  recovery: PhaseSixIncompatibleRecoveryV06 | null,
  attempt: PhaseSixIncompatibleAttempt
): PhaseSixIncompatibleRecoveryV06 => {
  const validatedAttempt = parseAttempt(serializePhaseSixIncompatibleAttempt(attempt));
  const attempts = recovery?.attempts ?? [];
  const existingIndex = attempts.findIndex(
    (candidate) =>
      candidate.jobId === validatedAttempt.jobId &&
      candidate.jobCreatedAt === validatedAttempt.jobCreatedAt
  );
  if (existingIndex < 0) {
    return { attempts: [...attempts, validatedAttempt] };
  }
  return {
    attempts: attempts.map((candidate, index) =>
      index === existingIndex
        ? {
            ...candidate,
            ...validatedAttempt,
            missingParameterFields: [...validatedAttempt.missingParameterFields],
            ...(candidate.verification === undefined && validatedAttempt.verification === undefined
              ? {}
              : {
                  verification: {
                    ...(candidate.verification ?? {}),
                    ...(validatedAttempt.verification ?? {})
                  }
                })
          }
        : candidate
    )
  };
};

export const serializePhaseSixIncompatibleAttempt = (
  attempt: PhaseSixIncompatibleAttempt
): PhaseSixRecoveryJsonRecord => ({
  jobId: nonemptyString(attempt.jobId, 'Phase 6 incompatible attempt jobId'),
  jobCreatedAt: timestampString(
    attempt.jobCreatedAt,
    'Phase 6 incompatible attempt jobCreatedAt'
  ),
  detectedAt: (() => {
    if (!Number.isFinite(attempt.detectedAt.getTime())) {
      throw new PhaseSixRecoveryStateError(
        'Phase 6 incompatible attempt detectedAt must be a valid date'
      );
    }
    return attempt.detectedAt.toISOString();
  })(),
  missingParameterFields: missingFields(
    attempt.missingParameterFields,
    'Phase 6 incompatible attempt missingParameterFields'
  ),
  ...(attempt.lastStatus === undefined
    ? {}
    : { lastStatus: nonemptyString(attempt.lastStatus, 'Phase 6 incompatible attempt lastStatus') }),
  ...(attempt.cancellationRequestedAt === undefined
    ? {}
    : {
        cancellationRequestedAt: (() => {
          if (!Number.isFinite(attempt.cancellationRequestedAt.getTime())) {
            throw new PhaseSixRecoveryStateError(
              'Phase 6 incompatible attempt cancellationRequestedAt must be a valid date'
            );
          }
          return attempt.cancellationRequestedAt.toISOString();
        })()
      }),
  ...(attempt.cancellationOutcome === undefined
    ? {}
    : {
        cancellationOutcome: nonemptyString(
          attempt.cancellationOutcome,
          'Phase 6 incompatible attempt cancellationOutcome'
        )
      }),
  ...(attempt.verification === undefined
    ? {}
    : { verification: { ...attempt.verification } })
});

export const serializePhaseSixIncompatibleRecovery = (
  recovery: PhaseSixIncompatibleRecoveryV06
): PhaseSixRecoveryJsonRecord => ({
  attempts: recovery.attempts.map(serializePhaseSixIncompatibleAttempt)
});
