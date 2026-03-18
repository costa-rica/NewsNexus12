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
      ],
    }
  );
  return AiApproverArticleScore;
}

export default AiApproverArticleScore;
