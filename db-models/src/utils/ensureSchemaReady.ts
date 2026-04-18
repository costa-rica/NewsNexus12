import { Sequelize } from "sequelize";

const REQUIRED_TABLES = ["Articles", "Users", "States"] as const;

export async function ensureSchemaReady(
  sequelize: Sequelize,
  requiredTables: readonly string[] = REQUIRED_TABLES,
): Promise<void> {
  await sequelize.authenticate();

  const queryInterface = sequelize.getQueryInterface();
  const rawTables = await queryInterface.showAllTables();
  const tables = rawTables.map((table) => {
    if (typeof table === "string") {
      return table;
    }

    if (table && typeof table === "object" && "tableName" in (table as Record<string, unknown>)) {
      return String((table as { tableName: string }).tableName);
    }

    return String(table);
  });

  const missingTables = requiredTables.filter((table) => !tables.includes(table));

  if (missingTables.length > 0) {
    throw new Error(
      `Database schema is missing required table(s): ${missingTables.join(", ")}. Run the bootstrap/replenish path before starting runtime services.`,
    );
  }
}

export default ensureSchemaReady;
