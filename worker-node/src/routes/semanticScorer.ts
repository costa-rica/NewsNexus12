import { Router } from 'express';
import { AppError } from '../modules/errors/appError';
import { QueueJobHandler } from '../modules/queue/queueEngine';
import {
  createSemanticScorerJobHandler,
  verifyKeywordsWorkbookExists,
  verifySemanticScorerDirectoryExists,
  SemanticScorerTargeting
} from '../modules/jobs/semanticScorerJob';
import { globalQueueEngine } from '../modules/queue/globalQueue';
import { GlobalQueueEngine } from '../modules/queue/queueEngine';

interface SemanticScorerRouteDependencies {
  queueEngine: GlobalQueueEngine;
  env: NodeJS.ProcessEnv;
  buildJobHandler: (semanticScorerDir: string, targeting?: SemanticScorerTargeting) => QueueJobHandler;
}

const parseOptionalPositiveInt = (value: unknown): number | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  return undefined;
};

const resolveSemanticScorerDirFromEnv = (env: NodeJS.ProcessEnv): string => {
  const value = env.PATH_TO_SEMANTIC_SCORER_DIR;
  if (!value || value.trim() === '') {
    throw AppError.validation([
      {
        field: 'PATH_TO_SEMANTIC_SCORER_DIR',
        message: 'PATH_TO_SEMANTIC_SCORER_DIR env var is required'
      }
    ]);
  }

  return value.trim();
};

export const createSemanticScorerRouter = (
  dependencies: SemanticScorerRouteDependencies = {
    queueEngine: globalQueueEngine,
    env: process.env,
    buildJobHandler: (dir, targeting) => createSemanticScorerJobHandler(dir, targeting)
  }
): Router => {
  const router = Router();
  const { queueEngine, env, buildJobHandler } = dependencies;

  router.post('/start-job', async (req, res, next) => {
    try {
      const endpointName = '/semantic-scorer/start-job';
      const semanticScorerDir = resolveSemanticScorerDirFromEnv(env);
      await verifySemanticScorerDirectoryExists(semanticScorerDir);
      await verifyKeywordsWorkbookExists(semanticScorerDir);

      const body = (req.body ?? {}) as Record<string, unknown>;
      const targeting: SemanticScorerTargeting = {
        articleIdMinExclusive: parseOptionalPositiveInt(body.articleIdMinExclusive),
        articleIdMaxInclusive: parseOptionalPositiveInt(body.articleIdMaxInclusive)
      };

      const enqueueResult = await queueEngine.enqueueJob({
        endpointName,
        run: buildJobHandler(semanticScorerDir, targeting)
      });

      return res.status(202).json({
        jobId: enqueueResult.jobId,
        status: enqueueResult.status,
        endpointName
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return next(
          new AppError({
            status: 404,
            code: 'NOT_FOUND',
            message: error.message
          })
        );
      }

      return next(error);
    }
  });

  return router;
};

export default createSemanticScorerRouter();
