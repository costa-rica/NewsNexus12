import { parseStringPromise } from "xml2js";
import logger from "../logger";
import {
  normalizeExternalError,
  normalizeExternalJsonResponse,
} from "./responseNormalizers";

export type RssItem = {
  title?: string;
  description: string;
  link?: string;
  pubDate?: string;
  source?: string;
  content?: string;
};

export type FetchRssItemsResult =
  | { status: "success"; items: RssItem[] }
  | { status: "error"; items: RssItem[]; error: string; statusCode?: number };

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, "").trim();
}

function extractAnchorText(input: string): string | null {
  const match = input.match(/<a[^>]*>(.*?)<\/a>/i);
  return match?.[1]?.trim() || null;
}

function mapItems(items: any[]): RssItem[] {
  return items.map((item) => {
    const descriptionRaw = item.description?.[0] || "";
    const anchorText = extractAnchorText(descriptionRaw);
    const description =
      anchorText || stripHtml(descriptionRaw) || descriptionRaw;

    return {
      title: item.title?.[0],
      description,
      link: item.link?.[0],
      pubDate: item.pubDate?.[0],
      source: item.source?.[0]?._ || item.source?.[0],
      content: item["content:encoded"]?.[0],
    };
  });
}

export async function fetchRssItems(url: string): Promise<FetchRssItemsResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "NewsNexus12API/1.0",
      },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const normalizedFailure = normalizeExternalJsonResponse(
        response.status,
        "",
      );
      const errorMessage =
        normalizedFailure.error ||
        `RSS request failed with status ${response.status}`;
      logger.error(errorMessage);
      return {
        status: "error",
        items: [],
        error: errorMessage,
        statusCode: response.status,
      };
    }

    const xml = await response.text();
    const normalized = normalizeExternalJsonResponse(response.status, xml);

    const parsed = await parseStringPromise(normalized.payload || "", {
      explicitArray: true,
    });
    const items = parsed?.rss?.channel?.[0]?.item || [];

    if (!items || items.length === 0) {
      return { status: "success", items: [] };
    }

    return { status: "success", items: mapItems(items) };
  } catch (error) {
    const normalizedError = normalizeExternalError<RssItem>(
      error,
      "Unknown RSS fetch error",
    );
    logger.error(`RSS request error: ${normalizedError.error}`);
    return normalizedError;
  }
}
