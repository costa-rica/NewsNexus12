export const ARTICLE_CONTENT_02_GOOGLE_NAVIGATION_TIMEOUT_MS = 30_000;
export const ARTICLE_CONTENT_02_GOOGLE_POST_LOAD_WAIT_MS = 5_000;
export const ARTICLE_CONTENT_02_GOOGLE_NAVIGATION_RETRY_COUNT = 2;
export const ARTICLE_CONTENT_02_PUBLISHER_NAVIGATION_TIMEOUT_MS = 20_000;
export const ARTICLE_CONTENT_02_PUBLISHER_POST_LOAD_WAIT_MS = 2_500;
export const ARTICLE_CONTENT_02_PUBLISHER_FETCH_RETRY_COUNT = 2;
export const ARTICLE_CONTENT_02_PUBLISHER_MIN_HTML_LENGTH = 500;

export const ARTICLE_CONTENT_02_DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/136.0.0.0 Safari/537.36';

export const ARTICLE_CONTENT_02_DEFAULT_HEADERS = {
  'Accept-Language': 'en-US,en;q=0.9',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,' +
    'image/apng,*/*;q=0.8'
} as const;

export const ARTICLE_CONTENT_02_GOOGLE_BLOCKED_PATTERNS = [
  'consent.google.com',
  'before you continue to google',
  'to continue, please click',
  'personalized content',
  'consent bump',
  'privacy & terms',
  'gws-output-pages-elements-consent-bump-v2',
  'access to this page has been denied',
  'px-captcha',
  'press & hold to confirm you are',
  'human verification challenge',
  'captcha.px-cloud.net'
] as const;

export const ARTICLE_CONTENT_02_GOOGLE_HOST_PATTERNS = new Set([
  'google.com',
  'www.google.com',
  'news.google.com',
  'consent.google.com',
  'instructions.humandemo.zone'
]);
