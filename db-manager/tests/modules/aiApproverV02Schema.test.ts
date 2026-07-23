import { Op, UniqueConstraintError } from "sequelize";
import {
  AiApproverArticlePredictionV02,
  AiApproverPromptVersionV02,
  AiApproverRunV02,
  Article,
  MODEL_LOAD_ORDER,
  initModels,
  sequelize,
} from "@newsnexus/db-models";
import {
  AI_APPROVER_V02_TABLES,
  installAiApproverV02Schema,
} from "../../src/modules/installAiApproverV02Schema";

const queryInterface = sequelize.getQueryInterface();

type TestIndexDescription = {
  definition?: string;
  name?: string;
  unique?: boolean;
};

async function dropV02Tables(): Promise<void> {
  await queryInterface.dropTable("AiApproverArticlePredictionsV02");
  await queryInterface.dropTable("AiApproverRunsV02");
  await queryInterface.dropTable("AiApproverPromptVersionsV02");
}

describe("AI Approver V02 schema", () => {
  beforeAll(() => {
    initModels();
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it("exports the models, associations, and dependency-safe load order", () => {
    expect(AiApproverPromptVersionV02.tableName).toBe(
      "AiApproverPromptVersionsV02",
    );
    expect(AiApproverRunV02.tableName).toBe("AiApproverRunsV02");
    expect(AiApproverArticlePredictionV02.tableName).toBe(
      "AiApproverArticlePredictionsV02",
    );

    expect(AiApproverPromptVersionV02.associations).toHaveProperty(
      "AiApproverRunV02s",
    );
    expect(AiApproverPromptVersionV02.associations).toHaveProperty(
      "AiApproverArticlePredictionV02s",
    );
    expect(AiApproverRunV02.associations).toHaveProperty(
      "AiApproverArticlePredictionV02s",
    );
    expect(Article.associations).toHaveProperty(
      "AiApproverArticlePredictionV02",
    );

    const promptIndex = MODEL_LOAD_ORDER.indexOf(
      "AiApproverPromptVersionV02",
    );
    const runIndex = MODEL_LOAD_ORDER.indexOf("AiApproverRunV02");
    const articleIndex = MODEL_LOAD_ORDER.indexOf("Article");
    const predictionIndex = MODEL_LOAD_ORDER.indexOf(
      "AiApproverArticlePredictionV02",
    );

    expect(promptIndex).toBeGreaterThanOrEqual(0);
    expect(runIndex).toBeGreaterThan(promptIndex);
    expect(predictionIndex).toBeGreaterThan(runIndex);
    expect(predictionIndex).toBeGreaterThan(articleIndex);
  });

  it("normalizes blank titles and validates prediction outcomes", async () => {
    const prompt = AiApproverPromptVersionV02.build({
      title: "   ",
      promptInMarkdown: "Prompt",
    });
    expect(prompt.title).toBeNull();

    await expect(
      AiApproverArticlePredictionV02.build({
        articleId: 1,
        promptVersionId: 1,
        runId: 1,
        resultStatus: "completed",
        prediction: null,
        reasoning: "Reason",
        modelName: "model",
        pipelineVersion: "v1",
        contentSource: "description",
      }).validate(),
    ).rejects.toThrow(
      "completed predictions require a prediction and nonblank reasoning",
    );

    await expect(
      AiApproverArticlePredictionV02.build({
        articleId: 1,
        promptVersionId: 1,
        runId: 1,
        resultStatus: "failed",
        prediction: "approved",
        reasoning: null,
        modelName: "model",
        pipelineVersion: "v1",
        contentSource: "description",
      }).validate(),
    ).rejects.toThrow("non-completed predictions require a null prediction");

    await expect(
      AiApproverArticlePredictionV02.build({
        articleId: 1,
        promptVersionId: 1,
        runId: 1,
        resultStatus: "failed",
        prediction: null,
        reasoning: null,
        attemptCount: 3,
        modelName: "model",
        pipelineVersion: "v1",
        contentSource: "description",
      }).validate(),
    ).rejects.toThrow();
  });

  it("enforces one active prompt and unique non-null titles", async () => {
    await AiApproverArticlePredictionV02.destroy({ where: {} });
    await AiApproverRunV02.destroy({ where: {} });
    await AiApproverPromptVersionV02.destroy({ where: {} });

    await AiApproverPromptVersionV02.create({
      title: "Primary",
      promptInMarkdown: "Prompt",
      isActive: true,
    });
    await AiApproverPromptVersionV02.create({
      title: null,
      promptInMarkdown: "Inactive one",
      isActive: false,
    });
    await AiApproverPromptVersionV02.create({
      title: null,
      promptInMarkdown: "Inactive two",
      isActive: false,
    });

    await expect(
      AiApproverPromptVersionV02.create({
        title: "Other",
        promptInMarkdown: "Prompt",
        isActive: true,
      }),
    ).rejects.toBeInstanceOf(UniqueConstraintError);

    await expect(
      AiApproverPromptVersionV02.create({
        title: "Primary",
        promptInMarkdown: "Prompt",
        isActive: false,
      }),
    ).rejects.toBeInstanceOf(UniqueConstraintError);
  });

  it("treats an existing compatible installation as a no-op", async () => {
    const result = await installAiApproverV02Schema();

    expect(result.createdTables).toEqual([]);
    expect(result.retainedTables).toEqual(AI_APPROVER_V02_TABLES);
  });

  it("creates only the absent V02 tables in dependency order", async () => {
    const beforeTables = new Set(
      (await queryInterface.showAllTables()).map(String),
    );
    await dropV02Tables();

    const result = await installAiApproverV02Schema();
    const afterTables = new Set(
      (await queryInterface.showAllTables()).map(String),
    );

    expect(result.createdTables).toEqual(AI_APPROVER_V02_TABLES);
    expect(result.retainedTables).toEqual([]);
    expect(afterTables).toEqual(beforeTables);
  });

  it("fails before mutation when a V02 table is partial", async () => {
    await queryInterface.dropTable("AiApproverArticlePredictionsV02");
    await queryInterface.createTable("AiApproverArticlePredictionsV02", {
      id: {
        type: "SERIAL",
        allowNull: false,
        primaryKey: true,
      },
    });

    await expect(installAiApproverV02Schema()).rejects.toThrow(
      "AiApproverArticlePredictionsV02 has incompatible columns",
    );

    const columns = await queryInterface.describeTable(
      "AiApproverArticlePredictionsV02",
    );
    expect(Object.keys(columns)).toEqual(["id"]);

    await queryInterface.dropTable("AiApproverArticlePredictionsV02");
    await installAiApproverV02Schema();
  });

  it("rejects a compatible table with a missing required index", async () => {
    await queryInterface.removeIndex(
      "AiApproverPromptVersionsV02",
      "idx_ai_approver_prompt_versions_v02_is_active",
    );

    await expect(installAiApproverV02Schema()).rejects.toThrow(
      "AiApproverPromptVersionsV02 is missing index idx_ai_approver_prompt_versions_v02_is_active",
    );

    await queryInterface.addIndex("AiApproverPromptVersionsV02", ["isActive"], {
      name: "idx_ai_approver_prompt_versions_v02_is_active",
    });

    const remainingIndexes = (await queryInterface.showIndex(
      "AiApproverPromptVersionsV02",
    )) as TestIndexDescription[];
    expect(
      remainingIndexes.some(
        (index) =>
          index.name === "uq_ai_approver_prompt_versions_v02_title_nonnull" &&
          index.unique &&
          String(index.definition)
            .replace(/"/g, "")
            .toLowerCase()
            .includes("title is not null"),
      ),
    ).toBe(true);

    expect(
      remainingIndexes.some(
        (index) =>
          index.name === "uq_ai_approver_prompt_versions_v02_single_active" &&
          index.unique &&
          String(index.definition)
            .replace(/"/g, "")
            .toLowerCase()
            .includes("isactive = true"),
      ),
    ).toBe(true);
  });

  it("does not define a unique database index on prediction articleId", () => {
    const articleIndexes = (
      AiApproverArticlePredictionV02.options.indexes ?? []
    ).filter((index) =>
      (index.fields ?? []).some((field) =>
        typeof field === "string"
          ? field === "articleId"
          : "name" in field && field.name === "articleId",
      ),
    );

    expect(articleIndexes).toHaveLength(1);
    expect(articleIndexes[0].unique).not.toBe(true);
    const references =
      AiApproverArticlePredictionV02.rawAttributes.articleId.references;
    if (!references || typeof references === "string") {
      throw new Error("articleId reference metadata was not initialized");
    }
    expect(references.key).toBe("id");
    const referencedModel = references.model as
      | string
      | { tableName?: string };
    expect(
      typeof referencedModel === "string"
        ? referencedModel
        : referencedModel.tableName,
    ).toBe("Articles");
  });
});
