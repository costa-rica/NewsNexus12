import { ARTICLE_CONTENT_02_GOOGLE_BLOCKED_PATTERNS } from './config';
import { ArticleContent02FailureType } from './types';

export interface GooglePageClassification {
  isBlocked: boolean;
  failureType: ArticleContent02FailureType | null;
  details: string;
}

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

export const classifyGooglePage = ({
  finalUrl,
  html
}: {
  finalUrl: string | null;
  html: string;
}): GooglePageClassification => {
  const bodyLower = html.toLowerCase();
  const finalUrlLower = String(finalUrl ?? '').toLowerCase();

  for (const pattern of ARTICLE_CONTENT_02_GOOGLE_BLOCKED_PATTERNS) {
    if (bodyLower.includes(pattern) || finalUrlLower.includes(pattern)) {
      return {
        isBlocked: true,
        failureType: 'blocked_google',
        details: `Matched blocked pattern: ${pattern}`
      };
    }
  }

  const normalized = normalizeWhitespace(bodyLower);
  if (
    normalized.includes('google news') &&
    normalized.includes('stories for you') &&
    !normalized.includes('og:url')
  ) {
    return {
      isBlocked: true,
      failureType: 'blocked_google',
      details: 'Returned Google shell content without usable publisher metadata'
    };
  }

  return {
    isBlocked: false,
    failureType: null,
    details: 'No blocked-page patterns detected'
  };
};

export default classifyGooglePage;
