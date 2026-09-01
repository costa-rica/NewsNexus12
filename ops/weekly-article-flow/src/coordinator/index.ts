import { WeeklyArticleFlowRun, WeeklyArticleFlowStatus } from '@newsnexus/db-models';
import { WeeklyFlowCliOptions, WeeklyFlowConfig } from '../config';
import { WorkerResultContractError } from '../contracts';
import { WeeklyFlowRepository, WeeklyStageName } from '../database';
import { WorkerHttpClient } from '../http';
import {
  classifyRssEnding,
  duplicateCleanupPostconditionSatisfied,
  PreflightEvidence,
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
  now?: () => Date;
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

  private evidence(run: WeeklyArticleFlowRun, stage: WeeklyStageName): StageEvidence {
    return (run.stageResults[stage] ?? {}) as StageEvidence;
  }

  private async prepareStage(run: WeeklyArticleFlowRun, stage: WeeklyStageName): Promise<'run' | 'reattach' | 'skip'> {
    const evidence = this.evidence(run, stage);
    if (evidence.status === 'completed' || evidence.status === 'skipped') return 'skip';
    if (evidence.status === 'running') {
      if (run.currentStage !== stage) throw new Error(`running stage evidence conflicts with current stage: ${stage}`);
      return 'reattach';
    }
    await this.dependencies.repository.startStage(run, stage);
    return 'run';
  }

  private async terminate(
    run: WeeklyArticleFlowRun,
    status: WeeklyArticleFlowStatus,
    reason: string
  ): Promise<WeeklyArticleFlowRun> {
    await this.dependencies.repository.transitionRun(run, status, reason);
    return run;
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

    try {
      if (!options.resumeRunId) {
        await this.dependencies.repository.startStage(run, 'preflight', preflightEvidence as unknown as Record<string, unknown>);
        await this.dependencies.repository.finishStage(run, 'preflight', 'completed', preflightEvidence as unknown as Record<string, unknown>);
      }
      if (run.status === 'pending') await this.dependencies.repository.transitionRun(run, 'running');

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
            await this.dependencies.repository.finishStage(run, stage, 'skipped', {
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
              await this.dependencies.repository.finishStage(run, stage, 'completed', {
                remainingCount: 0,
                recovery: 'reconciled_zero_row_postcondition'
              });
              continue;
            }
          }
          const operation = this.dependencies.duplicateCleanup ?? runDuplicateCleanup;
          const evidence = await operation(maintenanceContext, this.remainingStageMs(run, config.timeouts.duplicateCleanupSeconds));
          await this.dependencies.repository.finishStage(run, stage, 'completed', evidence as unknown as Record<string, unknown>);
          continue;
        }
        if (stage === 'backup') {
          if (disposition === 'reattach') {
            const startedAt = new Date(String(this.evidence(run, stage).startedAt));
            if (Number.isNaN(startedAt.getTime())) throw new Error('backup recovery is missing a trustworthy start time');
            const reconcile = this.dependencies.reconcileBackup ?? reconcileBackupAfterStart;
            const evidence = await reconcile(config.backupDirectory, startedAt);
            await this.dependencies.repository.finishStage(run, stage, 'completed', {
              ...evidence,
              recovery: 'reconciled_existing_archive'
            });
          } else {
            const operation = this.dependencies.verifiedBackup ?? runVerifiedBackup;
            const evidence = await operation(maintenanceContext, this.remainingStageMs(run, config.timeouts.backupSeconds));
            await this.dependencies.repository.finishStage(run, stage, 'completed', evidence as unknown as Record<string, unknown>);
          }
          continue;
        }
        if (disposition === 'reattach') throw new Error('old-article deletion requires explicit reconciliation before resume');
        const operation = this.dependencies.oldArticleDeletion ?? runOldArticleDeletion;
        const evidence = await operation(maintenanceContext, this.remainingStageMs(run, config.timeouts.deleteSeconds));
        await this.dependencies.repository.finishStage(run, stage, 'completed', evidence as unknown as Record<string, unknown>);
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
          onJobStarted: async (jobId) => this.dependencies.repository.updateRunningStageEvidence(run, 'google_rss', { jobId })
        });
        const classification = classifyRssEnding(options.mode, evidence.result.endingReason, targetArticlesAddedCount !== undefined);
        await this.dependencies.repository.finishStage(run, 'google_rss', 'completed', evidence as unknown as Record<string, unknown>);
        if (classification === 'rate_limited') return this.terminate(run, 'failure_rss_rate_limited', evidence.result.terminalMessage);
        if (classification === 'canceled') return this.terminate(run, 'canceled', evidence.result.terminalMessage);
        if (classification === 'failed') return this.terminate(run, 'failed', evidence.result.terminalMessage);
        const cohortArticleIds = await this.dependencies.repository.getCohortArticleIds(run.id);
        await run.update({ rssArticlesAddedCount: evidence.result.articlesAddedCount, cohortArticleCount: cohortArticleIds.length });
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
          onJobStarted: async (jobId) => this.dependencies.repository.updateRunningStageEvidence(run, 'semantic_scorer', { jobId })
        });
        await this.dependencies.repository.finishStage(run, 'semantic_scorer', 'completed', evidence as unknown as Record<string, unknown>);
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
          onJobStarted: async (jobId) => this.dependencies.repository.updateRunningStageEvidence(run, 'state_assigner', { jobId })
        });
        await this.dependencies.repository.finishStage(run, 'state_assigner', 'completed', evidence as unknown as Record<string, unknown>);
        if (evidence.result.circuitBreakerTripped) {
          return this.terminate(run, 'failure_state_assigner_circuit_breaker', evidence.result.terminalMessage);
        }
      }
      return run;
    } catch (error) {
      if (run.status === 'pending' || run.status === 'running') {
        const status: WeeklyArticleFlowStatus = error instanceof WorkerResultContractError
          ? 'failed_worker_result_contract'
          : error instanceof Error && /timed out|72-hour/i.test(error.message) ? 'timed_out' : 'failed';
        await this.dependencies.repository.transitionRun(run, status, error instanceof Error ? error.message : 'weekly flow failed');
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
