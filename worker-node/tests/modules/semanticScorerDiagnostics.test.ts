import { createSemanticScorerDiagnostics } from '../../src/modules/jobs/semanticScorerDiagnostics';

type RecordMetadata = Record<string, unknown>;

const createHarness = () => {
  let wallMs = Date.parse('2026-09-29T12:00:00.000Z');
  let monotonicMs = 100;
  let intervalCallback: (() => void) | undefined;
  let deadlineCallback: (() => void) | undefined;
  const timer = { unref: jest.fn() };
  const deadlineTimer = { unref: jest.fn() };
  const clearInterval = jest.fn();
  const clearTimeout = jest.fn();
  const monitor = {
    enable: jest.fn(),
    disable: jest.fn(),
    reset: jest.fn(),
    mean: 2_000_000,
    min: 1_000_000,
    max: 4_000_000,
    stddev: 500_000,
    percentile: jest.fn(() => 3_000_000)
  };
  const logger = { info: jest.fn() };
  const setIntervalMock = jest.fn((callback: () => void) => {
    intervalCallback = callback;
    return timer;
  });
  const setTimeoutMock = jest.fn((callback: () => void) => {
    deadlineCallback = callback;
    return deadlineTimer;
  });
  const wallNow = jest.fn(() => new Date(wallMs));
  const monotonicNow = jest.fn(() => monotonicMs);
  const processUptime = jest.fn(() => 123.5);
  const memoryUsage = jest.fn(() => ({
    rss: 10,
    heapTotal: 20,
    heapUsed: 15,
    external: 4,
    arrayBuffers: 2
  }));
  const eluSnapshots = [
    { idle: 2, active: 1, utilization: 1 / 3 },
    { idle: 3, active: 2, utilization: 0.4 },
    { idle: 5, active: 3, utilization: 0.375 }
  ];
  let eluSnapshotIndex = 0;
  const eventLoopUtilization = jest.fn(
    (current?: { idle: number; active: number; utilization: number }, previous?: { idle: number; active: number; utilization: number }) => {
      if (current && previous) {
        const idle = current.idle - previous.idle;
        const active = current.active - previous.active;
        return { idle, active, utilization: active / (idle + active) };
      }
      return eluSnapshots[Math.min(eluSnapshotIndex++, eluSnapshots.length - 1)];
    }
  );
  const dependencies = {
    wallNow,
    monotonicNow,
    setInterval: setIntervalMock,
    clearInterval,
    setTimeout: setTimeoutMock,
    clearTimeout,
    processUptime,
    memoryUsage,
    eventLoopUtilization,
    createEventLoopDelayMonitor: jest.fn(() => monitor)
  };

  return {
    logger,
    dependencies,
    timer,
    deadlineTimer,
    monitor,
    setIntervalMock,
    setTimeoutMock,
    clearInterval,
    clearTimeout,
    wallNow,
    monotonicNow,
    processUptime,
    memoryUsage,
    tick: (elapsedMs = 1_000, wallElapsedMs = elapsedMs) => {
      monotonicMs += elapsedMs;
      wallMs += wallElapsedMs;
      intervalCallback?.();
    },
    advance: (elapsedMs: number, wallElapsedMs = elapsedMs) => {
      monotonicMs += elapsedMs;
      wallMs += wallElapsedMs;
    },
    fireDeadline: () => deadlineCallback?.(),
    records: (): RecordMetadata[] => logger.info.mock.calls.map((call) => call[1] as RecordMetadata)
  };
};

describe('semantic scorer diagnostics', () => {
  it('is a true no-op when disabled', () => {
    const harness = createHarness();
    const diagnostics = createSemanticScorerDiagnostics({
      enabled: false,
      queueJobId: 'queue-1',
      logger: harness.logger,
      dependencies: harness.dependencies
    });

    diagnostics.boundary('scoring_started');
    diagnostics.stop();

    expect(harness.logger.info).not.toHaveBeenCalled();
    expect(harness.setIntervalMock).not.toHaveBeenCalled();
    expect(harness.setTimeoutMock).not.toHaveBeenCalled();
    expect(harness.dependencies.createEventLoopDelayMonitor).not.toHaveBeenCalled();
  });

  it('emits stable common fields, process metrics, boundary events, and only allowlisted data', () => {
    const harness = createHarness();
    const diagnostics = createSemanticScorerDiagnostics({
      enabled: true,
      queueJobId: 'queue-2',
      logger: harness.logger,
      dependencies: harness.dependencies
    });

    diagnostics.boundary('selection_started');
    harness.tick();
    diagnostics.stop();

    const records = harness.records();
    expect(harness.logger.info.mock.calls.every(([message]) => message === 'semantic_scorer_diagnostics')).toBe(true);
    expect(records.map((record) => record.eventName)).toEqual([
      'semantic_diagnostics_started',
      'semantic_selection_started',
      'semantic_diagnostics_sample',
      'semantic_diagnostics_final'
    ]);
    for (const record of records) {
      expect(record).toMatchObject({
        queueJobId: 'queue-2',
        timestampUtc: expect.stringMatching(/^2026-09-29T12:00:/),
        elapsedMs: expect.any(Number),
        scope: 'process_wide'
      });
    }
    expect(records[1]).toMatchObject({
      processUptimeSeconds: 123.5,
      memoryBytes: { rss: 10, heapUsed: 15, heapTotal: 20, external: 4, arrayBuffers: 2 },
      eventLoopUtilization: { idle: 1, active: 1, utilization: 0.5 },
      eventLoopDelayMs: { mean: 2, min: 1, max: 4, stddev: 0.5, p99: 3 }
    });
    expect(records[2]).toMatchObject({
      processUptimeSeconds: 123.5,
      memoryBytes: { rss: 10, heapUsed: 15, heapTotal: 20, external: 4, arrayBuffers: 2 },
      eventLoopUtilization: { idle: 2, active: 1, utilization: 1 / 3 },
      eventLoopDelayMs: { mean: 2, min: 1, max: 4, stddev: 0.5, p99: 3 },
      delayed: false
    });
    expect(Object.keys(records[0]).sort()).toEqual(
      ['elapsedMs', 'eventName', 'queueJobId', 'scope', 'timestampUtc'].sort()
    );
    expect(Object.keys(records[1]).sort()).toEqual(
      [
        'elapsedMs',
        'eventLoopDelayMs',
        'eventLoopUtilization',
        'eventName',
        'memoryBytes',
        'processUptimeSeconds',
        'queueJobId',
        'scope',
        'timestampUtc'
      ].sort()
    );
    expect(Object.keys(records[2]).sort()).toEqual(
      [
        'delayed',
        'elapsedMs',
        'eventLoopDelayMs',
        'eventLoopUtilization',
        'eventName',
        'memoryBytes',
        'processUptimeSeconds',
        'queueJobId',
        'scope',
        'timestampUtc'
      ].sort()
    );
    for (const record of [records[1], records[2]]) {
      expect(Object.keys(record.memoryBytes as Record<string, unknown>).sort()).toEqual(
        ['arrayBuffers', 'external', 'heapTotal', 'heapUsed', 'rss'].sort()
      );
      expect(Object.keys(record.eventLoopUtilization as Record<string, unknown>).sort()).toEqual(
        ['active', 'idle', 'utilization'].sort()
      );
      expect(Object.keys(record.eventLoopDelayMs as Record<string, unknown>).sort()).toEqual(
        ['max', 'mean', 'min', 'p99', 'stddev'].sort()
      );
    }
    expect(Object.keys(records[3]).sort()).toEqual(
      [
        'elapsedMs',
        'eventName',
        'queueJobId',
        'reason',
        'recordCount',
        'scope',
        'suppressedRecordCount',
        'timestampUtc'
      ].sort()
    );
    expect(JSON.stringify(records)).not.toMatch(/credential|password|prompt|article|sql|url|body/i);
  });

  it('emits only the typed allowlisted lifecycle metadata keys', () => {
    const harness = createHarness();
    const diagnostics = createSemanticScorerDiagnostics({
      enabled: true,
      queueJobId: 'queue-lifecycle',
      logger: harness.logger,
      dependencies: harness.dependencies
    });

    diagnostics.boundary('selection_completed', { candidateCount: 12, keywordCount: 3 });
    diagnostics.boundary('model_initialization_completed', { durationMs: 45 });
    diagnostics.boundary('model_initialization_failed', {
      durationMs: 46,
      errorName: 'TypeError',
      errorCode: 'ERR_MODEL_LOAD'
    });

    const records = harness.records().slice(1);
    const processMetricKeys = [
      'eventLoopDelayMs',
      'eventLoopUtilization',
      'memoryBytes',
      'processUptimeSeconds'
    ];
    expect(Object.keys(records[0]).sort()).toEqual([
      'candidateCount', 'elapsedMs', 'eventName', 'keywordCount', 'queueJobId', 'scope',
      'timestampUtc', ...processMetricKeys
    ].sort());
    expect(Object.keys(records[1]).sort()).toEqual([
      'durationMs', 'elapsedMs', 'eventName', 'queueJobId', 'scope', 'timestampUtc',
      ...processMetricKeys
    ].sort());
    expect(Object.keys(records[2]).sort()).toEqual([
      'durationMs', 'elapsedMs', 'errorCode', 'errorName', 'eventName', 'queueJobId',
      'scope', 'timestampUtc', ...processMetricKeys
    ].sort());
  });

  it('uses cumulative ELU snapshots as the rolling baseline across multiple samples', () => {
    const harness = createHarness();
    const cumulative = [
      { idle: 10, active: 5, utilization: 1 / 3 },
      { idle: 14, active: 7, utilization: 1 / 3 },
      { idle: 20, active: 10, utilization: 1 / 3 }
    ];
    let snapshotIndex = 0;
    const elu = jest.fn(
      (current?: (typeof cumulative)[number], previous?: (typeof cumulative)[number]) => {
        if (current && previous) {
          const idle = current.idle - previous.idle;
          const active = current.active - previous.active;
          return { idle, active, utilization: active / (idle + active) };
        }
        return cumulative[snapshotIndex++];
      }
    );
    harness.dependencies.eventLoopUtilization = elu;
    createSemanticScorerDiagnostics({
      enabled: true,
      queueJobId: 'queue-elu',
      logger: harness.logger,
      dependencies: harness.dependencies
    });

    harness.tick();
    harness.tick();

    const samples = harness
      .records()
      .filter((record) => record.eventName === 'semantic_diagnostics_sample');
    expect(samples.map((record) => record.eventLoopUtilization)).toEqual([
      { idle: 4, active: 2, utilization: 1 / 3 },
      { idle: 6, active: 3, utilization: 1 / 3 }
    ]);
    expect(elu).toHaveBeenNthCalledWith(3, cumulative[1], cumulative[0]);
    expect(elu).toHaveBeenNthCalledWith(5, cumulative[2], cumulative[1]);
  });

  it('clamps sampling to once per second, unreferences the interval, and cleans up idempotently', () => {
    const harness = createHarness();
    const diagnostics = createSemanticScorerDiagnostics({
      enabled: true,
      queueJobId: 'queue-3',
      logger: harness.logger,
      sampleIntervalMs: 10,
      dependencies: harness.dependencies
    });

    expect(harness.setIntervalMock).toHaveBeenCalledWith(expect.any(Function), 1_000);
    expect(harness.timer.unref).toHaveBeenCalledTimes(1);
    expect(harness.deadlineTimer.unref).toHaveBeenCalledTimes(1);
    expect(harness.monitor.enable).toHaveBeenCalledTimes(1);

    harness.tick(500);
    expect(
      harness.records().filter((record) => record.eventName === 'semantic_diagnostics_sample')
    ).toHaveLength(0);
    harness.tick(500);
    expect(
      harness.records().filter((record) => record.eventName === 'semantic_diagnostics_sample')
    ).toHaveLength(1);

    diagnostics.stop();
    diagnostics.stop();

    expect(harness.clearInterval).toHaveBeenCalledTimes(1);
    expect(harness.clearTimeout).toHaveBeenCalledTimes(1);
    expect(harness.monitor.disable).toHaveBeenCalledTimes(1);
    expect(harness.records().filter((record) => record.eventName === 'semantic_diagnostics_final')).toHaveLength(1);
  });

  it('marks a delayed sample after the event loop resumes', () => {
    const harness = createHarness();
    createSemanticScorerDiagnostics({
      enabled: true,
      queueJobId: 'queue-delayed',
      logger: harness.logger,
      dependencies: harness.dependencies
    });

    harness.tick(2_750);

    expect(harness.records().find((record) => record.eventName === 'semantic_diagnostics_sample')).toMatchObject({
      delayed: true,
      delayedByMs: 1_750,
      elapsedMs: 2_750
    });
  });

  it('automatically finalizes at fifteen minutes and shares the stop finalization guard', () => {
    const harness = createHarness();
    const diagnostics = createSemanticScorerDiagnostics({
      enabled: true,
      queueJobId: 'queue-duration',
      logger: harness.logger,
      dependencies: harness.dependencies
    });

    harness.tick(900_001);
    diagnostics.stop();

    const finals = harness.records().filter((record) => record.eventName === 'semantic_diagnostics_final');
    expect(finals).toHaveLength(1);
    expect(finals[0]).toMatchObject({ reason: 'duration_limit', suppressedRecordCount: 0 });
    expect(harness.clearInterval).toHaveBeenCalledTimes(1);
    expect(harness.clearTimeout).toHaveBeenCalledTimes(1);
    expect(harness.monitor.disable).toHaveBeenCalledTimes(1);
  });

  it('uses an independent exact fifteen-minute deadline when sampling cadence does not divide it', () => {
    const harness = createHarness();
    const diagnostics = createSemanticScorerDiagnostics({
      enabled: true,
      queueJobId: 'queue-independent-deadline',
      logger: harness.logger,
      sampleIntervalMs: 8 * 60 * 1_000,
      dependencies: harness.dependencies
    });

    expect(harness.setIntervalMock).toHaveBeenCalledWith(expect.any(Function), 8 * 60 * 1_000);
    expect(harness.setTimeoutMock).toHaveBeenCalledWith(expect.any(Function), 15 * 60 * 1_000);
    expect(harness.deadlineTimer.unref).toHaveBeenCalledTimes(1);

    harness.tick(8 * 60 * 1_000);
    harness.advance(7 * 60 * 1_000);
    harness.fireDeadline();
    diagnostics.stop();

    expect(harness.records().filter((record) => record.eventName === 'semantic_diagnostics_final')).toEqual([
      expect.objectContaining({ reason: 'duration_limit', elapsedMs: 15 * 60 * 1_000 })
    ]);
    expect(harness.clearInterval).toHaveBeenCalledTimes(1);
    expect(harness.clearTimeout).toHaveBeenCalledTimes(1);
    expect(harness.monitor.disable).toHaveBeenCalledTimes(1);
  });

  it('schedules deadline enforcement at fifteen minutes when the requested interval is longer', () => {
    const harness = createHarness();
    const diagnostics = createSemanticScorerDiagnostics({
      enabled: true,
      queueJobId: 'queue-long-interval',
      logger: harness.logger,
      sampleIntervalMs: 30 * 60 * 1_000,
      dependencies: harness.dependencies
    });

    expect(harness.setIntervalMock).toHaveBeenCalledWith(expect.any(Function), 15 * 60 * 1_000);
    harness.tick(15 * 60 * 1_000);
    diagnostics.stop();

    expect(harness.records().filter((record) => record.eventName === 'semantic_diagnostics_final')).toEqual([
      expect.objectContaining({ reason: 'duration_limit', elapsedMs: 15 * 60 * 1_000 })
    ]);
    expect(harness.clearInterval).toHaveBeenCalledTimes(1);
    expect(harness.monitor.disable).toHaveBeenCalledTimes(1);
  });

  it('finalizes at the deadline instead of emitting a late boundary before the timer callback', () => {
    const harness = createHarness();
    const diagnostics = createSemanticScorerDiagnostics({
      enabled: true,
      queueJobId: 'queue-late-boundary',
      logger: harness.logger,
      dependencies: harness.dependencies
    });

    harness.advance(15 * 60 * 1_000);
    diagnostics.boundary('scoring_progress');
    diagnostics.stop();

    expect(harness.records().map((record) => record.eventName)).toEqual([
      'semantic_diagnostics_started',
      'semantic_diagnostics_final'
    ]);
    expect(harness.records()[1]).toMatchObject({
      reason: 'duration_limit',
      elapsedMs: 15 * 60 * 1_000
    });
    expect(harness.clearInterval).toHaveBeenCalledTimes(1);
    expect(harness.monitor.disable).toHaveBeenCalledTimes(1);
  });

  it('never exceeds 1,000 records and emits exactly one limit summary', () => {
    const harness = createHarness();
    const diagnostics = createSemanticScorerDiagnostics({
      enabled: true,
      queueJobId: 'queue-record-limit',
      logger: harness.logger,
      dependencies: harness.dependencies
    });

    for (let index = 0; index < 1_100; index += 1) {
      diagnostics.boundary('scoring_progress');
    }
    diagnostics.stop();

    const records = harness.records();
    expect(records).toHaveLength(1_000);
    expect(records.filter((record) => record.eventName === 'semantic_diagnostics_final')).toHaveLength(1);
    expect(records[999]).toMatchObject({ reason: 'record_limit', suppressedRecordCount: 1 });
    expect(harness.clearTimeout).toHaveBeenCalledTimes(1);
  });

  it('returns from a queued sample callback immediately after finalization', () => {
    const harness = createHarness();
    const diagnostics = createSemanticScorerDiagnostics({
      enabled: true,
      queueJobId: 'queue-finalized-callback',
      logger: harness.logger,
      dependencies: harness.dependencies
    });
    diagnostics.stop();
    const callsAfterStop = {
      monotonic: harness.monotonicNow.mock.calls.length,
      uptime: harness.processUptime.mock.calls.length,
      memory: harness.memoryUsage.mock.calls.length,
      elu: harness.dependencies.eventLoopUtilization.mock.calls.length
    };

    harness.tick();

    expect(harness.monotonicNow).toHaveBeenCalledTimes(callsAfterStop.monotonic);
    expect(harness.processUptime).toHaveBeenCalledTimes(callsAfterStop.uptime);
    expect(harness.memoryUsage).toHaveBeenCalledTimes(callsAfterStop.memory);
    expect(harness.dependencies.eventLoopUtilization).toHaveBeenCalledTimes(callsAfterStop.elu);
  });

  it.each([
    'monitor factory',
    'monitor enable',
    'timer creation',
    'timer unref',
    'deadline creation',
    'deadline unref',
    'cleanup',
    'clock',
    'histogram read',
    'histogram reset'
  ])('isolates best-effort lifecycle failure: %s', (failure) => {
    const harness = createHarness();
    if (failure === 'monitor factory') {
      harness.dependencies.createEventLoopDelayMonitor.mockImplementation(() => {
        throw new Error(failure);
      });
    } else if (failure === 'monitor enable') {
      harness.monitor.enable.mockImplementation(() => {
        throw new Error(failure);
      });
    } else if (failure === 'timer creation') {
      harness.setIntervalMock.mockImplementation(() => {
        throw new Error(failure);
      });
    } else if (failure === 'timer unref') {
      harness.timer.unref.mockImplementation(() => {
        throw new Error(failure);
      });
    } else if (failure === 'deadline creation') {
      harness.setTimeoutMock.mockImplementation(() => {
        throw new Error(failure);
      });
    } else if (failure === 'deadline unref') {
      harness.deadlineTimer.unref.mockImplementation(() => {
        throw new Error(failure);
      });
    } else if (failure === 'cleanup') {
      harness.clearInterval.mockImplementation(() => {
        throw new Error(failure);
      });
      harness.clearTimeout.mockImplementation(() => {
        throw new Error(failure);
      });
      harness.monitor.disable.mockImplementation(() => {
        throw new Error(failure);
      });
    } else if (failure === 'clock') {
      harness.wallNow.mockImplementation(() => {
        throw new Error(failure);
      });
    } else if (failure === 'histogram read') {
      harness.monitor.percentile.mockImplementation(() => {
        throw new Error(failure);
      });
    } else {
      harness.monitor.reset.mockImplementation(() => {
        throw new Error(failure);
      });
    }

    expect(() => {
      const diagnostics = createSemanticScorerDiagnostics({
        enabled: true,
        queueJobId: `queue-failure-${failure}`,
        logger: harness.logger,
        dependencies: harness.dependencies
      });
      harness.tick();
      diagnostics.boundary('scoring_completed');
      diagnostics.stop();
      diagnostics.stop();
    }).not.toThrow();
    const boundary = harness
      .records()
      .find((record) => record.eventName === 'semantic_scoring_completed');
    expect(boundary).toEqual(
      expect.objectContaining({
        processUptimeSeconds: expect.any(Number),
        memoryBytes: expect.any(Object),
        eventLoopUtilization: expect.any(Object),
        eventLoopDelayMs: expect.any(Object)
      })
    );
    expect(harness.records().filter((record) => record.eventName === 'semantic_diagnostics_final')).toHaveLength(1);
  });

  it('isolates logger and measurement failures and still releases resources', () => {
    const harness = createHarness();
    harness.logger.info.mockImplementation(() => {
      throw new Error('logger unavailable');
    });
    harness.memoryUsage.mockImplementation(() => {
      throw new Error('measurement unavailable');
    });

    expect(() => {
      const diagnostics = createSemanticScorerDiagnostics({
        enabled: true,
        queueJobId: 'queue-errors',
        logger: harness.logger,
        dependencies: harness.dependencies
      });
      harness.tick();
      diagnostics.boundary('scoring_completed');
      diagnostics.stop();
      diagnostics.stop();
    }).not.toThrow();
    expect(harness.clearInterval).toHaveBeenCalledTimes(1);
    expect(harness.clearTimeout).toHaveBeenCalledTimes(1);
    expect(harness.monitor.disable).toHaveBeenCalledTimes(1);
  });
});
