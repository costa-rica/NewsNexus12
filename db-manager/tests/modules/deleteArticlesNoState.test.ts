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
import {
  deleteNoStateArticles,
  getNoStateDeletionPreview,
  NoStateReasonCode,
} from "../../src/modules/deleteArticlesNoState";

type MockCandidateRow = {
  articleId: number;
  title: string | null;
  publishedDate: string | null;
  latestAssignmentId: number;
  reasonCode: NoStateReasonCode;
  isRelevantProtected: boolean;
  isApprovedProtected: boolean;
  isAiApprovedProtected: boolean;
  isReportLinkedProtected: boolean;
};

function candidateRow(
  overrides: Partial<MockCandidateRow> & { articleId: number },
): MockCandidateRow {
  return {
    articleId: overrides.articleId,
    title: overrides.title ?? `Article ${overrides.articleId}`,
    publishedDate: overrides.publishedDate ?? "2026-07-08",
    latestAssignmentId: overrides.latestAssignmentId ?? overrides.articleId + 1000,
    reasonCode: overrides.reasonCode ?? "null_state_id",
    isRelevantProtected: overrides.isRelevantProtected ?? false,
    isApprovedProtected: overrides.isApprovedProtected ?? false,
    isAiApprovedProtected: overrides.isAiApprovedProtected ?? false,
    isReportLinkedProtected: overrides.isReportLinkedProtected ?? false,
  };
}

describe("deleteArticlesNoState module", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (sequelize.query as jest.Mock).mockReset();
    (Article.destroy as jest.Mock).mockReset();
  });

  describe("getNoStateDeletionPreview()", () => {
    it("does not select articles with no ArticleStateContracts02 row", async () => {
      (sequelize.query as jest.Mock).mockResolvedValue([]);

      const preview = await getNoStateDeletionPreview();

      expect(preview.totalCandidates).toBe(0);
      expect(preview.eligibleBeforeLimitCount).toBe(0);
      expect(preview.eligible).toEqual([]);
    });

    it("selects an article whose latest assignment has stateId = NULL", async () => {
      (sequelize.query as jest.Mock).mockResolvedValue([
        candidateRow({ articleId: 10, reasonCode: "null_state_id" }),
      ]);

      const preview = await getNoStateDeletionPreview();

      expect(preview.eligible).toEqual([
        {
          articleId: 10,
          title: "Article 10",
          publishedDate: "2026-07-08",
          latestAssignmentId: 1010,
          reasonCode: "null_state_id",
        },
      ]);
      expect(preview.reasonCodeCounts.null_state_id).toBe(1);
      expect(preview.reasonCodeCounts.missing_state_join).toBe(0);
    });

    it("does not select an article whose latest assignment joins a valid state", async () => {
      (sequelize.query as jest.Mock).mockResolvedValue([]);

      const preview = await getNoStateDeletionPreview();

      expect(preview.totalCandidates).toBe(0);
      expect(preview.selectedForDeletionCount).toBe(0);
    });

    it("does not select an article with an older null assignment but latest valid assignment", async () => {
      (sequelize.query as jest.Mock).mockResolvedValue([]);

      const preview = await getNoStateDeletionPreview();

      expect(preview.totalCandidates).toBe(0);
      expect(preview.eligible).toEqual([]);
    });

    it("selects an article whose latest assignment points at a missing States row", async () => {
      (sequelize.query as jest.Mock).mockResolvedValue([
        candidateRow({ articleId: 11, reasonCode: "missing_state_join" }),
      ]);

      const preview = await getNoStateDeletionPreview();

      expect(preview.eligible).toHaveLength(1);
      expect(preview.eligible[0].reasonCode).toBe("missing_state_join");
      expect(preview.reasonCodeCounts.missing_state_join).toBe(1);
    });

    it("uses a latest-assignment SQL query that excludes valid current assignments", async () => {
      (sequelize.query as jest.Mock).mockResolvedValue([]);

      await getNoStateDeletionPreview();

      const sql = (sequelize.query as jest.Mock).mock.calls[0][0] as string;
      expect(sql).toContain('MAX("id") AS "latestAssignmentId"');
      expect(sql).toContain('GROUP BY "articleId"');
      expect(sql).toContain('WHERE latest."stateId" IS NULL OR st."id" IS NULL');
    });

    it("applies limit after protections and reports pre-limit counts", async () => {
      (sequelize.query as jest.Mock).mockResolvedValue([
        candidateRow({ articleId: 1, reasonCode: "null_state_id" }),
        candidateRow({ articleId: 2, reasonCode: "missing_state_join" }),
        candidateRow({ articleId: 3, reasonCode: "null_state_id" }),
      ]);

      const preview = await getNoStateDeletionPreview(2);

      expect(preview.appliedLimit).toBe(2);
      expect(preview.eligibleBeforeLimitCount).toBe(3);
      expect(preview.selectedForDeletionCount).toBe(2);
      expect(preview.eligible.map((row) => row.articleId)).toEqual([1, 2]);
      expect(preview.reasonCodeCounts).toEqual({
        null_state_id: 2,
        missing_state_join: 1,
      });
    });

    it("excludes protected candidates, including ArticlesApproved02 rows", async () => {
      (sequelize.query as jest.Mock).mockResolvedValue([
        candidateRow({ articleId: 1, isRelevantProtected: true }),
        candidateRow({ articleId: 2, isApprovedProtected: true }),
        candidateRow({ articleId: 3, isAiApprovedProtected: true }),
        candidateRow({ articleId: 4, isReportLinkedProtected: true }),
        candidateRow({ articleId: 5 }),
      ]);

      const preview = await getNoStateDeletionPreview();

      expect(preview.excludedByProtection).toEqual({
        relevant: 1,
        approved: 1,
        aiApproved: 1,
        reportLinked: 1,
      });
      expect(preview.totalExcluded).toBe(4);
      expect(preview.eligible.map((row) => row.articleId)).toEqual([5]);
    });

    it("counts multiply protected candidates once under highest precedence", async () => {
      (sequelize.query as jest.Mock).mockResolvedValue([
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

      const preview = await getNoStateDeletionPreview();

      expect(preview.excludedByProtection).toEqual({
        relevant: 1,
        approved: 1,
        aiApproved: 0,
        reportLinked: 0,
      });
      expect(preview.totalExcluded).toBe(2);
      expect(preview.eligibleBeforeLimitCount).toBe(0);
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
      (sequelize.query as jest.Mock).mockResolvedValueOnce(rows);
      (sequelize.query as jest.Mock).mockResolvedValueOnce(rows);

      const unlimited = await getNoStateDeletionPreview();
      const limited = await getNoStateDeletionPreview(1);

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

  describe("deleteNoStateArticles()", () => {
    it("does not delete during dry run", async () => {
      (sequelize.query as jest.Mock).mockResolvedValue([
        candidateRow({ articleId: 1 }),
      ]);

      const result = await deleteNoStateArticles({ dryRun: true });

      expect(result.deletedCount).toBe(0);
      expect(Article.destroy).not.toHaveBeenCalled();
    });

    it("deletes exactly the preview eligible ids during execute", async () => {
      (sequelize.query as jest.Mock).mockResolvedValue([
        candidateRow({ articleId: 1 }),
        candidateRow({ articleId: 2, isRelevantProtected: true }),
        candidateRow({ articleId: 3 }),
      ]);
      (Article.destroy as jest.Mock).mockResolvedValue(2);

      const result = await deleteNoStateArticles({ dryRun: false });

      expect(result.deletedCount).toBe(2);
      expect(Article.destroy).toHaveBeenCalledWith({
        where: { id: { [Op.in]: [1, 3] } },
      });
    });
  });
});
