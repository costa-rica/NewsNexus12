import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "./_connection";

interface AiApproverArticleScoreAttributes {
  id: number;
  articleId: number;
  promptVersionId: number;
  resultStatus: string;
  score: number | null;
  reason: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  isHumanApproved: boolean | null;
  reasonHumanRejected: string | null;
  jobId: string | null;
  promptRole: string;
  pipelineVersion: string | null;
  decision: string | null;
  confidence: number | null;
  reasonCode: string | null;
  metadata: Record<string, unknown> | null;
}

interface AiApproverArticleScoreCreationAttributes
  extends Optional<
    AiApproverArticleScoreAttributes,
    | "id"
    | "score"
    | "reason"
    | "errorCode"
    | "errorMessage"
    | "isHumanApproved"
    | "reasonHumanRejected"
    | "jobId"
    | "promptRole"
    | "pipelineVersion"
    | "decision"
    | "confidence"
    | "reasonCode"
    | "metadata"
  > {}

export class AiApproverArticleScore
  extends Model<
    AiApproverArticleScoreAttributes,
    AiApproverArticleScoreCreationAttributes
  >
  implements AiApproverArticleScoreAttributes
{
  public id!: number;
  public articleId!: number;
  public promptVersionId!: number;
  public resultStatus!: string;
  public score!: number | null;
  public reason!: string | null;
  public errorCode!: string | null;
  public errorMessage!: string | null;
  public isHumanApproved!: boolean | null;
  public reasonHumanRejected!: string | null;
  public jobId!: string | null;
  public promptRole!: string;
  public pipelineVersion!: string | null;
  public decision!: string | null;
  public confidence!: number | null;
  public reasonCode!: string | null;
  public metadata!: Record<string, unknown> | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

export function initAiApproverArticleScore() {
  AiApproverArticleScore.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      articleId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      promptVersionId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      resultStatus: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      score: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      reason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      errorCode: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      errorMessage: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      isHumanApproved: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: null,
      },
      reasonHumanRejected: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      jobId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      promptRole: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "category_score",
      },
      pipelineVersion: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      decision: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      confidence: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      reasonCode: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "AiApproverArticleScore",
      tableName: "AiApproverArticleScores",
      timestamps: true,
      indexes: [
        {
          unique: true,
          fields: ["articleId", "promptVersionId"],
        },
        {
          fields: ["articleId"],
        },
        {
          fields: ["promptVersionId"],
        },
        {
          fields: ["resultStatus"],
        },
        {
          fields: ["articleId", "promptRole"],
        },
        {
          fields: ["promptRole", "decision"],
        },
        {
          fields: ["pipelineVersion"],
        },
      ],
    }
  );
  return AiApproverArticleScore;
}

export default AiApproverArticleScore;
