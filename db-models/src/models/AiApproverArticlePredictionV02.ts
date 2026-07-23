import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "./_connection";
import type { AiApproverV02ContentSource } from "./AiApproverRunV02";

export type AiApproverV02Prediction = "approved" | "irrelevant";
export type AiApproverV02ResultStatus =
  | "completed"
  | "failed"
  | "invalid_response";

export interface AiApproverArticlePredictionV02Attributes {
  id: number;
  articleId: number;
  promptVersionId: number;
  runId: number;
  resultStatus: AiApproverV02ResultStatus;
  prediction: AiApproverV02Prediction | null;
  reasoning: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  attemptCount: number;
  modelName: string;
  pipelineVersion: string;
  contentSource: AiApproverV02ContentSource;
  metadata: Record<string, unknown> | null;
  humanValidation: boolean | null;
  humanComment: string | null;
}

interface AiApproverArticlePredictionV02CreationAttributes
  extends Optional<
    AiApproverArticlePredictionV02Attributes,
    | "id"
    | "prediction"
    | "reasoning"
    | "errorCode"
    | "errorMessage"
    | "attemptCount"
    | "metadata"
    | "humanValidation"
    | "humanComment"
  > {}

export class AiApproverArticlePredictionV02
  extends Model<
    AiApproverArticlePredictionV02Attributes,
    AiApproverArticlePredictionV02CreationAttributes
  >
  implements AiApproverArticlePredictionV02Attributes
{
  public id!: number;
  public articleId!: number;
  public promptVersionId!: number;
  public runId!: number;
  public resultStatus!: AiApproverV02ResultStatus;
  public prediction!: AiApproverV02Prediction | null;
  public reasoning!: string | null;
  public errorCode!: string | null;
  public errorMessage!: string | null;
  public attemptCount!: number;
  public modelName!: string;
  public pipelineVersion!: string;
  public contentSource!: AiApproverV02ContentSource;
  public metadata!: Record<string, unknown> | null;
  public humanValidation!: boolean | null;
  public humanComment!: string | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

export function initAiApproverArticlePredictionV02() {
  AiApproverArticlePredictionV02.init(
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
      runId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      resultStatus: {
        type: DataTypes.STRING(64),
        allowNull: false,
        validate: {
          isIn: [["completed", "failed", "invalid_response"]],
        },
      },
      prediction: {
        type: DataTypes.STRING(32),
        allowNull: true,
        validate: {
          isIn: [["approved", "irrelevant"]],
        },
      },
      reasoning: {
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
      attemptCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
        validate: {
          min: 1,
          max: 2,
        },
      },
      modelName: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      pipelineVersion: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      contentSource: {
        type: DataTypes.STRING(64),
        allowNull: false,
        validate: {
          isIn: [["article_contents_02", "description"]],
        },
      },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      humanValidation: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: null,
      },
      humanComment: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "AiApproverArticlePredictionV02",
      tableName: "AiApproverArticlePredictionsV02",
      timestamps: true,
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
      validate: {
        outcomeConsistency() {
          const row = this as unknown as AiApproverArticlePredictionV02;
          const reasoning = row.reasoning?.trim() ?? "";

          if (row.resultStatus === "completed") {
            if (row.prediction === null || reasoning.length === 0) {
              throw new Error(
                "completed predictions require a prediction and nonblank reasoning",
              );
            }
            return;
          }

          if (row.prediction !== null) {
            throw new Error("non-completed predictions require a null prediction");
          }
        },
      },
    },
  );

  return AiApproverArticlePredictionV02;
}

export default AiApproverArticlePredictionV02;
