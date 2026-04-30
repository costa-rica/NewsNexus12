import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from './_connection';

export type OrchestratorRunStatus =
  | 'running'
  | 'completed'
  | 'completed_no_new_articles'
  | 'failed'
  | 'canceled'
  | 'timed_out';

interface OrchestratorRunAttributes {
  id: number;
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
