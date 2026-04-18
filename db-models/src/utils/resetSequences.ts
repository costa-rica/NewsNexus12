import type { ModelStatic, Sequelize } from "sequelize";

type SequenceCapableModel = ModelStatic<any> & {
  getTableName: () => string | { tableName: string; schema?: string };
  rawAttributes?: Record<string, { autoIncrement?: boolean }>;
};

function getQualifiedTableName(model: SequenceCapableModel): string {
  const tableName = model.getTableName();
  if (typeof tableName === "string") {
    return tableName;
  }

  if (tableName.schema) {
    return `${tableName.schema}.${tableName.tableName}`;
  }

  return tableName.tableName;
}

export async function resetAllSequences(sequelize: Sequelize): Promise<void> {
  for (const model of Object.values(sequelize.models) as SequenceCapableModel[]) {
    const idAttribute = model.rawAttributes?.id;
    if (!idAttribute?.autoIncrement) {
      continue;
    }

    const tableName = getQualifiedTableName(model);

    await sequelize.query(
      `
      SELECT setval(
        pg_get_serial_sequence(:tableName, 'id'),
        COALESCE(MAX(id), 1),
        MAX(id) IS NOT NULL
      )
      FROM "${model.tableName}";
      `,
      {
        replacements: {
          tableName,
        },
      },
    );
  }
}

export default resetAllSequences;
