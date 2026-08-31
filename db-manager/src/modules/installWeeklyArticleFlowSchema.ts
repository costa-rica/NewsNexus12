import {
  DataTypes,
  Model,
  ModelStatic,
  QueryTypes,
  Sequelize,
} from "sequelize";
import {
  NewsApiRequest,
  WeeklyArticleFlowRun,
  initModels,
  sequelize,
} from "@newsnexus/db-models";

export const WEEKLY_ARTICLE_FLOW_TABLE = "WeeklyArticleFlowRuns";
export const WEEKLY_ARTICLE_FLOW_REQUEST_COLUMN = "weeklyArticleFlowRunId";
export const WEEKLY_ARTICLE_FLOW_REQUEST_INDEX =
  "idx_news_api_requests_weekly_article_flow_run_id";
export const WEEKLY_ARTICLE_FLOW_REQUEST_FOREIGN_KEY =
  "fk_news_api_requests_weekly_article_flow_run_id";

type WeeklyArticleFlowSchemaInstallResult = {
  addedRequestColumn: boolean;
  createdRunTable: boolean;
  retainedRequestColumn: boolean;
  retainedRunTable: boolean;
};

export type WeeklyArticleFlowSchemaInstallerDependencies = {
  initializeModels: () => unknown;
  models: {
    request: ModelStatic<Model>;
    run: ModelStatic<Model>;
  };
  sequelize: Sequelize;
};

type DescribedColumn = {
  allowNull?: boolean;
  defaultValue?: unknown;
  type?: string;
};

type DescribedIndex = {
  definition?: string;
  fields?: Array<{ attribute?: string; name?: string }>;
  name?: string;
  unique?: boolean;
};

type DescribedForeignKey = {
  columnName?: string;
  constraintName?: string;
  referencedColumnName?: string;
  referencedTableName?: string;
};

const RUN_COLUMNS: Record<
  string,
  { allowNull: boolean; kind: "date" | "integer" | "jsonb" | "string" | "text" }
> = {
  id: { allowNull: false, kind: "integer" },
  mode: { allowNull: false, kind: "string" },
  status: { allowNull: false, kind: "string" },
  currentStage: { allowNull: false, kind: "string" },
  scheduledFor: { allowNull: true, kind: "date" },
  startedAt: { allowNull: false, kind: "date" },
  endedAt: { allowNull: true, kind: "date" },
  host: { allowNull: false, kind: "string" },
  sourceRevision: { allowNull: false, kind: "string" },
  rssArticlesAddedCount: { allowNull: true, kind: "integer" },
  cohortArticleCount: { allowNull: true, kind: "integer" },
  stageResults: { allowNull: false, kind: "jsonb" },
  failureReason: { allowNull: true, kind: "text" },
  jsonlFilePath: { allowNull: true, kind: "text" },
  createdAt: { allowNull: false, kind: "date" },
  updatedAt: { allowNull: false, kind: "date" },
};

const RUN_INDEXES = [
  {
    name: "idx_weekly_article_flow_runs_status",
    fields: ["status"],
    unique: false,
  },
  {
    name: "idx_weekly_article_flow_runs_scheduled_for",
    fields: ["scheduledFor"],
    unique: false,
  },
  {
    name: "idx_weekly_article_flow_runs_created_at",
    fields: ["createdAt"],
    unique: false,
  },
  {
    name: "uq_weekly_article_flow_runs_single_active",
    fields: [],
    unique: true,
    definitionTerms: ["(1)", "pending", "running"],
  },
] as const;

function normalizeTableName(table: unknown): string {
  if (typeof table === "string") {
    return table;
  }
  if (table && typeof table === "object" && "tableName" in table) {
    return String((table as { tableName: unknown }).tableName);
  }
  return String(table);
}

function columnTypeMatches(
  actualType: string,
  expectedKind: (typeof RUN_COLUMNS)[string]["kind"],
): boolean {
  const matchers = {
    date: /\bTIMESTAMP\b/,
    integer: /\bINTEGER\b/,
    jsonb: /\bJSONB\b/,
    string: /\b(CHARACTER VARYING|VARCHAR)\b/,
    text: /\bTEXT\b/,
  };
  return matchers[expectedKind].test(actualType.toUpperCase());
}

function indexFieldNames(index: DescribedIndex): string[] {
  return (index.fields ?? []).map((field) =>
    String(field.attribute ?? field.name ?? ""),
  );
}

async function validateRunTable(connection: Sequelize): Promise<void> {
  const queryInterface = connection.getQueryInterface();
  const described = (await queryInterface.describeTable(
    WEEKLY_ARTICLE_FLOW_TABLE,
  )) as Record<string, DescribedColumn>;
  const actualNames = Object.keys(described).sort();
  const expectedNames = Object.keys(RUN_COLUMNS).sort();

  if (actualNames.join("|") !== expectedNames.join("|")) {
    throw new Error(
      `${WEEKLY_ARTICLE_FLOW_TABLE} has incompatible columns; expected ${expectedNames.join(", ")}, found ${actualNames.join(", ")}`,
    );
  }

  for (const [columnName, expected] of Object.entries(RUN_COLUMNS)) {
    const actual = described[columnName];
    if (!actual || typeof actual.type !== "string") {
      throw new Error(
        `${WEEKLY_ARTICLE_FLOW_TABLE}.${columnName} is missing type metadata`,
      );
    }
    if (!columnTypeMatches(actual.type, expected.kind)) {
      throw new Error(
        `${WEEKLY_ARTICLE_FLOW_TABLE}.${columnName} has incompatible type ${actual.type}`,
      );
    }
    if (Boolean(actual.allowNull) !== expected.allowNull) {
      throw new Error(
        `${WEEKLY_ARTICLE_FLOW_TABLE}.${columnName} has incompatible nullability`,
      );
    }
  }

  const indexes = (await queryInterface.showIndex(
    WEEKLY_ARTICLE_FLOW_TABLE,
  )) as DescribedIndex[];
  for (const expected of RUN_INDEXES) {
    const actual = indexes.find((index) => index.name === expected.name);
    if (!actual) {
      throw new Error(
        `${WEEKLY_ARTICLE_FLOW_TABLE} is missing index ${expected.name}`,
      );
    }
    if (Boolean(actual.unique) !== expected.unique) {
      throw new Error(
        `${WEEKLY_ARTICLE_FLOW_TABLE}.${expected.name} has incompatible uniqueness`,
      );
    }
    if (
      expected.fields.length > 0 &&
      indexFieldNames(actual).join("|") !== expected.fields.join("|")
    ) {
      throw new Error(
        `${WEEKLY_ARTICLE_FLOW_TABLE}.${expected.name} has incompatible fields`,
      );
    }
    if (
      "definitionTerms" in expected &&
      !expected.definitionTerms.every((term) =>
        String(actual.definition ?? "").toLowerCase().includes(term),
      )
    ) {
      throw new Error(
        `${WEEKLY_ARTICLE_FLOW_TABLE}.${expected.name} has incompatible predicate`,
      );
    }
  }
}

async function validateRequestColumn(connection: Sequelize): Promise<void> {
  const queryInterface = connection.getQueryInterface();
  const described = (await queryInterface.describeTable(
    "NewsApiRequests",
  )) as Record<string, DescribedColumn>;
  const column = described[WEEKLY_ARTICLE_FLOW_REQUEST_COLUMN];

  if (!column || typeof column.type !== "string") {
    throw new Error(
      `NewsApiRequests.${WEEKLY_ARTICLE_FLOW_REQUEST_COLUMN} is missing`,
    );
  }
  if (!columnTypeMatches(column.type, "integer") || !column.allowNull) {
    throw new Error(
      `NewsApiRequests.${WEEKLY_ARTICLE_FLOW_REQUEST_COLUMN} has incompatible type or nullability`,
    );
  }

  const indexes = (await queryInterface.showIndex(
    "NewsApiRequests",
  )) as DescribedIndex[];
  const index = indexes.find(
    (candidate) => candidate.name === WEEKLY_ARTICLE_FLOW_REQUEST_INDEX,
  );
  if (
    !index ||
    Boolean(index.unique) ||
    indexFieldNames(index).join("|") !== WEEKLY_ARTICLE_FLOW_REQUEST_COLUMN
  ) {
    throw new Error(
      `NewsApiRequests is missing compatible index ${WEEKLY_ARTICLE_FLOW_REQUEST_INDEX}`,
    );
  }

  const references = (await queryInterface.getForeignKeyReferencesForTable(
    "NewsApiRequests",
  )) as DescribedForeignKey[];
  const foreignKey = references.find(
    (reference) =>
      reference.columnName === WEEKLY_ARTICLE_FLOW_REQUEST_COLUMN &&
      reference.referencedTableName === WEEKLY_ARTICLE_FLOW_TABLE &&
      reference.referencedColumnName === "id",
  );
  if (!foreignKey) {
    throw new Error(
      `NewsApiRequests.${WEEKLY_ARTICLE_FLOW_REQUEST_COLUMN} is missing its required foreign key`,
    );
  }

  const deleteRules = await connection.query<{ delete_action: string }>(
    `SELECT rc.delete_rule AS delete_action
       FROM information_schema.referential_constraints rc
       JOIN information_schema.table_constraints tc
         ON tc.constraint_catalog = rc.constraint_catalog
        AND tc.constraint_schema = rc.constraint_schema
        AND tc.constraint_name = rc.constraint_name
      WHERE tc.table_schema = current_schema()
        AND tc.table_name = 'NewsApiRequests'
        AND tc.constraint_name = :constraintName`,
    {
      replacements: {
        constraintName:
          foreignKey.constraintName ?? WEEKLY_ARTICLE_FLOW_REQUEST_FOREIGN_KEY,
      },
      type: QueryTypes.SELECT,
    },
  );
  if (deleteRules[0]?.delete_action !== "RESTRICT") {
    throw new Error(
      `NewsApiRequests.${WEEKLY_ARTICLE_FLOW_REQUEST_COLUMN} must use ON DELETE RESTRICT`,
    );
  }
}

export async function installWeeklyArticleFlowSchema(
  dependencies: WeeklyArticleFlowSchemaInstallerDependencies = {
    initializeModels: initModels,
    models: {
      request: NewsApiRequest,
      run: WeeklyArticleFlowRun,
    },
    sequelize,
  },
): Promise<WeeklyArticleFlowSchemaInstallResult> {
  dependencies.initializeModels();
  const queryInterface = dependencies.sequelize.getQueryInterface();
  const existingTables = new Set(
    (await queryInterface.showAllTables()).map(normalizeTableName),
  );

  if (!existingTables.has("NewsApiRequests")) {
    throw new Error(
      "Missing prerequisite table NewsApiRequests; initialize the base NewsNexus schema first",
    );
  }

  const existingRequestColumns = (await queryInterface.describeTable(
    "NewsApiRequests",
  )) as Record<string, DescribedColumn>;
  const hasRunTable = existingTables.has(WEEKLY_ARTICLE_FLOW_TABLE);
  const hasRequestColumn =
    WEEKLY_ARTICLE_FLOW_REQUEST_COLUMN in existingRequestColumns;

  if (hasRunTable) {
    await validateRunTable(dependencies.sequelize);
  }
  if (hasRequestColumn) {
    await validateRequestColumn(dependencies.sequelize);
  }

  if (!hasRunTable) {
    await dependencies.models.run.sync();
  }

  if (!hasRequestColumn) {
    await queryInterface.addColumn(
      "NewsApiRequests",
      WEEKLY_ARTICLE_FLOW_REQUEST_COLUMN,
      {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: null,
      },
    );
    await queryInterface.addConstraint("NewsApiRequests", {
      fields: [WEEKLY_ARTICLE_FLOW_REQUEST_COLUMN],
      name: WEEKLY_ARTICLE_FLOW_REQUEST_FOREIGN_KEY,
      onDelete: "RESTRICT",
      onUpdate: "CASCADE",
      references: {
        table: WEEKLY_ARTICLE_FLOW_TABLE,
        field: "id",
      },
      type: "foreign key",
    });
    await queryInterface.addIndex(
      "NewsApiRequests",
      [WEEKLY_ARTICLE_FLOW_REQUEST_COLUMN],
      { name: WEEKLY_ARTICLE_FLOW_REQUEST_INDEX },
    );
  }

  await validateRunTable(dependencies.sequelize);
  await validateRequestColumn(dependencies.sequelize);

  return {
    addedRequestColumn: !hasRequestColumn,
    createdRunTable: !hasRunTable,
    retainedRequestColumn: hasRequestColumn,
    retainedRunTable: hasRunTable,
  };
}
