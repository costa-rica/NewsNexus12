import { Op } from "sequelize";

jest.mock("@newsnexus/db-models", () => ({
  Article: {
    destroy: jest.fn(),
  },
  sequelize: {
    query: jest.fn(),
  },
}));

jest.mock("../../src/config/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { Article, sequelize } from "@newsnexus/db-models";
import { logger } from "../../src/config/logger";
import {
  deleteRetiredSourcesArticles,
  getRetiredSourcesDeletionPreview,
  RetiredSourceName,
  RETIRED_SOURCE_NAMES,
} from "../../src/modules/deleteArticlesRetiredSources";

type MockCandidateRow = {
  articleId: number;
  title: string | null;
  publishedDate: string | null;
  sourceName: RetiredSourceName;
  isRelevantProtected: boolean;
  isApprovedProtected: boolean;
  isAiApprovedProtected: boolean;
  isReportLinkedProtected: boolean;
};

function sourceRows(names: RetiredSourceName[] = [...RETIRED_SOURCE_NAMES]) {
  return names.map((nameOfOrg) => ({ nameOfOrg }));
}

function candidateRow(
  overrides: Partial<MockCandidateRow> & { articleId: number },
): MockCandidateRow {
  return {
    articleId: overrides.articleId,
    title: overrides.title ?? `Article ${overrides.articleId}`,
    publishedDate: overrides.publishedDate ?? "2026-07-08",
    sourceName: overrides.sourceName ?? "NewsAPI",
    isRelevantProtected: overrides.isRelevantProtected ?? false,
    isApprovedProtected: overrides.isApprovedProtected ?? false,
    isAiApprovedProtected: overrides.isAiApprovedProtected ?? false,
    isReportLinkedProtected: overrides.isReportLinkedProtected ?? false,
  };
}

function mockPreviewRows(rows: MockCandidateRow[], names?: RetiredSourceName[]) {
  (sequelize.query as jest.Mock).mockResolvedValueOnce(sourceRows(names));
  (sequelize.query as jest.Mock).mockResolvedValueOnce(rows);
}

describe("deleteArticlesRetiredSources module", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (sequelize.query as jest.Mock).mockReset();
    (Article.destroy as jest.Mock).mockReset();
  });

  describe("getRetiredSourcesDeletionPreview()", () => {
    it("uses the required source-chain SQL shape", async () => {
      mockPreviewRows([]);

      await getRetiredSourcesDeletionPreview();

      const candidateSql = (sequelize.query as jest.Mock).mock.calls[1][0] as string;
      expect(candidateSql).toContain('FROM "Articles" a');
      expect(candidateSql).toContain('INNER JOIN "EntityWhoFoundArticles" ewfa');
      expect(candidateSql).toContain('ON ewfa."id" = a."entityWhoFoundArticleId"');
      expect(candidateSql).toContain('INNER JOIN "NewsArticleAggregatorSources" nas');
      expect(candidateSql).toContain(
        'ON nas."id" = ewfa."newsArticleAggregatorSourceId"',
      );
      expect(candidateSql).not.toContain("LEFT JOIN");
      expect(candidateSql).toContain(
        'nas."nameOfOrg" IN (\'NewsAPI\', \'GNews\', \'NewsData.IO\')',
      );
      expect(candidateSql).not.toContain("Google News RSS");
      expect(candidateSql).not.toContain("NewsApiRequests");
      expect(candidateSql).not.toContain("newsApiRequestId");
      expect(candidateSql).toContain('FROM "ArticleIsRelevants" air');
      expect(candidateSql).toContain('FROM "ArticleApproveds" aa');
      expect(candidateSql).toContain('FROM "ArticlesApproved02" aa2');
      expect(candidateSql).toContain('FROM "ArticleReportContracts" arc');
    });

    it("maps retired-source candidates from the query rows", async () => {
      mockPreviewRows([
        candidateRow({ articleId: 10, sourceName: "NewsAPI" }),
        candidateRow({ articleId: 11, sourceName: "GNews" }),
        candidateRow({ articleId: 12, sourceName: "NewsData.IO" }),
      ]);

      const preview = await getRetiredSourcesDeletionPreview();

      expect(preview.totalCandidates).toBe(3);
      expect(preview.eligible).toEqual([
        {
          articleId: 10,
          title: "Article 10",
          publishedDate: "2026-07-08",
          sourceName: "NewsAPI",
        },
        {
          articleId: 11,
          title: "Article 11",
          publishedDate: "2026-07-08",
          sourceName: "GNews",
        },
        {
          articleId: 12,
          title: "Article 12",
          publishedDate: "2026-07-08",
          sourceName: "NewsData.IO",
        },
      ]);
      expect(preview.sourceCounts).toEqual({
        NewsAPI: 1,
        GNews: 1,
        "NewsData.IO": 1,
      });
    });

    it("excludes protected candidates, including ArticlesApproved02 rows", async () => {
      mockPreviewRows([
        candidateRow({ articleId: 1, isRelevantProtected: true }),
        candidateRow({ articleId: 2, isApprovedProtected: true }),
        candidateRow({ articleId: 3, isAiApprovedProtected: true }),
        candidateRow({ articleId: 4, isReportLinkedProtected: true }),
        candidateRow({ articleId: 5 }),
      ]);

      const preview = await getRetiredSourcesDeletionPreview();

      expect(preview.excludedByProtection).toEqual({
        relevant: 1,
        approved: 1,
        aiApproved: 1,
        reportLinked: 1,
      });
      expect(preview.totalExcluded).toBe(4);
      expect(preview.eligible.map((row) => row.articleId)).toEqual([5]);
      expect(preview.sourceCounts.NewsAPI).toBe(1);
    });

    it("counts multiply protected candidates once under highest precedence", async () => {
      mockPreviewRows([
        candidateRow({
          articleId: 1,
          isRelevantProtected: true,
          isApprovedProtected: true,
          isAiApprovedProtected: true,
          isReportLinkedProtected: true,
        }),
        candidateRow({
          articleId: 2,
          isApprovedProtected: true,
          isReportLinkedProtected: true,
        }),
      ]);

      const preview = await getRetiredSourcesDeletionPreview();

      expect(preview.excludedByProtection).toEqual({
        relevant: 1,
        approved: 1,
        aiApproved: 0,
        reportLinked: 0,
      });
      expect(preview.totalExcluded).toBe(2);
      expect(preview.eligibleBeforeLimitCount).toBe(0);
    });

    it("reports missing source rows", async () => {
      mockPreviewRows(
        [
          candidateRow({ articleId: 1, sourceName: "NewsAPI" }),
          candidateRow({ articleId: 2, sourceName: "GNews" }),
        ],
        ["NewsAPI", "GNews"],
      );

      const preview = await getRetiredSourcesDeletionPreview();

      expect(preview.missingSources).toEqual(["NewsData.IO"]);
      expect(preview.sourceCounts).toEqual({
        NewsAPI: 1,
        GNews: 1,
        "NewsData.IO": 0,
      });
    });

    it("applies limit after protections and reports pre-limit counts", async () => {
      mockPreviewRows([
        candidateRow({ articleId: 1, sourceName: "NewsAPI" }),
        candidateRow({ articleId: 2, sourceName: "GNews" }),
        candidateRow({ articleId: 3, sourceName: "NewsData.IO" }),
      ]);

      const preview = await getRetiredSourcesDeletionPreview(2);

      expect(preview.appliedLimit).toBe(2);
      expect(preview.eligibleBeforeLimitCount).toBe(3);
      expect(preview.selectedForDeletionCount).toBe(2);
      expect(preview.eligible.map((row) => row.articleId)).toEqual([1, 2]);
      expect(preview.sourceCounts).toEqual({
        NewsAPI: 1,
        GNews: 1,
        "NewsData.IO": 1,
      });
    });

    it("preserves count invariants for unlimited and limited previews", async () => {
      const rows = [
        candidateRow({ articleId: 1, isRelevantProtected: true }),
        candidateRow({ articleId: 2, isApprovedProtected: true }),
        candidateRow({ articleId: 3, isAiApprovedProtected: true }),
        candidateRow({ articleId: 4, isReportLinkedProtected: true }),
        candidateRow({ articleId: 5 }),
        candidateRow({ articleId: 6 }),
      ];
      mockPreviewRows(rows);
      mockPreviewRows(rows);

      const unlimited = await getRetiredSourcesDeletionPreview();
      const limited = await getRetiredSourcesDeletionPreview(1);

      for (const preview of [unlimited, limited]) {
        const protectionSum =
          preview.excludedByProtection.relevant +
          preview.excludedByProtection.approved +
          preview.excludedByProtection.aiApproved +
          preview.excludedByProtection.reportLinked;
        const expectedSelected = Math.min(
          preview.appliedLimit ?? Number.POSITIVE_INFINITY,
          preview.eligibleBeforeLimitCount,
        );

        expect(preview.totalExcluded).toBe(protectionSum);
        expect(preview.totalCandidates).toBe(
          preview.totalExcluded + preview.eligibleBeforeLimitCount,
        );
        expect(preview.selectedForDeletionCount).toBe(preview.eligible.length);
        expect(preview.selectedForDeletionCount).toBe(expectedSelected);
      }
    });
  });

  describe("deleteRetiredSourcesArticles()", () => {
    it("does not delete during dry run and logs missing-source warnings", async () => {
      mockPreviewRows([candidateRow({ articleId: 1 })], ["NewsAPI", "GNews"]);

      const result = await deleteRetiredSourcesArticles({ dryRun: true });

      expect(result.deletedCount).toBe(0);
      expect(Article.destroy).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        'Retired source "NewsData.IO" was not found in NewsArticleAggregatorSources; it contributed zero candidates.',
      );
    });

    it("deletes exactly the preview eligible ids during execute", async () => {
      mockPreviewRows([
        candidateRow({ articleId: 1 }),
        candidateRow({ articleId: 2, isRelevantProtected: true }),
        candidateRow({ articleId: 3 }),
      ]);
      (Article.destroy as jest.Mock).mockResolvedValue(2);

      const result = await deleteRetiredSourcesArticles({ dryRun: false });

      expect(result.deletedCount).toBe(2);
      expect(Article.destroy).toHaveBeenCalledWith({
        where: { id: { [Op.in]: [1, 3] } },
      });
    });

    it("deletes eligible ids in 5000-id batches", async () => {
      const rows = Array.from({ length: 5001 }, (_, index) =>
        candidateRow({ articleId: index + 1 }),
      );
      mockPreviewRows(rows);
      (Article.destroy as jest.Mock).mockResolvedValue(5000);

      const result = await deleteRetiredSourcesArticles({ dryRun: false });

      expect(result.deletedCount).toBe(5001);
      expect(Article.destroy).toHaveBeenCalledTimes(2);
      expect(Article.destroy).toHaveBeenNthCalledWith(1, {
        where: {
          id: { [Op.in]: Array.from({ length: 5000 }, (_, index) => index + 1) },
        },
      });
      expect(Article.destroy).toHaveBeenNthCalledWith(2, {
        where: { id: { [Op.in]: [5001] } },
      });
    });
  });
});
