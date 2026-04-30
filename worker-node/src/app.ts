import express from 'express';
import healthRouter from './routes/health';
import queueInfoRouter from './routes/queueInfo';
import requestGoogleRssRouter from './routes/requestGoogleRss';
import semanticScorerRouter from './routes/semanticScorer';
import stateAssignerRouter from './routes/stateAssigner';
import articleContentScraper02Router from './routes/articleContentScraper02';
import deleteArticlesRouter from './routes/deleteArticles';
import orchestratorRouter from './routes/orchestrator';
import logger from './modules/logger';
import { errorHandler, notFoundHandler } from './modules/middleware/errorHandlers';
import { orchestratorLockMiddleware } from './modules/middleware/orchestratorLock';

export const createApp = (options: { skipOrchestratorLock?: boolean } = {}): express.Express => {
  const app = express();

  app.use((req, res, next) => {
    const startedAt = Date.now();

    res.on('finish', () => {
      logger.info('HTTP request completed', {
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
        requestId: req.headers['x-request-id'] ?? null
      });
    });

    next();
  });

  app.use(express.json());

  app.get('/', (_req, res) => {
    res.status(200).json({ service: 'worker-node', status: 'up' });
  });

  app.use('/health', healthRouter);
  app.use('/queue-info', queueInfoRouter);

  if (!options.skipOrchestratorLock) {
    app.use((req, res, next) => {
      if (req.path.endsWith('/start-job') && !req.originalUrl.startsWith('/orchestrator')) {
        return orchestratorLockMiddleware(req, res, next);
      }
      return next();
    });
  }

  app.use('/request-google-rss', requestGoogleRssRouter);
  app.use('/semantic-scorer', semanticScorerRouter);
  app.use('/state-assigner', stateAssignerRouter);
  app.use('/article-content-scraper-02', articleContentScraper02Router);
  app.use('/delete-articles', deleteArticlesRouter);
  app.use('/orchestrator', orchestratorRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

export default createApp({});
