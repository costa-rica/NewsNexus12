import { ForeignKeyConstraintError, Op, UniqueConstraintError } from "sequelize";
import {
  Article,
  MODEL_LOAD_ORDER,
  NewsApiRequest,
  NewsArticleAggregatorSource,
  WeeklyArticleFlowRun,
  initModels,
  sequelize,
} from "@newsnexus/db-models";
import {
  WEEKLY_ARTICLE_FLOW_REQUEST_COLUMN,
  WEEKLY_ARTICLE_FLOW_REQUEST_FOREIGN_KEY,
  WEEKLY_ARTICLE_FLOW_REQUEST_INDEX,
  WEEKLY_ARTICLE_FLOW_TABLE,
  installWeeklyArticleFlowSchema,
} from "../../src/modules/installWeeklyArticleFlowSchema";

const queryInterface = sequelize.getQueryInterface();

async function clearFixtureRows(): Promise<void> {
  await Article.destroy({ where: {} });
  await NewsApiRequest.destroy({ where: {} });
  await WeeklyArticleFlowRun.destroy({ where: {} });
  await NewsArticleAggregatorSource.destroy({ where: {} });
}

async function createRun(
  status: "pending" | "running" | "completed" = "pending",
) {
  return WeeklyArticleFlowRun.create({
    mode: "dev_canary",
    status,
    host: "weekly-flow-integration-test",
    sourceRevision: "test-revision",
  });
}

describe("weekly article flow schema integration", () => {
  beforeAll(() => {
    initModels();
  });

  beforeEach(async () => {
    await installWeeklyArticleFlowSchema();
    await clearFixtureRows();
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it("exports models, associations, and dependency-safe load order", () => {
    expect(WeeklyArticleFlowRun.tableName).toBe(WEEKLY_ARTICLE_FLOW_TABLE);
    expect(WeeklyArticleFlowRun.associations).toHaveProperty("NewsApiRequests");
    expect(NewsApiRequest.associations).toHaveProperty("WeeklyArticleFlowRun");

    const runIndex = MODEL_LOAD_ORDER.indexOf("WeeklyArticleFlowRun");
    const requestIndex = MODEL_LOAD_ORDER.indexOf("NewsApiRequest");
    const articleIndex = MODEL_LOAD_ORDER.indexOf("Article");
    expect(runIndex).toBeGreaterThanOrEqual(0);
    expect(requestIndex).toBeGreaterThan(runIndex);
    expect(articleIndex).toBeGreaterThan(requestIndex);
  });

  it("creates a missing run table and request relationship idempotently", async () => {
    await queryInterface.removeColumn(
      "NewsApiRequests",
      WEEKLY_ARTICLE_FLOW_REQUEST_COLUMN,
    );
    await queryInterface.dropTable(WEEKLY_ARTICLE_FLOW_TABLE);

    const created = await installWeeklyArticleFlowSchema();
    expect(created).toEqual({
      addedRequestColumn: true,
      createdRunTable: true,
      retainedRequestColumn: false,
      retainedRunTable: false,
    });

    const retained = await installWeeklyArticleFlowSchema();
    expect(retained).toEqual({
      addedRequestColumn: false,
      createdRunTable: false,
      retainedRequestColumn: true,
      retainedRunTable: true,
    });
  });

  it("rejects an incompatible installed index without mutating it", async () => {
    await queryInterface.removeIndex(
      WEEKLY_ARTICLE_FLOW_TABLE,
      "idx_weekly_article_flow_runs_status",
    );

    await expect(installWeeklyArticleFlowSchema()).rejects.toThrow(
      `${WEEKLY_ARTICLE_FLOW_TABLE} is missing index idx_weekly_article_flow_runs_status`,
    );

    await queryInterface.addIndex(WEEKLY_ARTICLE_FLOW_TABLE, ["status"], {
      name: "idx_weekly_article_flow_runs_status",
    });
  });

  it("enforces one active run while allowing terminal history", async () => {
    const first = await createRun("pending");

    await expect(createRun("running")).rejects.toBeInstanceOf(
      UniqueConstraintError,
    );

    await first.update({ status: "completed", endedAt: new Date() });
    await expect(createRun("pending")).resolves.toBeDefined();
  });

  it("allows a null cohort link and restricts referenced run deletion", async () => {
    const source = await NewsArticleAggregatorSource.create({
      nameOfOrg: "Weekly flow integration source",
      isApi: true,
    });
    const run = await createRun("pending");

    const manualRequest = await NewsApiRequest.create({
      newsArticleAggregatorSourceId: source.id,
    });
    expect(manualRequest.weeklyArticleFlowRunId).toBeNull();

    await NewsApiRequest.create({
      newsArticleAggregatorSourceId: source.id,
      weeklyArticleFlowRunId: run.id,
    });

    await expect(run.destroy()).rejects.toBeInstanceOf(
      ForeignKeyConstraintError,
    );
  });

  it("returns only the exact run-to-request-to-article cohort", async () => {
    const source = await NewsArticleAggregatorSource.create({
      nameOfOrg: "Weekly cohort integration source",
      isApi: true,
    });
    const selectedRun = await createRun("completed");
    const otherRun = await WeeklyArticleFlowRun.create({
      mode: "dev_canary",
      status: "completed",
      host: "weekly-flow-integration-test",
      sourceRevision: "other-revision",
      endedAt: new Date(),
    });
    const selectedRequest = await NewsApiRequest.create({
      newsArticleAggregatorSourceId: source.id,
      weeklyArticleFlowRunId: selectedRun.id,
    });
    const otherRequest = await NewsApiRequest.create({
      newsArticleAggregatorSourceId: source.id,
      weeklyArticleFlowRunId: otherRun.id,
    });
    const manualRequest = await NewsApiRequest.create({
      newsArticleAggregatorSourceId: source.id,
    });

    const selectedArticles = await Article.bulkCreate([
      { title: "selected one", newsApiRequestId: selectedRequest.id },
      { title: "selected two", newsApiRequestId: selectedRequest.id },
    ]);
    await Article.bulkCreate([
      { title: "other", newsApiRequestId: otherRequest.id },
      { title: "manual", newsApiRequestId: manualRequest.id },
    ]);

    const cohort = await Article.findAll({
      attributes: ["id"],
      include: [
        {
          model: NewsApiRequest,
          attributes: [],
          required: true,
          where: { weeklyArticleFlowRunId: selectedRun.id },
        },
      ],
      order: [["id", "ASC"]],
    });

    expect(cohort.map((article) => article.id)).toEqual(
      selectedArticles.map((article) => article.id),
    );
    expect(
      await NewsApiRequest.count({
        where: { weeklyArticleFlowRunId: { [Op.is]: null } },
      }),
    ).toBe(1);
  });

  it("installs the named request index and restrictive foreign key", async () => {
    const indexes = (await queryInterface.showIndex("NewsApiRequests")) as Array<{
      name?: string;
    }>;
    expect(
      indexes.some((index) => index.name === WEEKLY_ARTICLE_FLOW_REQUEST_INDEX),
    ).toBe(true);

    const references = (await queryInterface.getForeignKeyReferencesForTable(
      "NewsApiRequests",
    )) as Array<{
      columnName?: string;
      constraintName?: string;
      referencedTableName?: string;
    }>;
    expect(
      references.some(
        (reference) =>
          reference.constraintName === WEEKLY_ARTICLE_FLOW_REQUEST_FOREIGN_KEY &&
          reference.columnName === WEEKLY_ARTICLE_FLOW_REQUEST_COLUMN &&
          reference.referencedTableName === WEEKLY_ARTICLE_FLOW_TABLE,
      ),
    ).toBe(true);
  });
});
