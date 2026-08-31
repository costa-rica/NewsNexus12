jest.mock("@newsnexus/db-models", () => ({
  ArticleDuplicateAnalysis: {
    count: jest.fn(),
    destroy: jest.fn(),
    findAll: jest.fn(),
  },
}));

import { Op } from "sequelize";
import { ArticleDuplicateAnalysis } from "@newsnexus/db-models";
import { clearDuplicateAnalyses } from "../../src/modules/clearDuplicateAnalyses";

describe("clearDuplicateAnalyses", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns a zero-row successful result", async () => {
    (ArticleDuplicateAnalysis.count as jest.Mock)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    (ArticleDuplicateAnalysis.findAll as jest.Mock).mockResolvedValue([]);

    await expect(clearDuplicateAnalyses(2)).resolves.toEqual({
      command: "clear_duplicate_analyses",
      success: true,
      beforeCount: 0,
      deletedCount: 0,
      remainingCount: 0,
      batchCount: 0,
    });
  });

  it("deletes ordered primary keys in resumable batches", async () => {
    (ArticleDuplicateAnalysis.count as jest.Mock)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(0);
    (ArticleDuplicateAnalysis.findAll as jest.Mock)
      .mockResolvedValueOnce([{ id: 4 }, { id: 9 }])
      .mockResolvedValueOnce([{ id: 12 }])
      .mockResolvedValueOnce([]);
    (ArticleDuplicateAnalysis.destroy as jest.Mock)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);

    const result = await clearDuplicateAnalyses(2);

    expect(result).toEqual(expect.objectContaining({
      beforeCount: 3,
      deletedCount: 3,
      remainingCount: 0,
      batchCount: 2,
    }));
    expect(ArticleDuplicateAnalysis.destroy).toHaveBeenNthCalledWith(1, {
      where: { id: { [Op.in]: [4, 9] } },
    });
  });

  it("stops on a partial batch deletion", async () => {
    (ArticleDuplicateAnalysis.count as jest.Mock).mockResolvedValueOnce(2);
    (ArticleDuplicateAnalysis.findAll as jest.Mock).mockResolvedValueOnce([
      { id: 1 },
      { id: 2 },
    ]);
    (ArticleDuplicateAnalysis.destroy as jest.Mock).mockResolvedValueOnce(1);

    await expect(clearDuplicateAnalyses(2)).rejects.toThrow(
      "expected to delete 2 rows but deleted 1",
    );
  });

  it("fails final verification when rows remain", async () => {
    (ArticleDuplicateAnalysis.count as jest.Mock)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);
    (ArticleDuplicateAnalysis.findAll as jest.Mock)
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce([]);
    (ArticleDuplicateAnalysis.destroy as jest.Mock).mockResolvedValueOnce(1);

    await expect(clearDuplicateAnalyses(2)).rejects.toThrow(
      "cleanup verification failed",
    );
  });
});
