import type {
  Model,
  ModelStatic,
  QueryInterface,
  Sequelize,
} from "sequelize";
import {
  AiApproverArticlePredictionV02,
  AiApproverPromptVersionV02,
  AiApproverRunV02,
  initModels,
  sequelize,
} from "@newsnexus/db-models";

export const AI_APPROVER_V02_TABLES = [
  "AiApproverPromptVersionsV02",
  "AiApproverRunsV02",
  "AiApproverArticlePredictionsV02",
] as const;

type AiApproverV02TableName = (typeof AI_APPROVER_V02_TABLES)[number];

type ColumnKind =
  | "boolean"
  | "date"
  | "integer"
  | "jsonb"
  | "string"
  | "text";

type ColumnSpec = {
  allowNull: boolean;
  kind: ColumnKind;
};

type IndexSpec = {
  fields: string[];
  name: string;
  predicate?: string;
  unique?: boolean;
};

type ForeignKeySpec = {
  columnName: string;
  referencedColumnName: string;
  referencedTableName: string;
};

type TableSpec = {
  columns: Record<string, ColumnSpec>;
  foreignKeys: ForeignKeySpec[];
  indexes: IndexSpec[];
  model: ModelStatic<Model>;
  tableName: AiApproverV02TableName;
};

export type AiApproverV02SchemaInstallResult = {
  createdTables: AiApproverV02TableName[];
  retainedTables: AiApproverV02TableName[];
};

export type AiApproverV02SchemaInstallerDependencies = {
  initializeModels: () => unknown;
  models: {
    prediction: ModelStatic<Model>;
    prompt: ModelStatic<Model>;
    run: ModelStatic<Model>;
  };
  sequelize: Sequelize;
};

type DescribedColumn = {
  allowNull?: boolean;
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
  referencedColumnName?: string;
  referencedTableName?: string;
};

const timestampColumns: Record<string, ColumnSpec> = {
  createdAt: { allowNull: false, kind: "date" },
  updatedAt: { allowNull: false, kind: "date" },
};

function getTableSpecs(
  models: AiApproverV02SchemaInstallerDependencies["models"],
): TableSpec[] {
  return [
    {
      tableName: "AiApproverPromptVersionsV02",
      model: models.prompt,
      columns: {
        id: { allowNull: false, kind: "integer" },
        title: { allowNull: true, kind: "string" },
        promptInMarkdown: { allowNull: false, kind: "text" },
        isActive: { allowNull: false, kind: "boolean" },
        firstUsedAt: { allowNull: true, kind: "date" },
        ...timestampColumns,
      },
      indexes: [
        {
          name: "uq_ai_approver_prompt_versions_v02_title_nonnull",
          fields: ["title"],
          unique: true,
          predicate: "title is not null",
        },
        {
          name: "uq_ai_approver_prompt_versions_v02_single_active",
          fields: ["isActive"],
          unique: true,
          predicate: "isactive = true",
        },
        {
          name: "idx_ai_approver_prompt_versions_v02_is_active",
          fields: ["isActive"],
        },
      ],
      foreignKeys: [],
    },
    {
      tableName: "AiApproverRunsV02",
      model: models.run,
      columns: {
        id: { allowNull: false, kind: "integer" },
        jobId: { allowNull: true, kind: "string" },
        activePromptVersionId: { allowNull: false, kind: "integer" },
        selectionMode: { allowNull: false, kind: "string" },
        requestedArticleCount: { allowNull: true, kind: "integer" },
        allowPastApprovedBoundary: { allowNull: false, kind: "boolean" },
        allowDescriptionFallback: { allowNull: false, kind: "boolean" },
        highestArticleIdAtStart: { allowNull: false, kind: "integer" },
        approvedBoundaryArticleId: { allowNull: true, kind: "integer" },
        plannedEligibleCount: { allowNull: false, kind: "integer" },
        attemptedCount: { allowNull: false, kind: "integer" },
        completedCount: { allowNull: false, kind: "integer" },
        failedCount: { allowNull: false, kind: "integer" },
        invalidResponseCount: { allowNull: false, kind: "integer" },
        skippedCount: { allowNull: false, kind: "integer" },
        status: { allowNull: false, kind: "string" },
        endingReason: { allowNull: true, kind: "text" },
        modelName: { allowNull: false, kind: "string" },
        selectionSnapshot: { allowNull: false, kind: "jsonb" },
        previewToken: { allowNull: true, kind: "string" },
        previewExpiresAt: { allowNull: true, kind: "date" },
        startedAt: { allowNull: true, kind: "date" },
        endedAt: { allowNull: true, kind: "date" },
        ...timestampColumns,
      },
      indexes: [
        {
          name: "idx_ai_approver_runs_v02_job_id",
          fields: ["jobId"],
        },
        {
          name: "idx_ai_approver_runs_v02_status",
          fields: ["status"],
        },
        {
          name: "idx_ai_approver_runs_v02_created_at",
          fields: ["createdAt"],
        },
        {
          name: "idx_ai_approver_runs_v02_status_preview_expires_at",
          fields: ["status", "previewExpiresAt"],
        },
        {
          name: "uq_ai_approver_runs_v02_preview_token",
          fields: ["previewToken"],
          unique: true,
        },
      ],
      foreignKeys: [
        {
          columnName: "activePromptVersionId",
          referencedColumnName: "id",
          referencedTableName: "AiApproverPromptVersionsV02",
        },
      ],
    },
    {
      tableName: "AiApproverArticlePredictionsV02",
      model: models.prediction,
      columns: {
        id: { allowNull: false, kind: "integer" },
        articleId: { allowNull: false, kind: "integer" },
        promptVersionId: { allowNull: false, kind: "integer" },
        runId: { allowNull: false, kind: "integer" },
        resultStatus: { allowNull: false, kind: "string" },
        prediction: { allowNull: true, kind: "string" },
        reasoning: { allowNull: true, kind: "text" },
        errorCode: { allowNull: true, kind: "string" },
        errorMessage: { allowNull: true, kind: "text" },
        attemptCount: { allowNull: false, kind: "integer" },
        modelName: { allowNull: false, kind: "string" },
        pipelineVersion: { allowNull: false, kind: "string" },
        contentSource: { allowNull: false, kind: "string" },
        metadata: { allowNull: true, kind: "jsonb" },
        humanValidation: { allowNull: true, kind: "boolean" },
        humanComment: { allowNull: true, kind: "text" },
        ...timestampColumns,
      },
      indexes: [
        {
          name: "idx_ai_approver_article_predictions_v02_article_id",
          fields: ["articleId"],
        },
        {
          name: "idx_ai_approver_article_predictions_v02_prompt_version_id",
          fields: ["promptVersionId"],
        },
        {
          name: "idx_ai_approver_article_predictions_v02_run_id",
          fields: ["runId"],
        },
        {
          name: "idx_ai_approver_article_predictions_v02_result_status",
          fields: ["resultStatus"],
        },
        {
          name: "idx_ai_approver_article_predictions_v02_prediction",
          fields: ["prediction"],
        },
      ],
      foreignKeys: [
        {
          columnName: "articleId",
          referencedColumnName: "id",
          referencedTableName: "Articles",
        },
        {
          columnName: "promptVersionId",
          referencedColumnName: "id",
          referencedTableName: "AiApproverPromptVersionsV02",
        },
        {
          columnName: "runId",
          referencedColumnName: "id",
          referencedTableName: "AiApproverRunsV02",
        },
      ],
    },
  ];
}

function normalizeTableName(table: unknown): string {
  if (typeof table === "string") {
    return table;
  }

  if (table && typeof table === "object" && "tableName" in table) {
    return String((table as { tableName: unknown }).tableName);
  }

  return String(table);
}

function normalizeSql(value: string): string {
  return value
    .replace(/"/g, "")
    .replace(/[()]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function columnTypeMatches(actualType: string, expectedKind: ColumnKind): boolean {
  const normalized = actualType.toUpperCase();
  const matchers: Record<ColumnKind, RegExp> = {
    boolean: /\bBOOLEAN\b/,
    date: /\bTIMESTAMP\b/,
    integer: /\bINTEGER\b/,
    jsonb: /\bJSONB\b/,
    string: /\b(CHARACTER VARYING|VARCHAR)\b/,
    text: /\bTEXT\b/,
  };

  return matchers[expectedKind].test(normalized);
}

function indexFieldNames(index: DescribedIndex): string[] {
  return (index.fields ?? []).map((field) =>
    String(field.attribute ?? field.name ?? ""),
  );
}

async function validateColumns(
  queryInterface: QueryInterface,
  spec: TableSpec,
): Promise<void> {
  const described = (await queryInterface.describeTable(
    spec.tableName,
  )) as Record<string, DescribedColumn>;

  const actualNames = Object.keys(described).sort();
  const expectedNames = Object.keys(spec.columns).sort();

  if (actualNames.join("|") !== expectedNames.join("|")) {
    throw new Error(
      `${spec.tableName} has incompatible columns; expected ${expectedNames.join(", ")}, found ${actualNames.join(", ")}`,
    );
  }

  for (const [columnName, expected] of Object.entries(spec.columns)) {
    const actual = described[columnName];
    if (!actual || typeof actual.type !== "string") {
      throw new Error(`${spec.tableName}.${columnName} is missing type metadata`);
    }
    if (!columnTypeMatches(actual.type, expected.kind)) {
      throw new Error(
        `${spec.tableName}.${columnName} has incompatible type ${actual.type}`,
      );
    }
    if (Boolean(actual.allowNull) !== expected.allowNull) {
      throw new Error(
        `${spec.tableName}.${columnName} has incompatible nullability`,
      );
    }
  }
}

async function validateIndexes(
  queryInterface: QueryInterface,
  spec: TableSpec,
): Promise<void> {
  const indexes = (await queryInterface.showIndex(
    spec.tableName,
  )) as DescribedIndex[];

  for (const expected of spec.indexes) {
    const actual = indexes.find((index) => index.name === expected.name);
    if (!actual) {
      throw new Error(`${spec.tableName} is missing index ${expected.name}`);
    }

    if (Boolean(actual.unique) !== Boolean(expected.unique)) {
      throw new Error(`${spec.tableName}.${expected.name} has incompatible uniqueness`);
    }

    const actualFields = indexFieldNames(actual);
    if (actualFields.join("|") !== expected.fields.join("|")) {
      throw new Error(`${spec.tableName}.${expected.name} has incompatible fields`);
    }

    if (
      expected.predicate &&
      !normalizeSql(actual.definition ?? "").includes(expected.predicate)
    ) {
      throw new Error(`${spec.tableName}.${expected.name} has incompatible predicate`);
    }
  }
}

async function validateForeignKeys(
  queryInterface: QueryInterface,
  spec: TableSpec,
): Promise<void> {
  const references = (await queryInterface.getForeignKeyReferencesForTable(
    spec.tableName,
  )) as DescribedForeignKey[];

  for (const expected of spec.foreignKeys) {
    const found = references.some(
      (reference) =>
        reference.columnName === expected.columnName &&
        reference.referencedTableName === expected.referencedTableName &&
        reference.referencedColumnName === expected.referencedColumnName,
    );

    if (!found) {
      throw new Error(
        `${spec.tableName}.${expected.columnName} is missing its required foreign key`,
      );
    }
  }
}

async function validateTable(
  queryInterface: QueryInterface,
  spec: TableSpec,
): Promise<void> {
  await validateColumns(queryInterface, spec);
  await validateIndexes(queryInterface, spec);
  await validateForeignKeys(queryInterface, spec);
}

export async function installAiApproverV02Schema(
  dependencies: AiApproverV02SchemaInstallerDependencies = {
    initializeModels: initModels,
    models: {
      prediction: AiApproverArticlePredictionV02,
      prompt: AiApproverPromptVersionV02,
      run: AiApproverRunV02,
    },
    sequelize,
  },
): Promise<AiApproverV02SchemaInstallResult> {
  dependencies.initializeModels();

  const queryInterface = dependencies.sequelize.getQueryInterface();
  const specs = getTableSpecs(dependencies.models);
  const existingTables = new Set(
    (await queryInterface.showAllTables()).map(normalizeTableName),
  );

  if (!existingTables.has("Articles")) {
    throw new Error(
      "Missing prerequisite table Articles; initialize the base NewsNexus schema first",
    );
  }

  for (const spec of specs) {
    if (existingTables.has(spec.tableName)) {
      await validateTable(queryInterface, spec);
    }
  }

  const result: AiApproverV02SchemaInstallResult = {
    createdTables: [],
    retainedTables: [],
  };

  for (const spec of specs) {
    if (existingTables.has(spec.tableName)) {
      result.retainedTables.push(spec.tableName);
      continue;
    }

    await spec.model.sync();
    result.createdTables.push(spec.tableName);
    existingTables.add(spec.tableName);
  }

  for (const spec of specs) {
    await validateTable(queryInterface, spec);
  }

  return result;
}
