import { ARTICLE_CONTENT_02_GOOGLE_BLOCKED_PATTERNS } from './config';
import { ArticleContent02FailureType } from './types';

export interface PublisherPageClassification {
  isBlocked: boolean;
  failureType: ArticleContent02FailureType | null;
  details: string;
}

export const classifyPublisherPage = ({
  finalUrl,
  html
}: {
  finalUrl: string | null;
  html: string;
}): PublisherPageClassification => {
  const bodyLower = html.toLowerCase();
  const finalUrlLower = String(finalUrl ?? '').toLowerCase();

  for (const pattern of ARTICLE_CONTENT_02_GOOGLE_BLOCKED_PATTERNS) {
    if (bodyLower.includes(pattern) || finalUrlLower.includes(pattern)) {
      return {
        isBlocked: true,
        failureType: 'blocked_publisher',
        details: `Matched blocked publisher pattern: ${pattern}`
      };
    }
  }

  const challengeIndicators = [
    'access to this page has been denied',
    'press & hold to confirm you are',
    'before we continue...',
    'human verification challenge',
    'please check your network connection or disable your ad-blocker',
    'reference id'
  ];

  const matchedChallengeIndicators = challengeIndicators.filter((pattern) =>
    bodyLower.includes(pattern)
  );

  if (matchedChallengeIndicators.length >= 2) {
    return {
      isBlocked: true,
      failureType: 'blocked_publisher',
      details: `Publisher returned anti-bot challenge content: ${matchedChallengeIndicators[0]}`
    };
  }

  return {
    isBlocked: false,
    failureType: null,
    details: 'Publisher response body looks usable'
  };
};

export default classifyPublisherPage;
