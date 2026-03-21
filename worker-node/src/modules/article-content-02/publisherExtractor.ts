import {
  ArticleContent02ExtractionSource,
  ArticleContent02FailureType
} from './types';
import { ARTICLE_CONTENT_02_GOOGLE_HOST_PATTERNS } from './config';

export interface PublisherUrlExtractionResult {
  publisherUrl: string | null;
  extractionSource: ArticleContent02ExtractionSource;
  failureType: ArticleContent02FailureType | null;
  details: string;
}

const safeUrl = (value: string, baseUrl?: string): URL | null => {
  try {
    return baseUrl ? new URL(value, baseUrl) : new URL(value);
  } catch {
    return null;
  }
};

const isGoogleOwned = (urlString: string): boolean => {
  const url = safeUrl(urlString);
  if (!url) {
    return true;
  }

  const hostname = url.hostname.toLowerCase();
  if (ARTICLE_CONTENT_02_GOOGLE_HOST_PATTERNS.has(hostname)) {
    return true;
  }

  return hostname.endsWith('.google.com');
};

const normalizeCandidate = (urlValue: string, baseUrl?: string): string | null => {
  const parsed = safeUrl(urlValue, baseUrl);
  if (!parsed) {
    return null;
  }

  if (!/^https?:$/.test(parsed.protocol)) {
    return null;
  }

  return parsed.toString();
};

const firstMatch = (pattern: RegExp, html: string): string | null => {
  const match = pattern.exec(html);
  return match?.[1] ?? null;
};

function* extractJsonLdUrls(html: string): Generator<string> {
  const scriptPattern =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = scriptPattern.exec(html)) !== null) {
    const rawJson = match[1]?.trim();
    if (!rawJson) {
      continue;
    }

    try {
      const parsed = JSON.parse(rawJson) as unknown;
      const queue: unknown[] = Array.isArray(parsed) ? [...parsed] : [parsed];

      while (queue.length > 0) {
        const item = queue.shift();
        if (!item || typeof item !== 'object') {
          continue;
        }

        const record = item as Record<string, unknown>;

        if (typeof record.url === 'string') {
          yield record.url;
        }

        if (typeof record.mainEntityOfPage === 'string') {
          yield record.mainEntityOfPage;
        }

        if (record.mainEntityOfPage && typeof record.mainEntityOfPage === 'object') {
          const mainEntity = record.mainEntityOfPage as Record<string, unknown>;

          if (typeof mainEntity['@id'] === 'string') {
            yield mainEntity['@id'];
          }

          if (typeof mainEntity.url === 'string') {
            yield mainEntity.url;
          }
        }

        for (const value of Object.values(record)) {
          if (value && typeof value === 'object') {
            queue.push(value);
          }
        }
      }
    } catch {
      continue;
    }
  }
}

function* extractVisibleLinks(html: string): Generator<string> {
  const anchorPattern = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchorPattern.exec(html)) !== null) {
    if (match[1]) {
      yield match[1];
    }
  }
}

export const extractPublisherUrlFromFinalUrl = (
  finalUrl: string | null
): PublisherUrlExtractionResult => {
  const normalizedUrl = finalUrl ? normalizeCandidate(finalUrl) : null;
  if (!normalizedUrl || isGoogleOwned(normalizedUrl)) {
    return {
      publisherUrl: null,
      extractionSource: 'none',
      failureType: 'no_publisher_url_found',
      details: 'Final browser URL was missing or remained Google-owned'
    };
  }

  return {
    publisherUrl: normalizedUrl,
    extractionSource: 'final-url',
    failureType: null,
    details: 'Publisher URL extracted from final browser URL'
  };
};

export const extractPublisherUrl = ({
  html,
  baseUrl
}: {
  html: string;
  baseUrl: string;
}): PublisherUrlExtractionResult => {
  const candidates: Array<{
    source: ArticleContent02ExtractionSource;
    value: string | null;
  }> = [
    {
      source: 'canonical',
      value: firstMatch(
        /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i,
        html
      )
    },
    {
      source: 'og:url',
      value: firstMatch(
        /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["'][^>]*>/i,
        html
      )
    }
  ];

  for (const value of extractJsonLdUrls(html)) {
    candidates.push({ source: 'json-ld', value });
  }

  for (const value of extractVisibleLinks(html)) {
    candidates.push({ source: 'fallback-link', value });
  }

  for (const candidate of candidates) {
    if (!candidate.value) {
      continue;
    }

    const normalizedUrl = normalizeCandidate(candidate.value, baseUrl);
    if (!normalizedUrl) {
      continue;
    }

    if (isGoogleOwned(normalizedUrl)) {
      continue;
    }

    return {
      publisherUrl: normalizedUrl,
      extractionSource: candidate.source,
      failureType: null,
      details: `Publisher URL extracted from ${candidate.source}`
    };
  }

  return {
    publisherUrl: null,
    extractionSource: 'none',
    failureType: 'no_publisher_url_found',
    details: 'No non-Google publisher URL found in Google page metadata'
  };
};

export default {
  extractPublisherUrl,
  extractPublisherUrlFromFinalUrl
};
