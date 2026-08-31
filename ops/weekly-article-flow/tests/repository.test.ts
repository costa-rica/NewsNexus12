const dbMock = {
  WeeklyArticleFlowRun: {
    create: jest.fn(),
    findByPk: jest.fn(),
    findOne: jest.fn()
  },
  AiApproverRunV02: {
    findByPk: jest.fn()
  },
  AiApproverArticlePredictionV02: {
    findAll: jest.fn()
  },
  sequelize: {
    query: jest.fn()
  }
};

jest.mock('@newsnexus/db-models', () => dbMock);

import {
  ActiveRunExistsError,
  InvalidRunTransitionError,
  WeeklyFlowRepository
} from '../src/database';

const makeRun = (overrides: Record<string, unknown> = {}) => {
  const run: Record<string, unknown> = {
    id: 1,
    mode: 'dev_canary',
    status: 'pending',
    currentStage: 'preflight',
    host: 'dev-host',
    sourceRevision: 'abc123',
    stageResults: { runContext: { databaseName: 'newsnexus_dev' } },
    update: jest.fn(async (values: Record<string, unknown>) => {
      Object.assign(run, values);
      return run;
    }),
    ...overrides
  };
  return run;
};

describe('weekly flow repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a run with database recovery context', async () => {
    const run = makeRun();
    dbMock.WeeklyArticleFlowRun.create.mockResolvedValue(run);
    const repository = new WeeklyFlowRepository();

    await expect(repository.createNewRun({
      mode: 'dev_canary',
      host: 'dev-host',
      databaseName: 'newsnexus_dev',
      sourceRevision: 'abc123'
    })).resolves.toBe(run);
    expect(dbMock.WeeklyArticleFlowRun.create).toHaveBeenCalledWith(expect.objectContaining({
      status: 'pending',
      stageResults: { runContext: { databaseName: 'newsnexus_dev' } }
    }));
  });

  it('maps the active-run unique conflict to active_run_exists', async () => {
    dbMock.WeeklyArticleFlowRun.create.mockRejectedValue(Object.assign(new Error('duplicate'), {
      name: 'SequelizeUniqueConstraintError'
    }));
    const repository = new WeeklyFlowRepository();

    await expect(repository.createNewRun({
      mode: 'dev_canary',
      host: 'dev-host',
      databaseName: 'newsnexus_dev',
      sourceRevision: 'abc123'
    })).rejects.toBeInstanceOf(ActiveRunExistsError);
  });

  it('enforces run and stage transitions and persists evidence around work', async () => {
    const run = makeRun();
    const repository = new WeeklyFlowRepository();

    await repository.transitionRun(run as never, 'running');
    await repository.startStage(run as never, 'google_rss', { jobId: 'job-1' });
    expect(run.currentStage).toBe('google_rss');
    expect((run.stageResults as Record<string, unknown>).google_rss).toEqual(expect.objectContaining({
      status: 'running',
      jobId: 'job-1'
    }));

    await repository.finishStage(run as never, 'google_rss', 'completed', { articlesAddedCount: 2 });
    expect((run.stageResults as Record<string, unknown>).google_rss).toEqual(expect.objectContaining({
      status: 'completed',
      articlesAddedCount: 2
    }));

    await expect(repository.startStage(run as never, 'backup')).rejects.toBeInstanceOf(InvalidRunTransitionError);
    await repository.transitionRun(run as never, 'completed');
    expect(run.status).toBe('completed');
    expect(run.endedAt).toBeInstanceOf(Date);
  });

  it('queries the exact cohort through request ownership', async () => {
    dbMock.sequelize.query.mockResolvedValue([{ id: 5 }, { id: 8 }]);
    const repository = new WeeklyFlowRepository();
    await expect(repository.getCohortArticleIds(42)).resolves.toEqual([5, 8]);
    expect(dbMock.sequelize.query.mock.calls[0][0]).toContain('"weeklyArticleFlowRunId" = :runId');
    expect(dbMock.sequelize.query.mock.calls[0][1]).toEqual(expect.objectContaining({
      replacements: { runId: 42 }
    }));
  });

  it('loads V02 frozen selection and prediction evidence', async () => {
    dbMock.AiApproverRunV02.findByPk.mockResolvedValue({
      selectionSnapshot: [{ articleId: 10 }, { articleId: 11 }]
    });
    dbMock.AiApproverArticlePredictionV02.findAll.mockResolvedValue([{
      articleId: 10,
      resultStatus: 'completed',
      prediction: 'approved'
    }]);
    const repository = new WeeklyFlowRepository();

    await expect(repository.loadV02Reconciliation(7)).resolves.toEqual(expect.objectContaining({
      selectedArticleIds: [10, 11],
      predictions: [{ articleId: 10, resultStatus: 'completed', prediction: 'approved' }]
    }));
  });

  it('resumes only the same active execution context without creating a run', async () => {
    const run = makeRun({ status: 'running' });
    dbMock.WeeklyArticleFlowRun.findByPk.mockResolvedValue(run);
    dbMock.WeeklyArticleFlowRun.findOne.mockResolvedValue(null);
    const repository = new WeeklyFlowRepository();

    await expect(repository.loadForResume({
      runId: 1,
      mode: 'dev_canary',
      host: 'dev-host',
      databaseName: 'newsnexus_dev',
      sourceRevision: 'abc123'
    })).resolves.toBe(run);
    expect(dbMock.WeeklyArticleFlowRun.create).not.toHaveBeenCalled();

    await expect(repository.loadForResume({
      runId: 1,
      mode: 'dev_canary',
      host: 'dev-host',
      databaseName: 'production',
      sourceRevision: 'abc123'
    })).rejects.toThrow('resume_context_mismatch');
  });
});
