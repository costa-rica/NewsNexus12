import type { Model, ModelStatic, Sequelize } from "sequelize";
import {
  WEEKLY_ARTICLE_FLOW_REQUEST_COLUMN,
  WEEKLY_ARTICLE_FLOW_REQUEST_FOREIGN_KEY,
  WEEKLY_ARTICLE_FLOW_REQUEST_INDEX,
  WEEKLY_ARTICLE_FLOW_TABLE,
  installWeeklyArticleFlowSchema,
} from "../../src/modules/installWeeklyArticleFlowSchema";

type FakeState = {
  requestColumn: boolean;
  requestForeignKey: boolean;
  requestIndex: boolean;
  requestNullable: boolean;
  runTable: boolean;
  runStatusIndex: boolean;
};

const runColumns = {
  id: { allowNull: false, type: "INTEGER" },
  mode: { allowNull: false, type: "VARCHAR(64)" },
  status: { allowNull: false, type: "VARCHAR(64)" },
  currentStage: { allowNull: false, type: "VARCHAR(128)" },
  scheduledFor: { allowNull: true, type: "TIMESTAMP WITH TIME ZONE" },
  startedAt: { allowNull: false, type: "TIMESTAMP WITH TIME ZONE" },
  endedAt: { allowNull: true, type: "TIMESTAMP WITH TIME ZONE" },
  host: { allowNull: false, type: "VARCHAR(255)" },
  sourceRevision: { allowNull: false, type: "VARCHAR(255)" },
  rssArticlesAddedCount: { allowNull: true, type: "INTEGER" },
  cohortArticleCount: { allowNull: true, type: "INTEGER" },
  stageResults: { allowNull: false, type: "JSONB" },
  failureReason: { allowNull: true, type: "TEXT" },
  jsonlFilePath: { allowNull: true, type: "TEXT" },
  createdAt: { allowNull: false, type: "TIMESTAMP WITH TIME ZONE" },
  updatedAt: { allowNull: false, type: "TIMESTAMP WITH TIME ZONE" },
};

function createDependencies(overrides: Partial<FakeState> = {}) {
  const state: FakeState = {
    requestColumn: false,
    requestForeignKey: false,
    requestIndex: false,
    requestNullable: true,
    runTable: false,
    runStatusIndex: true,
    ...overrides,
  };

  const queryInterface = {
    addColumn: jest.fn(async () => {
      state.requestColumn = true;
    }),
    addConstraint: jest.fn(async () => {
      state.requestForeignKey = true;
    }),
    addIndex: jest.fn(async () => {
      state.requestIndex = true;
    }),
    describeTable: jest.fn(async (tableName: string) => {
      if (tableName === WEEKLY_ARTICLE_FLOW_TABLE) {
        return runColumns;
      }
      return {
        id: { allowNull: false, type: "INTEGER" },
        ...(state.requestColumn
          ? {
              [WEEKLY_ARTICLE_FLOW_REQUEST_COLUMN]: {
                allowNull: state.requestNullable,
                type: "INTEGER",
              },
            }
          : {}),
      };
    }),
    getForeignKeyReferencesForTable: jest.fn(async () =>
      state.requestForeignKey
        ? [
            {
              columnName: WEEKLY_ARTICLE_FLOW_REQUEST_COLUMN,
              constraintName: WEEKLY_ARTICLE_FLOW_REQUEST_FOREIGN_KEY,
              referencedColumnName: "id",
              referencedTableName: WEEKLY_ARTICLE_FLOW_TABLE,
            },
          ]
        : [],
    ),
    showAllTables: jest.fn(async () => [
      "NewsApiRequests",
      ...(state.runTable ? [WEEKLY_ARTICLE_FLOW_TABLE] : []),
    ]),
    showIndex: jest.fn(async (tableName: string) => {
      if (tableName === "NewsApiRequests") {
        return state.requestIndex
          ? [
              {
                fields: [{ attribute: WEEKLY_ARTICLE_FLOW_REQUEST_COLUMN }],
                name: WEEKLY_ARTICLE_FLOW_REQUEST_INDEX,
                unique: false,
              },
            ]
          : [];
      }

      return [
        ...(state.runStatusIndex
          ? [
              {
                fields: [{ attribute: "status" }],
                name: "idx_weekly_article_flow_runs_status",
                unique: false,
              },
            ]
          : []),
        {
          fields: [{ attribute: "scheduledFor" }],
          name: "idx_weekly_article_flow_runs_scheduled_for",
          unique: false,
        },
        {
          fields: [{ attribute: "createdAt" }],
          name: "idx_weekly_article_flow_runs_created_at",
          unique: false,
        },
        {
          definition:
            "CREATE UNIQUE INDEX uq_weekly_article_flow_runs_single_active ON public.\"WeeklyArticleFlowRuns\" USING btree ((1)) WHERE ((status)::text = ANY ((ARRAY['pending'::character varying, 'running'::character varying])::text[]))",
          fields: [],
          name: "uq_weekly_article_flow_runs_single_active",
          unique: true,
        },
      ];
    }),
  };

  const connection = {
    getQueryInterface: () => queryInterface,
    query: jest.fn(async () => [{ delete_action: "RESTRICT" }]),
  } as unknown as Sequelize;
  const runModel = {
    sync: jest.fn(async () => {
      state.runTable = true;
    }),
  } as unknown as ModelStatic<Model>;

  return {
    dependencies: {
      initializeModels: jest.fn(),
      models: {
        request: {} as ModelStatic<Model>,
        run: runModel,
      },
      sequelize: connection,
    },
    queryInterface,
    runModel,
    state,
  };
}

describe("weekly article flow schema installer", () => {
  it("creates missing additive schema in dependency order", async () => {
    const fixture = createDependencies();

    await expect(
      installWeeklyArticleFlowSchema(fixture.dependencies),
    ).resolves.toEqual({
      addedRequestColumn: true,
      createdRunTable: true,
      retainedRequestColumn: false,
      retainedRunTable: false,
    });

    expect(fixture.runModel.sync).toHaveBeenCalledTimes(1);
    expect(fixture.queryInterface.addColumn).toHaveBeenCalledTimes(1);
    expect(fixture.queryInterface.addConstraint).toHaveBeenCalledWith(
      "NewsApiRequests",
      expect.objectContaining({
        name: WEEKLY_ARTICLE_FLOW_REQUEST_FOREIGN_KEY,
        onDelete: "RESTRICT",
      }),
    );
    expect(fixture.queryInterface.addIndex).toHaveBeenCalledTimes(1);
  });

  it("retains a compatible installation without mutation", async () => {
    const fixture = createDependencies({
      requestColumn: true,
      requestForeignKey: true,
      requestIndex: true,
      runTable: true,
    });

    await expect(
      installWeeklyArticleFlowSchema(fixture.dependencies),
    ).resolves.toEqual({
      addedRequestColumn: false,
      createdRunTable: false,
      retainedRequestColumn: true,
      retainedRunTable: true,
    });
    expect(fixture.runModel.sync).not.toHaveBeenCalled();
    expect(fixture.queryInterface.addColumn).not.toHaveBeenCalled();
  });

  it("refuses an incomplete active-run index before mutation", async () => {
    const fixture = createDependencies({
      requestColumn: true,
      requestForeignKey: true,
      requestIndex: true,
      runStatusIndex: false,
      runTable: true,
    });

    await expect(
      installWeeklyArticleFlowSchema(fixture.dependencies),
    ).rejects.toThrow(
      `${WEEKLY_ARTICLE_FLOW_TABLE} is missing index idx_weekly_article_flow_runs_status`,
    );
    expect(fixture.queryInterface.addColumn).not.toHaveBeenCalled();
  });

  it("refuses an incompatible request link before mutation", async () => {
    const fixture = createDependencies({
      requestColumn: true,
      requestForeignKey: true,
      requestIndex: true,
      requestNullable: false,
      runTable: true,
    });

    await expect(
      installWeeklyArticleFlowSchema(fixture.dependencies),
    ).rejects.toThrow("has incompatible type or nullability");
    expect(fixture.queryInterface.addColumn).not.toHaveBeenCalled();
  });
});
