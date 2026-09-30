import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import type { Logger } from 'winston';

const MIN_SAMPLE_INTERVAL_MS = 1_000;
const MAX_DURATION_MS = 15 * 60 * 1_000;
const MAX_RECORDS = 1_000;
const LOG_MESSAGE = 'semantic_scorer_diagnostics';

export type SemanticScorerBoundary =
  | 'selection_started'
  | 'selection_completed'
  | 'scoring_started'
  | 'scoring_progress'
  | 'scoring_completed'
  | 'job_completed'
  | 'job_failed'
  | 'job_cancelled'
  | 'job_started'
  | 'model_initialization_started'
  | 'model_initialization_completed'
  | 'model_initialization_failed'
  | 'first_article_attempt_started'
  | 'job_canceled';

export interface SemanticScorerBoundaryMetadata {
  selection_completed: { candidateCount: number; keywordCount: number };
  model_initialization_completed: { durationMs: number };
  model_initialization_failed: {
    durationMs: number;
    errorName: string;
    errorCode?: string;
  };
}

type SemanticScorerBoundaryArgs<Event extends SemanticScorerBoundary> =
  Event extends keyof SemanticScorerBoundaryMetadata
    ? [metadata: SemanticScorerBoundaryMetadata[Event]]
    : [];

type IntervalHandle = {
  unref?: () => void;
};

type EventLoopUtilization = {
  idle: number;
  active: number;
  utilization: number;
};

type EventLoopDelayMonitor = {
  enable: () => void;
  disable: () => void;
  reset: () => void;
  readonly mean: number;
  readonly min: number;
  readonly max: number;
  readonly stddev: number;
  percentile: (percentile: number) => number;
};

type ProcessMemoryUsage = {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers?: number;
};

export interface SemanticScorerDiagnosticsDependencies {
  wallNow: () => Date;
  monotonicNow: () => number;
  setInterval: (callback: () => void, intervalMs: number) => IntervalHandle;
  clearInterval: (handle: IntervalHandle) => void;
  setTimeout: (callback: () => void, timeoutMs: number) => IntervalHandle;
  clearTimeout: (handle: IntervalHandle) => void;
  processUptime: () => number;
  memoryUsage: () => ProcessMemoryUsage;
  eventLoopUtilization: (
    current?: EventLoopUtilization,
    previous?: EventLoopUtilization
  ) => EventLoopUtilization;
  createEventLoopDelayMonitor: () => EventLoopDelayMonitor;
}

export interface SemanticScorerDiagnosticsOptions {
  enabled: boolean;
  queueJobId: string;
  logger: Pick<Logger, 'info'>;
  sampleIntervalMs?: number;
  dependencies?: Partial<SemanticScorerDiagnosticsDependencies>;
}

export interface SemanticScorerDiagnostics {
  boundary: <Event extends SemanticScorerBoundary>(
    event: Event,
    ...args: SemanticScorerBoundaryArgs<Event>
  ) => void;
  stop: () => void;
}

const defaultDependencies: SemanticScorerDiagnosticsDependencies = {
  wallNow: () => new Date(),
  monotonicNow: () => performance.now(),
  setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
  setTimeout: (callback, timeoutMs) => setTimeout(callback, timeoutMs),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
  processUptime: () => process.uptime(),
  memoryUsage: () => process.memoryUsage(),
  eventLoopUtilization: (current, previous) =>
    performance.eventLoopUtilization(current, previous),
  createEventLoopDelayMonitor: () => monitorEventLoopDelay({ resolution: 20 })
};

const finiteNumber = (value: number): number => (Number.isFinite(value) ? value : 0);
const nanosecondsToMilliseconds = (value: number): number => finiteNumber(value) / 1_000_000;
const boundedNonNegativeNumber = (value: number): number => Math.max(0, finiteNumber(value));
const boundedErrorValue = (value: string, fallback: string): string => {
  const bounded = value.slice(0, 64);
  return /^[A-Za-z][A-Za-z0-9_.-]*$/.test(bounded) ? bounded : fallback;
};

const allowlistedBoundaryFields = <Event extends SemanticScorerBoundary>(
  event: Event,
  metadata?: SemanticScorerBoundaryMetadata[keyof SemanticScorerBoundaryMetadata]
): Record<string, unknown> => {
  if (event === 'selection_completed' && metadata && 'candidateCount' in metadata) {
    return {
      candidateCount: Math.floor(boundedNonNegativeNumber(metadata.candidateCount)),
      keywordCount: Math.floor(boundedNonNegativeNumber(metadata.keywordCount))
    };
  }
  if (event === 'model_initialization_completed' && metadata && 'durationMs' in metadata) {
    return { durationMs: boundedNonNegativeNumber(metadata.durationMs) };
  }
  if (event === 'model_initialization_failed' && metadata && 'errorName' in metadata) {
    return {
      durationMs: boundedNonNegativeNumber(metadata.durationMs),
      errorName: boundedErrorValue(metadata.errorName, 'UnknownError'),
      ...(metadata.errorCode
        ? { errorCode: boundedErrorValue(metadata.errorCode, 'UNKNOWN') }
        : {})
    };
  }
  return {};
};

export const createSemanticScorerDiagnostics = (
  options: SemanticScorerDiagnosticsOptions
): SemanticScorerDiagnostics => {
  if (!options.enabled) {
    const boundary = <Event extends SemanticScorerBoundary>(
      _event: Event,
      ..._args: SemanticScorerBoundaryArgs<Event>
    ): void => undefined;
    return {
      boundary,
      stop: () => undefined
    };
  }

  const dependencies = { ...defaultDependencies, ...options.dependencies };
  const sampleIntervalMs = Math.max(
    MIN_SAMPLE_INTERVAL_MS,
    finiteNumber(options.sampleIntervalMs ?? MIN_SAMPLE_INTERVAL_MS)
  );
  let startedAtMonotonic = 0;
  let lastSampleElapsedMs = 0;
  let recordCount = 0;
  let suppressedRecordCount = 0;
  let finalized = false;
  let interval: IntervalHandle | undefined;
  let deadline: IntervalHandle | undefined;
  let delayMonitor: EventLoopDelayMonitor | undefined;
  let previousUtilization: EventLoopUtilization | undefined;

  try {
    startedAtMonotonic = dependencies.monotonicNow();
  } catch {
    startedAtMonotonic = 0;
  }

  const elapsedMs = (): number => {
    try {
      return Math.max(0, finiteNumber(dependencies.monotonicNow() - startedAtMonotonic));
    } catch {
      return 0;
    }
  };

  const commonFields = (eventName: string): Record<string, unknown> => {
    let timestampUtc = new Date(0).toISOString();
    try {
      timestampUtc = dependencies.wallNow().toISOString();
    } catch {
      // A clock failure must not affect queue work.
    }

    return {
      eventName,
      queueJobId: options.queueJobId,
      timestampUtc,
      elapsedMs: elapsedMs(),
      scope: 'process_wide'
    };
  };

  const safeLog = (metadata: Record<string, unknown>): void => {
    try {
      options.logger.info(LOG_MESSAGE, metadata);
    } catch {
      // Diagnostics are strictly best-effort.
    }
  };

  const safeNumber = (read: () => number): number => {
    try {
      return finiteNumber(read());
    } catch {
      return 0;
    }
  };

  const captureProcessMetrics = (): Record<string, unknown> => {
    const memoryBytes: Record<string, number> = {
      rss: 0,
      heapUsed: 0,
      heapTotal: 0,
      external: 0
    };
    try {
      const memory = dependencies.memoryUsage();
      memoryBytes.rss = finiteNumber(memory.rss);
      memoryBytes.heapUsed = finiteNumber(memory.heapUsed);
      memoryBytes.heapTotal = finiteNumber(memory.heapTotal);
      memoryBytes.external = finiteNumber(memory.external);
      if (typeof memory.arrayBuffers === 'number') {
        memoryBytes.arrayBuffers = finiteNumber(memory.arrayBuffers);
      }
    } catch {
      // Keep the required memory shape with safe zero values.
    }

    let utilization: EventLoopUtilization = { idle: 0, active: 0, utilization: 0 };
    try {
      const currentUtilization = dependencies.eventLoopUtilization();
      try {
        utilization = previousUtilization
          ? dependencies.eventLoopUtilization(currentUtilization, previousUtilization)
          : currentUtilization;
      } finally {
        // Returned deltas are not valid baselines; retain the cumulative snapshot.
        previousUtilization = currentUtilization;
      }
    } catch {
      // Keep a stable, allowlisted ELU payload when measurement is unavailable.
    }

    const delay = delayMonitor;
    const zeroEventLoopDelayMs = {
      mean: 0,
      min: 0,
      max: 0,
      stddev: 0,
      p99: 0
    };
    let eventLoopDelayMs = zeroEventLoopDelayMs;
    let meanNanoseconds = Number.NaN;
    try {
      meanNanoseconds = delay?.mean ?? Number.NaN;
    } catch {
      // Treat an unreadable histogram as having no valid observations.
    }
    if (Number.isFinite(meanNanoseconds)) {
      eventLoopDelayMs = {
        mean: nanosecondsToMilliseconds(meanNanoseconds),
        min: safeNumber(() => nanosecondsToMilliseconds(delay?.min ?? 0)),
        max: safeNumber(() => nanosecondsToMilliseconds(delay?.max ?? 0)),
        stddev: safeNumber(() => nanosecondsToMilliseconds(delay?.stddev ?? 0)),
        p99: safeNumber(() => nanosecondsToMilliseconds(delay?.percentile(99) ?? 0))
      };
    }

    return {
      processUptimeSeconds: safeNumber(dependencies.processUptime),
      memoryBytes,
      eventLoopUtilization: {
        idle: finiteNumber(utilization.idle),
        active: finiteNumber(utilization.active),
        utilization: finiteNumber(utilization.utilization)
      },
      eventLoopDelayMs
    };
  };

  const cleanup = (): void => {
    if (interval !== undefined) {
      try {
        dependencies.clearInterval(interval);
      } catch {
        // Cleanup failures must not affect queue work.
      }
      interval = undefined;
    }
    if (deadline !== undefined) {
      try {
        dependencies.clearTimeout(deadline);
      } catch {
        // Cleanup failures must not affect queue work.
      }
      deadline = undefined;
    }
    if (delayMonitor !== undefined) {
      try {
        delayMonitor.disable();
      } catch {
        // Cleanup failures must not affect queue work.
      }
      delayMonitor = undefined;
    }
  };

  const finalize = (reason: 'stopped' | 'duration_limit' | 'record_limit'): void => {
    if (finalized) {
      return;
    }
    finalized = true;
    cleanup();
    recordCount += 1;
    safeLog({
      ...commonFields('semantic_diagnostics_final'),
      reason,
      recordCount,
      suppressedRecordCount
    });
  };

  const emit = (eventName: string, fields: Record<string, unknown> = {}): void => {
    if (finalized) {
      return;
    }
    if (elapsedMs() >= MAX_DURATION_MS) {
      finalize('duration_limit');
      return;
    }
    if (recordCount >= MAX_RECORDS - 1) {
      suppressedRecordCount += 1;
      finalize('record_limit');
      return;
    }
    recordCount += 1;
    safeLog({ ...commonFields(eventName), ...fields });
  };

  const sample = (): void => {
    if (finalized) {
      return;
    }
    try {
      const currentElapsedMs = elapsedMs();
      if (currentElapsedMs >= MAX_DURATION_MS) {
        finalize('duration_limit');
        return;
      }

      const sincePreviousSampleMs = currentElapsedMs - lastSampleElapsedMs;
      if (sincePreviousSampleMs < sampleIntervalMs) {
        return;
      }
      emit('semantic_diagnostics_sample', {
        ...captureProcessMetrics(),
        delayed: sincePreviousSampleMs > sampleIntervalMs,
        ...(sincePreviousSampleMs > sampleIntervalMs
          ? { delayedByMs: sincePreviousSampleMs - sampleIntervalMs }
          : {})
      });
      lastSampleElapsedMs = currentElapsedMs;
      try {
        delayMonitor?.reset();
      } catch {
        // The next sample can continue without a histogram reset.
      }
    } catch {
      // Any process measurement may be unavailable; never affect queue work.
    }
  };

  try {
    previousUtilization = dependencies.eventLoopUtilization();
  } catch {
    previousUtilization = undefined;
  }
  try {
    delayMonitor = dependencies.createEventLoopDelayMonitor();
    delayMonitor.enable();
  } catch {
    try {
      delayMonitor?.disable();
    } catch {
      // A partially enabled monitor is still best-effort cleanup.
    }
    delayMonitor = undefined;
  }

  emit('semantic_diagnostics_started');

  try {
    interval = dependencies.setInterval(sample, Math.min(sampleIntervalMs, MAX_DURATION_MS));
    try {
      interval.unref?.();
    } catch {
      // An inability to unref is not fatal and is isolated from queue work.
    }
  } catch {
    interval = undefined;
  }

  try {
    deadline = dependencies.setTimeout(() => finalize('duration_limit'), MAX_DURATION_MS);
    try {
      deadline.unref?.();
    } catch {
      // An inability to unref is not fatal and is isolated from queue work.
    }
  } catch {
    deadline = undefined;
  }

  const boundary = <Event extends SemanticScorerBoundary>(
    event: Event,
    ...args: SemanticScorerBoundaryArgs<Event>
  ): void => {
    try {
      if (finalized) {
        return;
      }
      emit(`semantic_${event}`, {
        ...captureProcessMetrics(),
        ...allowlistedBoundaryFields(event, args[0])
      });
    } catch {
      // Boundary diagnostics must never affect queue work.
    }
  };

  return {
    boundary,
    stop: () => {
      try {
        finalize('stopped');
      } catch {
        // Final diagnostics must never affect queue work.
      }
    }
  };
};
