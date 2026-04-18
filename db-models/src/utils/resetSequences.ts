import type { ModelStatic, Sequelize } from "sequelize";

type SequenceCapableModel = ModelStatic<any> & {
  getTableName: () => string | { tableName: string; schema?: string };
  rawAttributes?: Record<string, { autoIncrement?: boolean }>;
};

/**
 * Returns the table name with each part double-quoted for use inside
 * pg_get_serial_sequence(). That function receives its first argument as a
 * plain string and resolves it like an identifier, so mixed-case table names
 * must be double-quoted to prevent silent lower-casing.
 *
 * e.g. public.AiApproverArticleScores → '"public"."AiApproverArticleScores"'
 */
function getPgSerialSequenceArg(model: SequenceCapableModel): string {
  const tableName = model.getTableName();
  if (typeof tableName === "string") {
    return `"${tableName}"`;
  }

  if (tableName.schema) {
    return `"${tableName.schema}"."${tableName.tableName}"`;
  }

  return `"${tableName.tableName}"`;
}

export async function resetAllSequences(sequelize: Sequelize): Promise<void> {
  for (const model of Object.values(sequelize.models) as SequenceCapableModel[]) {
    const idAttribute = model.rawAttributes?.id;
    if (!idAttribute?.autoIncrement) {
      continue;
    }

    // Table name comes from the model definition — not user input — so direct
    // interpolation is safe here.
    const pgArg = getPgSerialSequenceArg(model);

    await sequelize.query(
      `
      SELECT setval(
        pg_get_serial_sequence('${pgArg}', 'id'),
        COALESCE(MAX(id), 1),
        MAX(id) IS NOT NULL
      )
      FROM "${model.tableName}";
      `,
    );
  }
}

export default resetAllSequences;
