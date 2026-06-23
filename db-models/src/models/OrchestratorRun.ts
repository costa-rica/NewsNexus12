import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from './_connection';

export type OrchestratorRunStatus =
  | 'running'
  | 'completed'
  | 'completed_no_new_articles'
  | 'failed'
  | 'canceled'
  | 'timed_out';

export type OrchestratorRunMode = 'standard' | 'continuation';

interface OrchestratorRunAttributes {
  id: number;
  sourceOrchestratorRunId: number | null;
  runMode: OrchestratorRunMode;
  continuationPlan: Record<string, unknown> | null;
  status: OrchestratorRunStatus;
  startedAt: Date;
  endedAt: Date | null;
  articleIdMinExclusive: number | null;
  articleIdMaxInclusive: number | null;
  reportFilePath: string | null;
  failureReason: string | null;
  aiApproverEnabled: boolean;
  semanticScorerEnabled: boolean;
  userId: number | null;
}

interface OrchestratorRunCreationAttributes
  extends Optional<
    OrchestratorRunAttributes,
    | 'id'
    | 'sourceOrchestratorRunId'
    | 'runMode'
    | 'continuationPlan'
    | 'endedAt'
    | 'articleIdMinExclusive'
    | 'articleIdMaxInclusive'
    | 'reportFilePath'
    | 'failureReason'
    | 'userId'
  > {}

export class OrchestratorRun
  extends Model<OrchestratorRunAttributes, OrchestratorRunCreationAttributes>
  implements OrchestratorRunAttributes
{
  public id!: number;
  public sourceOrchestratorRunId!: number | null;
  public runMode!: OrchestratorRunMode;
  public continuationPlan!: Record<string, unknown> | null;
  public status!: OrchestratorRunStatus;
  public startedAt!: Date;
  public endedAt!: Date | null;
  public articleIdMinExclusive!: number | null;
  public articleIdMaxInclusive!: number | null;
  public reportFilePath!: string | null;
  public failureReason!: string | null;
  public aiApproverEnabled!: boolean;
  public semanticScorerEnabled!: boolean;
  public userId!: number | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

export function initOrchestratorRun() {
  OrchestratorRun.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      sourceOrchestratorRunId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      runMode: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'standard',
      },
      continuationPlan: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      status: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      startedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      endedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      articleIdMinExclusive: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      articleIdMaxInclusive: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      reportFilePath: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      failureReason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      aiApproverEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      semanticScorerEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'OrchestratorRun',
      tableName: 'OrchestratorRuns',
      timestamps: true,
    }
  );
  return OrchestratorRun;
}

export default OrchestratorRun;
