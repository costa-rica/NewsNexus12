import { WeeklyArticleFlowRun, WeeklyArticleFlowStatus } from '@newsnexus/db-models';
import { WeeklyFlowCliOptions, WeeklyFlowConfig } from '../config';
import { WorkerResultContractError } from '../contracts';
import { WeeklyFlowRepository, WeeklyStageName } from '../database';
import { WorkerHttpClient, WorkerHttpError } from '../http';
import { appendWeeklyFlowJournal, weeklyJournalPath, WeeklyFlowJournalEvent } from '../reporting';
import { publishWeeklyFlowAlert, stageWeeklyFlowAlert } from '../alerts';
import {
  acceptV02Preview,
  cancelV02Run,
  classifyRssEnding,
  createV02Preview,
  duplicateCleanupPostconditionSatisfied,
  pollV02Terminal,
  PreflightEvidence,
  reconcileV02Outcomes,
  reconcileBackupAfterStart,
  runDuplicateCleanup,
  runOldArticleDeletion,
  runPreflight,
  runRssWorkerStage,
  runSemanticWorkerStage,
  runStateWorkerStage,
  runVerifiedBackup
} from '../stages';

type StageEvidence = Record<string, unknown> & { status?: unknown; startedAt?: unknown; jobId?: unknown };

export interface CoordinatorDependencies {
  config: WeeklyFlowConfig;
  repository: WeeklyFlowRepository;
  workerClient: WorkerHttpClient;
  env?: NodeJS.ProcessEnv;
  preflight?: (options: WeeklyFlowCliOptions) => Promise<PreflightEvidence>;
  duplicateCleanup?: typeof runDuplicateCleanup;
  duplicateCleanupSatisfied?: typeof duplicateCleanupPostconditionSatisfied;
  verifiedBackup?: typeof runVerifiedBackup;
  reconcileBackup?: typeof reconcileBackupAfterStart;
  oldArticleDeletion?: typeof runOldArticleDeletion;
  rssStage?: typeof runRssWorkerStage;
  semanticStage?: typeof runSemanticWorkerStage;
  stateStage?: typeof runStateWorkerStage;
  createV02Preview?: typeof createV02Preview;
  acceptV02Preview?: typeof acceptV02Preview;
  cancelV02Run?: typeof cancelV02Run;
  pollV02Terminal?: typeof pollV02Terminal;
  reconcileV02?: typeof reconcileV02Outcomes;
  appendJournal?: typeof appendWeeklyFlowJournal;
  stageAlert?: typeof stageWeeklyFlowAlert;
  publishAlert?: typeof publishWeeklyFlowAlert;
  sleep?: (milliseconds: number) => Promise<void>;
  validateResumeActivity?: (run: WeeklyArticleFlowRun) => Promise<void>;
  now?: () => Date;
}

export class PreviewRecoveryPendingError extends Error {
  constructor(message: string, public readonly resumeAfter: Date) {
    super(message);
    this.name = 'PreviewRecoveryPendingError';
  }
}

export class WeeklyArticleFlowCoordinator {
  private readonly env: NodeJS.ProcessEnv;
  private readonly now: () => Date;

  constructor(private readonly dependencies: CoordinatorDependencies) {
    this.env = dependencies.env ?? process.env;
    this.now = dependencies.now ?? (() => new Date());
  }

  private stageDeadline(run: WeeklyArticleFlowRun, timeoutSeconds: number): Date {
    const now = this.now().getTime();
    const runDeadline = run.startedAt.getTime() + this.dependencies.config.timeouts.runSeconds * 1000;
    const deadline = Math.min(now + timeoutSeconds * 1000, runDeadline);
    if (deadline <= now) {
      throw new Error('weekly flow 72-hour run budget is exhausted');
    }
    return new Date(deadline);
  }

  private persistedStageDeadline(
    run: WeeklyArticleFlowRun,
    stage: WeeklyStageName,
    timeoutSeconds: number
  ): Date {
    const startedAt = new Date(String(this.evidence(run, stage).startedAt));
    if (Number.isNaN(startedAt.getTime())) throw new Error(`${stage} is missing its persisted start time`);
    const runDeadline = run.startedAt.getTime() + this.dependencies.config.timeouts.runSeconds * 1000;
    const deadline = new Date(Math.min(startedAt.getTime() + timeoutSeconds * 1000, runDeadline));
    if (deadline.getTime() <= this.now().getTime()) throw new Error(`${stage} timed out`);
    return deadline;
  }

  private async waitUntil(run: WeeklyArticleFlowRun, resumeAfter: Date): Promise<void> {
    const runDeadline = run.startedAt.getTime() + this.dependencies.config.timeouts.runSeconds * 1000;
    if (resumeAfter.getTime() >= runDeadline) throw new Error('weekly flow 72-hour run budget is exhausted');
    const waitMs = resumeAfter.getTime() - this.now().getTime();
    if (waitMs > 0) {
      const sleep = this.dependencies.sleep ?? ((milliseconds: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
      await sleep(waitMs);
    }
  }

  private async validateResumeActivity(run: WeeklyArticleFlowRun): Promise<void> {
    const activeJobs = async (worker: 'node' | 'python') => {
      const status = await this.dependencies.workerClient.getQueueStatus(worker);
      return [status.runningJob, ...status.queuedJobs].filter((job): job is NonNullable<typeof job> => job !== null);
    };
    const currentEvidence = this.evidence(run, run.currentStage as WeeklyStageName);
    const expectedNodeJobId = ['google_rss', 'semantic_scorer', 'state_assigner'].includes(run.currentStage)
      ? String(currentEvidence.jobId ?? '') || null
      : null;
    let expectedPythonJobId = run.currentStage === 'ai_approver_v02_execution'
      ? String(currentEvidence.jobId ?? '') || null
      : null;
    let expectedV02RunId = Number.isInteger(currentEvidence.v02RunId)
      ? Number(currentEvidence.v02RunId)
      : null;
    if (run.currentStage === 'ai_approver_v02_preview' && Number.isInteger(currentEvidence.draftRunId)) {
      const state = await this.dependencies.repository.loadV02SafeRunState(Number(currentEvidence.draftRunId));
      if (state && !['draft', 'expired'].includes(state.status)) {
        expectedPythonJobId = state.jobId;
        expectedV02RunId = state.id;
      }
    }
    const [nodeJobs, pythonJobs, latestV02] = await Promise.all([
      activeJobs('node'),
      activeJobs('python'),
      this.dependencies.workerClient.requestJson<{ id?: number; status?: string } | null>(
        'python',
        '/ai-approver-v02/runs/latest'
      )
    ]);
    if (nodeJobs.some(({ jobId }) => jobId !== expectedNodeJobId)) {
      throw new Error('resume found unrelated worker-node activity');
    }
    if (pythonJobs.some(({ jobId }) => jobId !== expectedPythonJobId)) {
      throw new Error('resume found unrelated worker-python activity');
    }
    if (
      latestV02 && ['queued', 'running'].includes(String(latestV02.status)) &&
      Number(latestV02.id) !== expectedV02RunId
    ) throw new Error('resume found an unrelated AI Approver V02 execution');
  }

  private evidence(run: WeeklyArticleFlowRun, stage: WeeklyStageName): StageEvidence {
    return (run.stageResults[stage] ?? {}) as StageEvidence;
  }

  private transitionFields(evidence: Record<string, unknown>): Partial<WeeklyFlowJournalEvent> {
    const result = typeof evidence.result === 'object' && evidence.result !== null
      ? evidence.result as Record<string, unknown>
      : evidence;
    const number = (key: string): number | undefined => Number.isInteger(result[key]) ? Number(result[key]) : undefined;
    const ids = (key: string): number[] | undefined => Array.isArray(result[key])
      ? (result[key] as unknown[]).filter((value): value is number => Number.isInteger(value))
      : undefined;
    return {
      jobId: typeof evidence.jobId === 'string' ? evidence.jobId : undefined,
      v02RunId: Number.isInteger(evidence.v02RunId) ? Number(evidence.v02RunId) : undefined,
      rssArticlesAddedCount: number('articlesAddedCount'),
      selectedCount: number('selectedCount') ?? ids('selectedArticleIds')?.length,
      attemptedCount: number('attemptedCount') ?? ids('attemptedArticleIds')?.length,
      completedCount: number('completedCount') ?? ids('successfulArticleIds')?.length ?? ids('scoredArticleIds')?.length,
      skippedCount: number('skippedCount') ?? (Array.isArray(result.skippedArticles) ? result.skippedArticles.length : undefined),
      failedCount: number('failedCount') ?? (Array.isArray(result.failedArticles) ? result.failedArticles.length : undefined),
      invalidResponseCount: number('invalidResponseCount'),
      unattemptedCount: number('unattemptedCount'),
      unresolvedArticleIds: ids('unresolvedArticleIds'),
      path: typeof evidence.archivePath === 'string' ? evidence.archivePath : undefined,
      endingReason: typeof result.endingReason === 'string' ? result.endingReason : undefined
    };
  }

  private async journalBestEffort(
    run: WeeklyArticleFlowRun,
    stage: WeeklyStageName,
    eventType: string,
    evidence: Record<string, unknown> = {},
    signal?: AbortSignal
  ): Promise<boolean> {
    try {
      await this.appendJournal(run, this.journalEvent(
        run,
        stage,
        eventType,
        typeof evidence.reason === 'string' ? evidence.reason : null,
        this.transitionFields(evidence)
      ), signal);
      return true;
    } catch (error) {
      if (signal?.aborted) return false;
      const message = error instanceof Error ? error.message : 'JSONL append failed';
      console.error(`weekly flow reporting failure: ${message}`);
      const stageResults = { ...run.stageResults };
      const runContext = { ...(stageResults.runContext ?? {}) } as Record<string, unknown>;
      runContext.reportingFailures = [
        ...(Array.isArray(runContext.reportingFailures) ? runContext.reportingFailures : []),
        { occurredAt: this.now().toISOString(), stage, eventType, message }
      ];
      stageResults.runContext = runContext;
      await run.update({ stageResults }).catch(() => undefined);
      return false;
    }
  }

  private async finishStage(
    run: WeeklyArticleFlowRun,
    stage: WeeklyStageName,
    status: 'completed' | 'skipped' | 'failed',
    evidence: Record<string, unknown> = {}
  ): Promise<void> {
    await this.dependencies.repository.finishStage(run, stage, status, evidence);
    await this.journalBestEffort(run, stage, 'stage_finished', { ...evidence, status });
  }

  private async updateStageEvidence(
    run: WeeklyArticleFlowRun,
    stage: WeeklyStageName,
    evidence: Record<string, unknown>
  ): Promise<void> {
    await this.dependencies.repository.updateRunningStageEvidence(run, stage, evidence);
    if (typeof evidence.jobId === 'string') await this.journalBestEffort(run, stage, 'job_started', evidence);
  }

  private async prepareStage(
    run: WeeklyArticleFlowRun,
    stage: WeeklyStageName,
    signal?: AbortSignal
  ): Promise<'run' | 'reattach' | 'skip'> {
    const evidence = this.evidence(run, stage);
    if (evidence.status === 'completed' || evidence.status === 'skipped') return 'skip';
    if (evidence.status === 'running') {
      if (run.currentStage !== stage) throw new Error(`running stage evidence conflicts with current stage: ${stage}`);
      await this.journalBestEffort(run, stage, 'stage_reattached', evidence, signal);
      return 'reattach';
    }
    await this.dependencies.repository.startStage(run, stage);
    await this.journalBestEffort(run, stage, 'stage_started', {}, signal);
    return 'run';
  }

  private async terminate(
    run: WeeklyArticleFlowRun,
    status: WeeklyArticleFlowStatus,
    reason: string,
    originatingStage: string = run.currentStage
  ): Promise<WeeklyArticleFlowRun> {
    await this.dependencies.repository.transitionRun(run, status, reason);
    await this.finalizeReportingBounded(run, status, reason, originatingStage);
    return run;
  }

  private async finalizeReportingBounded(
    run: WeeklyArticleFlowRun,
    status: WeeklyArticleFlowStatus,
    reason: string | null,
    originatingStage: string
  ): Promise<void> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.finalizeReporting(run, status, reason, originatingStage, controller.signal),
        new Promise<void>((_resolve, reject) => {
          timer = setTimeout(() => {
            const error = new Error('reporting timed out');
            controller.abort(error);
            reject(error);
          }, this.dependencies.config.timeouts.reportingSeconds * 1000);
        })
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown reporting failure';
      console.error(`weekly flow final reporting failed: ${message}`);
      const stageResults = { ...run.stageResults };
      const previous = stageResults.reporting ?? {};
      stageResults.reporting = {
        ...previous,
        status: 'failed',
        endedAt: this.now().toISOString(),
        reportingFailures: [
          ...(Array.isArray(previous.reportingFailures) ? previous.reportingFailures : []),
          message
        ]
      };
      await run.update({ stageResults }).catch(() => undefined);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private journalEvent(
    run: WeeklyArticleFlowRun,
    stage: string,
    eventType: string,
    endingReason: string | null,
    extra: Partial<WeeklyFlowJournalEvent> = {}
  ): WeeklyFlowJournalEvent {
    return {
      schemaVersion: 1,
      occurredAt: this.now().toISOString(),
      runId: run.id,
      mode: run.mode,
      host: run.host,
      sourceRevision: run.sourceRevision,
      stage,
      eventType,
      rssArticlesAddedCount: run.rssArticlesAddedCount ?? undefined,
      cohortArticleCount: run.cohortArticleCount ?? undefined,
      endingReason,
      ...extra
    };
  }

  private async appendJournal(
    run: WeeklyArticleFlowRun,
    event: WeeklyFlowJournalEvent,
    signal?: AbortSignal
  ): Promise<string> {
    const append = this.dependencies.appendJournal ?? appendWeeklyFlowJournal;
    const filePath = await append(
      this.dependencies.config.journalDirectory,
      event,
      run.startedAt.toISOString(),
      signal
    );
    signal?.throwIfAborted();
    if (run.jsonlFilePath !== filePath) await run.update({ jsonlFilePath: filePath });
    return filePath;
  }

  private async finalizeReporting(
    run: WeeklyArticleFlowRun,
    status: WeeklyArticleFlowStatus,
    reason: string | null,
    originatingStage: string,
    signal: AbortSignal
  ): Promise<void> {
    signal.throwIfAborted();
    const disposition = await this.prepareStage(run, 'reporting', signal);
    if (disposition === 'skip') return;
    const failures: string[] = [];
    const helperEvents: string[] = [];
    const reconciliation = this.evidence(run, 'reconciliation');
    const execution = this.evidence(run, 'ai_approver_v02_execution');
    let jsonlPath = run.jsonlFilePath;
    try {
      const expectedJournalPath = weeklyJournalPath(
        this.dependencies.config.journalDirectory,
        run.startedAt.toISOString()
      );
      jsonlPath = await this.appendJournal(run, this.journalEvent(run, 'reporting', 'run_terminal', reason, {
        status,
        jobId: typeof execution.jobId === 'string' ? execution.jobId : undefined,
        v02RunId: Number.isInteger(execution.v02RunId) ? Number(execution.v02RunId) : undefined,
        selectedCount: Number(reconciliation.selectedCount ?? 0),
        attemptedCount: Number(reconciliation.attemptedCount ?? 0),
        completedCount: Number(reconciliation.completedCount ?? 0),
        skippedCount: Number(reconciliation.skippedCount ?? 0),
        failedCount: Number(reconciliation.failedCount ?? 0),
        invalidResponseCount: Number(reconciliation.invalidResponseCount ?? 0),
        unattemptedCount: Number(reconciliation.unattemptedCount ?? 0),
        unresolvedArticleIds: Array.isArray(reconciliation.unresolvedArticleIds)
          ? reconciliation.unresolvedArticleIds as number[]
          : [],
        reportPath: expectedJournalPath,
        alertPath: !['completed', 'completed_no_new_articles', 'canceled'].includes(status)
          ? this.dependencies.config.alertStagingPath
          : undefined
      } as Partial<WeeklyFlowJournalEvent>), signal);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'JSONL append failed';
      failures.push(`jsonl: ${message}`);
      console.error(`weekly flow reporting failure: ${message}`);
    }

    const shouldAlert = !['completed', 'completed_no_new_articles', 'canceled'].includes(status);
    if (shouldAlert) {
      try {
        const stageAlert = this.dependencies.stageAlert ?? stageWeeklyFlowAlert;
        await stageAlert(this.dependencies.config.alertStagingPath, {
          runId: run.id,
          status,
          host: run.host,
          failedStage: originatingStage,
          endingReason: reason ?? status,
          counts: {
            rssAdded: run.rssArticlesAddedCount ?? 0,
            cohort: run.cohortArticleCount ?? 0,
            selected: Number(reconciliation.selectedCount ?? 0),
            attempted: Number(reconciliation.attemptedCount ?? 0),
            completed: Number(reconciliation.completedCount ?? 0),
            skipped: Number(reconciliation.skippedCount ?? 0),
            failed: Number(reconciliation.failedCount ?? 0),
            invalidResponse: Number(reconciliation.invalidResponseCount ?? 0),
            unattempted: Number(reconciliation.unattemptedCount ?? 0),
            unresolved: Array.isArray(reconciliation.unresolvedArticleIds) ? reconciliation.unresolvedArticleIds.length : 0
          },
          unresolvedArticleIds: Array.isArray(reconciliation.unresolvedArticleIds)
            ? reconciliation.unresolvedArticleIds as number[]
            : [],
          startedAt: run.startedAt.toISOString(),
          occurredAt: this.now().toISOString(),
          logPath: 'journalctl -u newsnexus12-weekly-article-flow.service',
          jsonlPath,
          firstRecoveryAction: `Inspect weekly run ${run.id} and stage ${originatingStage}; resume only from authoritative Postgres evidence.`
        }, signal);
        signal.throwIfAborted();
        helperEvents.push('staged');
        if (jsonlPath) {
          await this.appendJournal(run, this.journalEvent(run, 'reporting', 'alert_helper_started', reason, {
            alertPath: this.dependencies.config.alertStagingPath
          }), signal);
        }
        const publish = this.dependencies.publishAlert ?? publishWeeklyFlowAlert;
        await publish(
          this.dependencies.config.alertHelperService,
          this.dependencies.config.timeouts.reportingSeconds * 1000,
          this.env,
          signal
        );
        signal.throwIfAborted();
        helperEvents.push('completed');
        if (jsonlPath) {
          await this.appendJournal(run, this.journalEvent(run, 'reporting', 'alert_helper_completed', reason, {
            alertPath: this.dependencies.config.alertStagingPath
          }), signal);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'alert helper failed';
        failures.push(`alert: ${message}`);
        helperEvents.push('failed');
        console.error(`weekly flow alert failure: ${message}`);
        if (jsonlPath) {
          await this.appendJournal(run, this.journalEvent(run, 'reporting', 'alert_helper_failed', message, {
            alertPath: this.dependencies.config.alertStagingPath
          }), signal).catch((journalError) => console.error(
            `weekly flow reporting failure: ${journalError instanceof Error ? journalError.message : 'JSONL append failed'}`
          ));
        }
      }
    }
    const reportingEvidence = {
      jsonlPath,
      alertPath: shouldAlert ? this.dependencies.config.alertStagingPath : null,
      helperEvents,
      reportingFailures: failures
    };
    const reportingStatus = failures.length === 0 ? 'completed' : 'failed';
    signal.throwIfAborted();
    await this.dependencies.repository.finishStage(run, 'reporting', reportingStatus, reportingEvidence);
    if (signal.aborted) {
      const stageResults = { ...run.stageResults };
      stageResults.reporting = {
        ...(stageResults.reporting ?? {}),
        status: 'failed',
        endedAt: this.now().toISOString(),
        reportingFailures: ['reporting timed out']
      };
      await run.update({ stageResults }).catch(() => undefined);
      signal.throwIfAborted();
    }
    const journaled = await this.journalBestEffort(run, 'reporting', 'stage_finished', {
      ...reportingEvidence,
      status: reportingStatus
    }, signal);
    if (!journaled && reportingStatus === 'completed') {
      const stageResults = { ...run.stageResults };
      stageResults.reporting = {
        ...(stageResults.reporting ?? {}),
        status: 'failed',
        reportingFailures: ['jsonl: reporting stage completion event could not be written']
      };
      await run.update({ stageResults });
    }
  }

  async run(options: WeeklyFlowCliOptions): Promise<WeeklyArticleFlowRun> {
    const config = this.dependencies.config;
    const preflight = this.dependencies.preflight ?? ((cliOptions) => runPreflight(
      config,
      cliOptions,
      { workerClient: this.dependencies.workerClient }
    ));
    const preflightEvidence = await this.withTimeout(
      preflight(options),
      config.timeouts.preflightSeconds * 1000,
      'preflight timed out'
    );
    const run = options.resumeRunId
      ? await this.dependencies.repository.loadForResume({
          runId: options.resumeRunId,
          mode: options.mode,
          host: preflightEvidence.host,
          databaseName: preflightEvidence.databaseName,
          sourceRevision: preflightEvidence.sourceRevision
        })
      : await this.dependencies.repository.createNewRun({
          mode: options.mode,
          host: preflightEvidence.host,
          databaseName: preflightEvidence.databaseName,
          sourceRevision: preflightEvidence.sourceRevision,
          scheduledFor: options.mode === 'scheduled_production' ? this.now() : null,
          jsonlFilePath: null
        });
    if (options.resumeRunId) {
      const validateResume = this.dependencies.validateResumeActivity ?? ((activeRun) => this.validateResumeActivity(activeRun));
      await validateResume(run);
      await this.journalBestEffort(run, run.currentStage as WeeklyStageName, 'run_resumed');
    }

    try {
      if (!options.resumeRunId) {
        await this.dependencies.repository.startStage(run, 'preflight', preflightEvidence as unknown as Record<string, unknown>);
        await this.journalBestEffort(run, 'preflight', 'stage_started', preflightEvidence as unknown as Record<string, unknown>);
        await this.finishStage(run, 'preflight', 'completed', preflightEvidence as unknown as Record<string, unknown>);
      }
      if (run.status === 'pending') {
        await this.dependencies.repository.transitionRun(run, 'running');
        await this.journalBestEffort(run, 'preflight', 'run_started');
      }

      const maintenanceContext = {
        repositoryPath: config.repositoryPath,
        backupDirectory: config.backupDirectory,
        env: this.env
      };
      const destructive = options.mode !== 'dev_canary';

      for (const stage of ['duplicate_cleanup', 'backup', 'delete_old_articles'] as const) {
        if (!destructive) {
          const disposition = await this.prepareStage(run, stage);
          if (disposition !== 'skip') {
            await this.finishStage(run, stage, 'skipped', {
              reason: 'dev_canary_disables_destructive_maintenance'
            });
          }
          continue;
        }
        const disposition = await this.prepareStage(run, stage);
        if (disposition === 'skip') continue;
        if (stage === 'duplicate_cleanup') {
          if (disposition === 'reattach') {
            const satisfied = this.dependencies.duplicateCleanupSatisfied ?? duplicateCleanupPostconditionSatisfied;
            if (await satisfied()) {
              await this.finishStage(run, stage, 'completed', {
                remainingCount: 0,
                recovery: 'reconciled_zero_row_postcondition'
              });
              continue;
            }
          }
          const operation = this.dependencies.duplicateCleanup ?? runDuplicateCleanup;
          const evidence = await operation(maintenanceContext, this.remainingStageMs(run, config.timeouts.duplicateCleanupSeconds));
          await this.finishStage(run, stage, 'completed', evidence as unknown as Record<string, unknown>);
          continue;
        }
        if (stage === 'backup') {
          if (disposition === 'reattach') {
            const startedAt = new Date(String(this.evidence(run, stage).startedAt));
            if (Number.isNaN(startedAt.getTime())) throw new Error('backup recovery is missing a trustworthy start time');
            const reconcile = this.dependencies.reconcileBackup ?? reconcileBackupAfterStart;
            const evidence = await reconcile(config.backupDirectory, startedAt);
            await this.finishStage(run, stage, 'completed', {
              ...evidence,
              recovery: 'reconciled_existing_archive'
            });
          } else {
            const operation = this.dependencies.verifiedBackup ?? runVerifiedBackup;
            const evidence = await operation(maintenanceContext, this.remainingStageMs(run, config.timeouts.backupSeconds));
            await this.finishStage(run, stage, 'completed', evidence as unknown as Record<string, unknown>);
          }
          continue;
        }
        if (disposition === 'reattach') throw new Error('old-article deletion requires explicit reconciliation before resume');
        const operation = this.dependencies.oldArticleDeletion ?? runOldArticleDeletion;
        const evidence = await operation(maintenanceContext, this.remainingStageMs(run, config.timeouts.deleteSeconds));
        await this.finishStage(run, stage, 'completed', evidence as unknown as Record<string, unknown>);
      }

      const rssDisposition = await this.prepareStage(run, 'google_rss');
      if (rssDisposition !== 'skip') {
        const previousJobId = rssDisposition === 'reattach'
          ? String(this.evidence(run, 'google_rss').jobId ?? '') || undefined
          : undefined;
        if (rssDisposition === 'reattach' && !previousJobId) throw new Error('RSS recovery is missing its queue job ID');
        const defaultCanaryTarget = options.mode === 'dev_canary' ? config.devRssTarget : undefined;
        const targetArticlesAddedCount = options.canaryTarget ?? defaultCanaryTarget;
        const operation = this.dependencies.rssStage ?? runRssWorkerStage;
        const evidence = await operation({
          client: this.dependencies.workerClient,
          runId: run.id,
          mode: options.mode,
          targetArticlesAddedCount,
          previousJobId,
          deadline: this.stageDeadline(run, config.timeouts.rssSeconds),
          polling: config.polling,
          onJobStarted: async (jobId) => this.updateStageEvidence(run, 'google_rss', { jobId })
        });
        const classification = classifyRssEnding(options.mode, evidence.result.endingReason, targetArticlesAddedCount !== undefined);
        await this.finishStage(run, 'google_rss', 'completed', evidence as unknown as Record<string, unknown>);
        if (classification === 'rate_limited') return this.terminate(run, 'failure_rss_rate_limited', evidence.result.terminalMessage);
        if (classification === 'canceled') return this.terminate(run, 'canceled', evidence.result.terminalMessage);
        if (classification === 'failed') return this.terminate(run, 'failed', evidence.result.terminalMessage);
        const cohortArticleIds = await this.dependencies.repository.getCohortArticleIds(run.id);
        await run.update({ rssArticlesAddedCount: evidence.result.articlesAddedCount, cohortArticleCount: cohortArticleIds.length });
        await this.journalBestEffort(run, 'google_rss', 'cohort_reconciled', {
          articlesAddedCount: evidence.result.articlesAddedCount,
          cohortArticleCount: cohortArticleIds.length
        });
        if (cohortArticleIds.length !== evidence.result.articlesAddedCount) {
          return this.terminate(run, 'failure_rss_cohort_mismatch', 'RSS added count did not match the exact weekly cohort.');
        }
        if (cohortArticleIds.length === 0) {
          return this.terminate(run, 'completed_no_new_articles', 'RSS produced no new weekly cohort articles.');
        }
      }

      const cohortArticleIds = await this.dependencies.repository.getCohortArticleIds(run.id);
      const rssArticlesAddedCount = run.rssArticlesAddedCount ?? cohortArticleIds.length;
      const semanticDisposition = await this.prepareStage(run, 'semantic_scorer');
      if (semanticDisposition !== 'skip') {
        const previousJobId = semanticDisposition === 'reattach'
          ? String(this.evidence(run, 'semantic_scorer').jobId ?? '') || undefined
          : undefined;
        if (semanticDisposition === 'reattach' && !previousJobId) throw new Error('semantic scorer recovery is missing its queue job ID');
        const operation = this.dependencies.semanticStage ?? runSemanticWorkerStage;
        const evidence = await operation({
          client: this.dependencies.workerClient,
          previousJobId,
          deadline: this.stageDeadline(run, config.timeouts.semanticSeconds),
          polling: config.polling,
          onJobStarted: async (jobId) => this.updateStageEvidence(run, 'semantic_scorer', { jobId })
        });
        await this.finishStage(run, 'semantic_scorer', 'completed', evidence as unknown as Record<string, unknown>);
      }

      const stateDisposition = await this.prepareStage(run, 'state_assigner');
      if (stateDisposition !== 'skip') {
        const previousJobId = stateDisposition === 'reattach'
          ? String(this.evidence(run, 'state_assigner').jobId ?? '') || undefined
          : undefined;
        if (stateDisposition === 'reattach' && !previousJobId) throw new Error('state assigner recovery is missing its queue job ID');
        const operation = this.dependencies.stateStage ?? runStateWorkerStage;
        const evidence = await operation({
          client: this.dependencies.workerClient,
          articleIds: cohortArticleIds,
          requestedCapacity: Math.max(rssArticlesAddedCount, cohortArticleIds.length),
          previousJobId,
          deadline: this.stageDeadline(run, config.timeouts.stateSeconds),
          polling: config.polling,
          onJobStarted: async (jobId) => this.updateStageEvidence(run, 'state_assigner', { jobId })
        });
        await this.finishStage(run, 'state_assigner', 'completed', evidence as unknown as Record<string, unknown>);
        if (evidence.result.circuitBreakerTripped) {
          return this.terminate(run, 'failure_state_assigner_circuit_breaker', evidence.result.terminalMessage);
        }
      }

      const previewDisposition = await this.prepareStage(run, 'ai_approver_v02_preview');
      let acceptedEvidence = this.evidence(run, 'ai_approver_v02_preview') as StageEvidence & {
        draftRunId?: number;
        v02RunId?: number;
        previewExpiresAt?: string;
        previewExpiryBarrierAt?: string;
        plannedEligibleCount?: number;
        selectedArticleIds?: number[];
        cohortArticleIds?: number[];
        overlapArticleIds?: number[];
        overlapCount?: number;
        overlapPercentage?: number;
        jobId?: string;
      };
      if (previewDisposition === 'reattach' && (!acceptedEvidence.v02RunId || !acceptedEvidence.jobId)) {
        if (acceptedEvidence.draftRunId) {
          const draftState = await this.dependencies.repository.loadV02SafeRunState(acceptedEvidence.draftRunId);
          if (draftState && !['draft', 'expired'].includes(draftState.status)) {
            if (!draftState.jobId) {
              throw new Error('accepted V02 run has no queue job ID and requires explicit reconciliation');
            }
            acceptedEvidence = {
              ...acceptedEvidence,
              v02RunId: draftState.id,
              jobId: draftState.jobId,
              plannedEligibleCount: draftState.plannedEligibleCount,
              selectedArticleIds: draftState.selectionSnapshot.map(({ articleId }) => articleId)
            };
          } else if (draftState?.status === 'draft') {
            const expiry = draftState.previewExpiresAt ?? (
              acceptedEvidence.previewExpiresAt ? new Date(acceptedEvidence.previewExpiresAt) : null
            );
            if (expiry && expiry.getTime() > this.now().getTime()) {
              const resumeAfter = new Date(expiry.getTime() + 60_000);
              throw new PreviewRecoveryPendingError(
                `V02 draft token was lost; recovery resumes after ${resumeAfter.toISOString()}`,
                resumeAfter
              );
            }
          }
        } else if (acceptedEvidence.previewExpiryBarrierAt) {
          const barrier = new Date(acceptedEvidence.previewExpiryBarrierAt);
          if (!Number.isNaN(barrier.getTime()) && barrier.getTime() > this.now().getTime()) {
            throw new PreviewRecoveryPendingError(
              `V02 preview response was ambiguous; recovery resumes after ${barrier.toISOString()}`,
              barrier
            );
          }
        }
      }

      if (!acceptedEvidence.v02RunId || !acceptedEvidence.jobId) {
        const previewRequestStartedAt = this.now();
        const previewExpiryBarrierAt = new Date(
          previewRequestStartedAt.getTime() + config.v02PreviewTtlSeconds * 1000
        );
        await this.updateStageEvidence(run, 'ai_approver_v02_preview', {
          previewRequestStartedAt: previewRequestStartedAt.toISOString(),
          previewExpiryBarrierAt: previewExpiryBarrierAt.toISOString(),
          requestedArticleCount: rssArticlesAddedCount,
          cohortArticleIds
        });
        await this.journalBestEffort(run, 'ai_approver_v02_preview', 'preview_request_started', {
          requestedArticleCount: rssArticlesAddedCount
        });
        const previewOperation = this.dependencies.createV02Preview ?? createV02Preview;
        let preview;
        try {
          preview = await previewOperation({
            client: this.dependencies.workerClient,
            requestedArticleCount: rssArticlesAddedCount,
            cohortArticleIds
          });
        } catch (error) {
          if (
            error instanceof WorkerHttpError &&
            error.status !== null &&
            error.status >= 400 &&
            error.status < 500
          ) throw error;
          throw new PreviewRecoveryPendingError(
            `V02 preview submission is ambiguous until ${previewExpiryBarrierAt.toISOString()}`,
            previewExpiryBarrierAt
          );
        }
        await this.updateStageEvidence(
          run,
          'ai_approver_v02_preview',
          preview.evidence as unknown as Record<string, unknown>
        );
        await this.journalBestEffort(
          run,
          'ai_approver_v02_preview',
          'preview_created',
          preview.evidence as unknown as Record<string, unknown>
        );
        const acceptOperation = this.dependencies.acceptV02Preview ?? acceptV02Preview;
        try {
          acceptedEvidence = await acceptOperation(
            this.dependencies.workerClient,
            preview.evidence,
            preview.previewToken
          ) as typeof acceptedEvidence;
        } catch (error) {
          throw new PreviewRecoveryPendingError(
            `V02 acceptance response is ambiguous for draft ${preview.evidence.draftRunId}`,
            new Date(this.now().getTime() + config.polling.maxMs)
          );
        } finally {
          preview.previewToken = '';
        }
        await this.updateStageEvidence(
          run,
          'ai_approver_v02_preview',
          acceptedEvidence as unknown as Record<string, unknown>
        );
        await this.journalBestEffort(
          run,
          'ai_approver_v02_preview',
          'preview_accepted',
          acceptedEvidence as unknown as Record<string, unknown>
        );
        await this.finishStage(
          run,
          'ai_approver_v02_preview',
          'completed',
          acceptedEvidence as unknown as Record<string, unknown>
        );
      } else if (previewDisposition !== 'skip') {
        await this.finishStage(
          run,
          'ai_approver_v02_preview',
          'completed',
          acceptedEvidence as unknown as Record<string, unknown>
        );
      }

      const v02RunId = Number(acceptedEvidence.v02RunId);
      const v02JobId = String(acceptedEvidence.jobId);
      const executionDisposition = await this.prepareStage(run, 'ai_approver_v02_execution');
      let terminalEvidence = this.evidence(run, 'ai_approver_v02_execution') as StageEvidence & {
        runStatus?: string;
        queueStatus?: string;
        endingReason?: string | null;
      };
      if (executionDisposition !== 'skip') {
        if (executionDisposition === 'run') {
          await this.updateStageEvidence(run, 'ai_approver_v02_execution', {
            v02RunId,
            jobId: v02JobId
          });
        }
        const pollOperation = this.dependencies.pollV02Terminal ?? pollV02Terminal;
        let executionDeadline: Date;
        try {
          executionDeadline = this.persistedStageDeadline(
            run,
            'ai_approver_v02_execution',
            config.timeouts.aiApproverV02Seconds
          );
        } catch (error) {
          const cancel = this.dependencies.cancelV02Run ?? cancelV02Run;
          try {
            const cancellation = await cancel(this.dependencies.workerClient, v02RunId);
            await this.updateStageEvidence(run, 'ai_approver_v02_execution', {
              cancellation,
              cancellationReason: 'persisted_stage_deadline_expired'
            });
          } catch (cancelError) {
            await this.updateStageEvidence(run, 'ai_approver_v02_execution', {
              cancellationError: cancelError instanceof Error ? cancelError.message : 'V02 cancellation failed',
              cancellationReason: 'persisted_stage_deadline_expired'
            });
          }
          throw error;
        }
        terminalEvidence = await pollOperation({
          client: this.dependencies.workerClient,
          v02RunId,
          jobId: v02JobId,
          deadline: executionDeadline,
          polling: config.polling
        }) as unknown as typeof terminalEvidence;
        await this.finishStage(
          run,
          'ai_approver_v02_execution',
          'completed',
          terminalEvidence as unknown as Record<string, unknown>
        );
      }

      const reconciliationDisposition = await this.prepareStage(run, 'reconciliation');
      if (reconciliationDisposition !== 'skip') {
        const source = await this.dependencies.repository.loadV02Reconciliation(v02RunId);
        if (!source) throw new Error(`V02 reconciliation run not found: ${v02RunId}`);
        const reconcile = this.dependencies.reconcileV02 ?? reconcileV02Outcomes;
        const outcomeEvidence = reconcile(source);
        await this.finishStage(
          run,
          'reconciliation',
          'completed',
          outcomeEvidence as unknown as Record<string, unknown>
        );
      }

      if (terminalEvidence.runStatus === 'canceled' && terminalEvidence.queueStatus === 'canceled') {
        return this.terminate(
          run,
          'canceled',
          terminalEvidence.endingReason ?? 'AI Approver V02 was canceled.',
          'ai_approver_v02_execution'
        );
      }
      if (terminalEvidence.runStatus !== 'completed' || terminalEvidence.queueStatus !== 'completed') {
        return this.terminate(
          run,
          'failure_ai_approver_v02',
          terminalEvidence.endingReason ?? `V02 ended as ${terminalEvidence.runStatus}/${terminalEvidence.queueStatus}`,
          'ai_approver_v02_execution'
        );
      }
      return this.terminate(run, 'completed', 'Weekly article flow completed.');
    } catch (error) {
      if (error instanceof PreviewRecoveryPendingError) {
        await this.updateStageEvidence(run, 'ai_approver_v02_preview', {
          recoveryStatus: 'waiting_for_safe_retry',
          resumeAfter: error.resumeAfter.toISOString(),
          recoveryReason: error.message
        });
        await this.appendJournal(run, this.journalEvent(
          run,
          'ai_approver_v02_preview',
          'recovery_pending',
          error.message
        )).catch((journalError) => console.error(
          `weekly flow reporting failure: ${journalError instanceof Error ? journalError.message : 'JSONL append failed'}`
        ));
        try {
          await this.waitUntil(run, error.resumeAfter);
        } catch (waitError) {
          const reason = waitError instanceof Error ? waitError.message : 'preview recovery wait failed';
          await this.dependencies.repository.transitionRun(run, 'timed_out', reason);
          await this.finalizeReportingBounded(run, 'timed_out', reason, run.currentStage);
          throw waitError;
        }
        return this.run({ ...options, resumeRunId: run.id });
      }
      if (run.status === 'pending' || run.status === 'running') {
        const status: WeeklyArticleFlowStatus = error instanceof WorkerResultContractError
          ? 'failed_worker_result_contract'
          : error instanceof Error && /timed out|72-hour/i.test(error.message)
            ? 'timed_out'
            : ['ai_approver_v02_preview', 'ai_approver_v02_execution', 'reconciliation'].includes(run.currentStage)
              ? 'failure_ai_approver_v02'
              : 'failed';
        const reason = error instanceof Error ? error.message : 'weekly flow failed';
        const currentEvidence = this.evidence(run, run.currentStage as WeeklyStageName);
        if (currentEvidence.status === 'running' && run.currentStage !== 'reporting') {
          await this.finishStage(
            run,
            run.currentStage as WeeklyStageName,
            'failed',
            { reason }
          ).catch(() => undefined);
        }
        await this.dependencies.repository.transitionRun(run, status, reason);
        await this.finalizeReportingBounded(run, status, reason, run.currentStage);
      }
      throw error;
    }
  }

  private remainingStageMs(run: WeeklyArticleFlowRun, timeoutSeconds: number): number {
    return this.stageDeadline(run, timeoutSeconds).getTime() - this.now().getTime();
  }

  private async withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
