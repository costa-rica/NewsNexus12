import { Op } from "sequelize";

// Mock @newsnexus/db-models before importing the module under test
jest.mock("@newsnexus/db-models", () => ({
  Article: {
    count: jest.fn(),
    findAll: jest.fn(),
    destroy: jest.fn(),
  },
  ArticleApproved: {
    findAll: jest.fn(),
  },
  ArticleIsRelevant: {
    findAll: jest.fn(),
  },
}));

// Mock logger
jest.mock("../../src/config/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import {
  Article,
  ArticleApproved,
  ArticleIsRelevant,
} from "@newsnexus/db-models";
import { logger } from "../../src/config/logger";
import {
  deleteOldUnapprovedArticles,
  deleteOldestEligibleArticles,
} from "../../src/modules/deleteArticles";

describe("Delete articles module", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mock implementations to prevent bleed between tests
    (Article.count as jest.Mock).mockReset();
    (Article.findAll as jest.Mock).mockReset();
    (Article.destroy as jest.Mock).mockReset();
    (ArticleApproved.findAll as jest.Mock).mockReset();
    (ArticleIsRelevant.findAll as jest.Mock).mockReset();
  });

  describe("deleteOldUnapprovedArticles()", () => {
    it("returns { deletedCount: 0 } when no articles match the cutoff", async () => {
      (ArticleIsRelevant.findAll as jest.Mock).mockResolvedValue([]);
      (ArticleApproved.findAll as jest.Mock).mockResolvedValue([]);
      (Article.count as jest.Mock).mockResolvedValue(0);

      const result = await deleteOldUnapprovedArticles(180);

      expect(result.deletedCount).toBe(0);
      expect(result.cutoffDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Article.destroy).not.toHaveBeenCalled();
    });

    it("deletes articles older than the cutoff that are not in approved or relevant tables", async () => {
      (ArticleIsRelevant.findAll as jest.Mock).mockResolvedValue([]);
      (ArticleApproved.findAll as jest.Mock).mockResolvedValue([]);
      (Article.count as jest.Mock).mockResolvedValue(10);
      (Article.findAll as jest.Mock)
        .mockResolvedValueOnce([
          { id: 1 },
          { id: 2 },
          { id: 3 },
          { id: 4 },
          { id: 5 },
          { id: 6 },
          { id: 7 },
          { id: 8 },
          { id: 9 },
          { id: 10 },
        ])
        .mockResolvedValueOnce([]); // No more articles
      (Article.destroy as jest.Mock).mockResolvedValue(10);

      const result = await deleteOldUnapprovedArticles(180);

      expect(result.deletedCount).toBe(10);
      expect(Article.destroy).toHaveBeenCalledTimes(1);
      expect(Article.destroy).toHaveBeenCalledWith({
        where: { id: { [Op.in]: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] } },
      });
    });

    it("protects articles that appear in ArticleApproved", async () => {
      (ArticleIsRelevant.findAll as jest.Mock).mockResolvedValue([]);
      (ArticleApproved.findAll as jest.Mock).mockResolvedValue([
        { articleId: 5 },
        { articleId: 6 },
      ]);
      (Article.count as jest.Mock).mockResolvedValue(8);
      (Article.findAll as jest.Mock)
        .mockResolvedValueOnce([
          { id: 1 },
          { id: 2 },
          { id: 3 },
          { id: 4 },
          { id: 7 },
          { id: 8 },
          { id: 9 },
          { id: 10 },
        ])
        .mockResolvedValueOnce([]); // No more articles
      (Article.destroy as jest.Mock).mockResolvedValue(8);

      const result = await deleteOldUnapprovedArticles(180);

      expect(result.deletedCount).toBe(8);
      // Verify that Article.count was called with protected IDs excluded
      const countCall = (Article.count as jest.Mock).mock.calls[0];
      const whereClause = countCall[0].where[Op.and];
      expect(whereClause).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: { [Op.notIn]: expect.arrayContaining([5, 6]) },
          }),
        ]),
      );
    });

    it("protects articles that appear in ArticleIsRelevant", async () => {
      (ArticleIsRelevant.findAll as jest.Mock).mockResolvedValue([
        { articleId: 3 },
        { articleId: 4 },
      ]);
      (ArticleApproved.findAll as jest.Mock).mockResolvedValue([]);
      (Article.count as jest.Mock).mockResolvedValue(8);
      (Article.findAll as jest.Mock)
        .mockResolvedValueOnce([
          { id: 1 },
          { id: 2 },
          { id: 5 },
          { id: 6 },
          { id: 7 },
          { id: 8 },
          { id: 9 },
          { id: 10 },
        ])
        .mockResolvedValueOnce([]); // No more articles
      (Article.destroy as jest.Mock).mockResolvedValue(8);

      const result = await deleteOldUnapprovedArticles(180);

      expect(result.deletedCount).toBe(8);
      // Verify that Article.count was called with protected IDs excluded
      const countCall = (Article.count as jest.Mock).mock.calls[0];
      const whereClause = countCall[0].where[Op.and];
      expect(whereClause).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: { [Op.notIn]: expect.arrayContaining([3, 4]) },
          }),
        ]),
      );
    });

    it("returns a cutoffDate in YYYY-MM-DD format", async () => {
      (ArticleIsRelevant.findAll as jest.Mock).mockResolvedValue([]);
      (ArticleApproved.findAll as jest.Mock).mockResolvedValue([]);
      (Article.count as jest.Mock).mockResolvedValue(0);

      const result = await deleteOldUnapprovedArticles(180);

      expect(result.cutoffDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      // Verify it's a valid date
      const parsedDate = new Date(result.cutoffDate);
      expect(parsedDate).toBeInstanceOf(Date);
      expect(isNaN(parsedDate.getTime())).toBe(false);
    });

    it("processes articles in batches (verify Article.destroy is called with batched IDs)", async () => {
      (ArticleIsRelevant.findAll as jest.Mock).mockResolvedValue([]);
      (ArticleApproved.findAll as jest.Mock).mockResolvedValue([]);
      (Article.count as jest.Mock).mockResolvedValue(15);

      // First batch of 10
      (Article.findAll as jest.Mock)
        .mockResolvedValueOnce([
          { id: 1 },
          { id: 2 },
          { id: 3 },
          { id: 4 },
          { id: 5 },
          { id: 6 },
          { id: 7 },
          { id: 8 },
          { id: 9 },
          { id: 10 },
        ])
        // Second batch of 5
        .mockResolvedValueOnce([
          { id: 11 },
          { id: 12 },
          { id: 13 },
          { id: 14 },
          { id: 15 },
        ])
        // No more batches
        .mockResolvedValueOnce([]);

      (Article.destroy as jest.Mock).mockResolvedValue(null);

      const result = await deleteOldUnapprovedArticles(180);

      expect(result.deletedCount).toBe(15);
      expect(Article.destroy).toHaveBeenCalledTimes(2);
      expect(Article.destroy).toHaveBeenNthCalledWith(1, {
        where: { id: { [Op.in]: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] } },
      });
      expect(Article.destroy).toHaveBeenNthCalledWith(2, {
        where: { id: { [Op.in]: [11, 12, 13, 14, 15] } },
      });
    });

    it("logs progress during deletion", async () => {
      (ArticleIsRelevant.findAll as jest.Mock).mockResolvedValue([]);
      (ArticleApproved.findAll as jest.Mock).mockResolvedValue([]);
      (Article.count as jest.Mock).mockResolvedValue(5);
      (Article.findAll as jest.Mock)
        .mockResolvedValueOnce([
          { id: 1 },
          { id: 2 },
          { id: 3 },
          { id: 4 },
          { id: 5 },
        ])
        .mockResolvedValueOnce([]); // No more articles in next batch
      (Article.destroy as jest.Mock).mockResolvedValue(5);

      await deleteOldUnapprovedArticles(180);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Found 5 articles eligible for deletion"),
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Deleted 5 of 5 articles"),
      );
    });
  });

  describe("deleteOldestEligibleArticles()", () => {
    it("returns { deletedCount: 0 } when no eligible articles exist", async () => {
      (ArticleIsRelevant.findAll as jest.Mock).mockResolvedValue([]);
      (ArticleApproved.findAll as jest.Mock).mockResolvedValue([]);
      (Article.findAll as jest.Mock).mockResolvedValue([]);

      const result = await deleteOldestEligibleArticles(10);

      expect(result.requestedCount).toBe(10);
      expect(result.foundCount).toBe(0);
      expect(result.deletedCount).toBe(0);
      expect(Article.destroy).not.toHaveBeenCalled();
    });

    it("deletes the requested number of oldest eligible articles", async () => {
      (ArticleIsRelevant.findAll as jest.Mock).mockResolvedValue([]);
      (ArticleApproved.findAll as jest.Mock).mockResolvedValue([]);
      (Article.findAll as jest.Mock).mockResolvedValue([
        { id: 1 },
        { id: 2 },
        { id: 3 },
        { id: 4 },
        { id: 5 },
      ]);
      (Article.destroy as jest.Mock).mockResolvedValue(5);

      const result = await deleteOldestEligibleArticles(5);

      expect(result.requestedCount).toBe(5);
      expect(result.foundCount).toBe(5);
      expect(result.deletedCount).toBe(5);
      expect(Article.destroy).toHaveBeenCalledWith({
        where: { id: { [Op.in]: [1, 2, 3, 4, 5] } },
      });
    });

    it("protects articles in ArticleApproved and ArticleIsRelevant", async () => {
      (ArticleIsRelevant.findAll as jest.Mock).mockResolvedValue([
        { articleId: 1 },
      ]);
      (ArticleApproved.findAll as jest.Mock).mockResolvedValue([
        { articleId: 2 },
      ]);
      (Article.findAll as jest.Mock).mockResolvedValue([
        { id: 3 },
        { id: 4 },
        { id: 5 },
      ]);
      (Article.destroy as jest.Mock).mockResolvedValue(3);

      const result = await deleteOldestEligibleArticles(5);

      // Verify that Article.findAll was called with protected IDs excluded
      const findAllCall = (Article.findAll as jest.Mock).mock.calls[0];
      const whereClause = findAllCall[0].where[Op.and];
      expect(whereClause).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: { [Op.notIn]: expect.arrayContaining([1, 2]) },
          }),
        ]),
      );

      expect(result.foundCount).toBe(3);
      expect(result.deletedCount).toBe(3);
    });

    it("returns correct requestedCount, foundCount, and deletedCount", async () => {
      (ArticleIsRelevant.findAll as jest.Mock).mockResolvedValue([]);
      (ArticleApproved.findAll as jest.Mock).mockResolvedValue([]);
      (Article.findAll as jest.Mock).mockResolvedValue([
        { id: 1 },
        { id: 2 },
        { id: 3 },
      ]);
      (Article.destroy as jest.Mock).mockResolvedValue(3);

      const result = await deleteOldestEligibleArticles(10);

      expect(result.requestedCount).toBe(10);
      expect(result.foundCount).toBe(3);
      expect(result.deletedCount).toBe(3);
    });

    it("handles case where foundCount is less than requestedCount", async () => {
      (ArticleIsRelevant.findAll as jest.Mock).mockResolvedValue([]);
      (ArticleApproved.findAll as jest.Mock).mockResolvedValue([]);
      (Article.findAll as jest.Mock).mockResolvedValue([{ id: 1 }, { id: 2 }]);
      (Article.destroy as jest.Mock).mockResolvedValue(2);

      const result = await deleteOldestEligibleArticles(100);

      expect(result.requestedCount).toBe(100);
      expect(result.foundCount).toBe(2);
      expect(result.deletedCount).toBe(2);
    });

    it("orders articles by publishedDate ASC, then id ASC", async () => {
      (ArticleIsRelevant.findAll as jest.Mock).mockResolvedValue([]);
      (ArticleApproved.findAll as jest.Mock).mockResolvedValue([]);
      (Article.findAll as jest.Mock).mockResolvedValue([{ id: 1 }]);
      (Article.destroy as jest.Mock).mockResolvedValue(1);

      await deleteOldestEligibleArticles(5);

      const findAllCall = (Article.findAll as jest.Mock).mock.calls[0];
      expect(findAllCall[0].order).toEqual([
        ["publishedDate", "ASC"],
        ["id", "ASC"],
      ]);
    });

    it("logs progress during deletion", async () => {
      (ArticleIsRelevant.findAll as jest.Mock).mockResolvedValue([]);
      (ArticleApproved.findAll as jest.Mock).mockResolvedValue([]);
      (Article.findAll as jest.Mock).mockResolvedValue([
        { id: 1 },
        { id: 2 },
        { id: 3 },
      ]);
      (Article.destroy as jest.Mock).mockResolvedValue(3);

      await deleteOldestEligibleArticles(3);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Found 3 eligible articles for trim"),
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Deleted 3 of 3 trim articles"),
      );
    });
  });
});
