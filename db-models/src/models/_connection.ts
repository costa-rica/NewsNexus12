import { Sequelize } from "sequelize";

function readOptional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : fallback;
}

function readRequired(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function readOptionalInteger(name: string, fallback: number): number {
  const rawValue = process.env[name];
  if (!rawValue || rawValue.trim() === "") {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid integer value for ${name}: ${rawValue}`);
  }

  return parsed;
}

function readOptionalBoolean(name: string, fallback: boolean): boolean {
  const rawValue = process.env[name];
  if (!rawValue || rawValue.trim() === "") {
    return fallback;
  }

  return rawValue.trim().toLowerCase() === "true";
}

const dialect = readOptional("PG_DIALECT", "postgres");
const host = readRequired("PG_HOST");
const port = readOptionalInteger("PG_PORT", 5432);
const database = readRequired("PG_DATABASE");
const username = readRequired("PG_USER");
const password = readOptional("PG_PASSWORD", "");
const schema = readOptional("PG_SCHEMA", "public");
const logging = readOptionalBoolean("PG_LOG_SQL", false);

const sequelize = new Sequelize({
  dialect: dialect as "postgres",
  host,
  port,
  database,
  username,
  password,
  schema,
  logging,
  pool: {
    max: readOptionalInteger("PG_POOL_MAX", 10),
    min: readOptionalInteger("PG_POOL_MIN", 0),
    idle: readOptionalInteger("PG_POOL_IDLE", 10_000),
    acquire: readOptionalInteger("PG_POOL_ACQUIRE", 30_000),
  },
  dialectOptions: {
    ssl: readOptionalBoolean("PG_SSL", false) ? { require: true } : undefined,
  },
});

console.log(`database target: ${host}:${port}/${database} (${schema})`);

export { sequelize };
export default sequelize;
