import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from './_connection';

export type OrchestratorRunStepName =
  | 'delete_articles'
  | 'google_rss'
  | 'state_assigner'
  | 'ai_approver'
  | 'semantic_scorer'
  | 'report';

export type OrchestratorRunStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timed_out'
  | 'canceled'
  | 'skipped';

interface OrchestratorRunStepAttributes {
  id: number;
  orchestratorRunId: number;
  stepName: OrchestratorRunStepName;
  stepOrder: number;
  enabled: boolean;
  status: OrchestratorRunStepStatus;
  childJobId: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  result: Record<string, unknown> | null;
  endingReason: string | null;
  endingMessage: string | null;
}

interface OrchestratorRunStepCreationAttributes
  extends Optional<
    OrchestratorRunStepAttributes,
    | 'id'
    | 'childJobId'
    | 'startedAt'
    | 'endedAt'
    | 'result'
    | 'endingReason'
    | 'endingMessage'
  > {}

export class OrchestratorRunStep
  extends Model<OrchestratorRunStepAttributes, OrchestratorRunStepCreationAttributes>
  implements OrchestratorRunStepAttributes
{
  public id!: number;
  public orchestratorRunId!: number;
  public stepName!: OrchestratorRunStepName;
  public stepOrder!: number;
  public enabled!: boolean;
  public status!: OrchestratorRunStepStatus;
  public childJobId!: string | null;
  public startedAt!: Date | null;
  public endedAt!: Date | null;
  public result!: Record<string, unknown> | null;
  public endingReason!: string | null;
  public endingMessage!: string | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

export function initOrchestratorRunStep() {
  OrchestratorRunStep.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      orchestratorRunId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      stepName: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      stepOrder: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
      },
      status: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      childJobId: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },
      startedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      endedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      result: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      endingReason: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      endingMessage: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'OrchestratorRunStep',
      tableName: 'OrchestratorRunSteps',
      timestamps: true,
    }
  );
  return OrchestratorRunStep;
}

export default OrchestratorRunStep;
