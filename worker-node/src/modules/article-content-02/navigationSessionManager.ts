import logger from '../logger';
import {
  ARTICLE_CONTENT_02_BROWSER_RECYCLE_ATTEMPTS,
  ARTICLE_CONTENT_02_BROWSER_RECYCLE_NAVIGATION_ERRORS
} from './config';
import {
  createGoogleNavigationSession,
  GoogleNavigationSession
} from './googleNavigator';
import { ArticleContent02WorkflowResult } from './types';

export interface GoogleNavigationSessionManagerOptions {
  createNavigationSession?: typeof createGoogleNavigationSession;
  recycleAfterAttempts?: number;
  recycleAfterNavigationErrors?: number;
  logContext?: Record<string, unknown>;
}

export interface GoogleNavigationSessionManager {
  getSession: () => Promise<GoogleNavigationSession>;
  recordResult: (result: ArticleContent02WorkflowResult | null) => Promise<void>;
  close: () => Promise<void>;
}

export const createGoogleNavigationSessionManager = (
  options: GoogleNavigationSessionManagerOptions = {}
): GoogleNavigationSessionManager => {
  const createNavigationSession =
    options.createNavigationSession ?? createGoogleNavigationSession;
  const recycleAfterAttempts =
    options.recycleAfterAttempts ?? ARTICLE_CONTENT_02_BROWSER_RECYCLE_ATTEMPTS;
  const recycleAfterNavigationErrors =
    options.recycleAfterNavigationErrors ??
    ARTICLE_CONTENT_02_BROWSER_RECYCLE_NAVIGATION_ERRORS;

  let session: GoogleNavigationSession | null = null;
  let attemptsSinceRecycle = 0;
  let consecutiveNavigationErrors = 0;

  const closeCurrentSession = async (reason: string): Promise<void> => {
    if (!session) {
      return;
    }

    logger.info('Recycling ArticleContent02 Chromium session', {
      reason,
      attemptsSinceRecycle,
      consecutiveNavigationErrors,
      recycleAfterAttempts,
      recycleAfterNavigationErrors,
      ...options.logContext
    });

    const sessionToClose = session;
    session = null;
    attemptsSinceRecycle = 0;
    consecutiveNavigationErrors = 0;
    await sessionToClose.close();
  };

  return {
    getSession: async () => {
      if (!session) {
        session = await createNavigationSession();
      }

      return session;
    },
    recordResult: async (result) => {
      if (!result) {
        return;
      }

      attemptsSinceRecycle += 1;

      if (result.failureType === 'navigation_error') {
        consecutiveNavigationErrors += 1;
      } else {
        consecutiveNavigationErrors = 0;
      }

      if (consecutiveNavigationErrors >= recycleAfterNavigationErrors) {
        await closeCurrentSession('consecutive_navigation_errors');
        return;
      }

      if (attemptsSinceRecycle >= recycleAfterAttempts) {
        await closeCurrentSession('attempt_limit');
      }
    },
    close: async () => {
      await closeCurrentSession('manager_close');
    }
  };
};
