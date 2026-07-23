import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "./_connection";

export type AiApproverV02SelectionMode =
  | "article_position_count"
  | "until_last_approved";

export type AiApproverV02ContentSource =
  | "article_contents_02"
  | "description";

export type AiApproverRunV02Status =
  | "draft"
  | "expired"
  | "queued"
  | "running"
  | "completed"
  | "canceled"
  | "failed"
  | "circuit_breaker";

export interface AiApproverV02SelectionItem {
  articleId: number;
  contentSource: AiApproverV02ContentSource;
  articleContents02Id: number | null;
}

export interface AiApproverRunV02Attributes {
  id: number;
  jobId: string | null;
  activePromptVersionId: number;
  selectionMode: AiApproverV02SelectionMode;
  requestedArticleCount: number | null;
  allowPastApprovedBoundary: boolean;
  allowDescriptionFallback: boolean;
  highestArticleIdAtStart: number;
  approvedBoundaryArticleId: number | null;
  plannedEligibleCount: number;
  attemptedCount: number;
  completedCount: number;
  failedCount: number;
  invalidResponseCount: number;
  skippedCount: number;
  status: AiApproverRunV02Status;
  endingReason: string | null;
  modelName: string;
  selectionSnapshot: AiApproverV02SelectionItem[];
  previewToken: string | null;
  previewExpiresAt: Date | null;
  startedAt: Date | null;
  endedAt: Date | null;
}

interface AiApproverRunV02CreationAttributes
  extends Optional<
    AiApproverRunV02Attributes,
    | "id"
    | "jobId"
    | "requestedArticleCount"
    | "allowPastApprovedBoundary"
    | "allowDescriptionFallback"
    | "approvedBoundaryArticleId"
    | "plannedEligibleCount"
    | "attemptedCount"
    | "completedCount"
    | "failedCount"
    | "invalidResponseCount"
    | "skippedCount"
    | "status"
    | "endingReason"
    | "selectionSnapshot"
    | "previewToken"
    | "previewExpiresAt"
    | "startedAt"
    | "endedAt"
  > {}

export class AiApproverRunV02
  extends Model<AiApproverRunV02Attributes, AiApproverRunV02CreationAttributes>
  implements AiApproverRunV02Attributes
{
  public id!: number;
  public jobId!: string | null;
  public activePromptVersionId!: number;
  public selectionMode!: AiApproverV02SelectionMode;
  public requestedArticleCount!: number | null;
  public allowPastApprovedBoundary!: boolean;
  public allowDescriptionFallback!: boolean;
  public highestArticleIdAtStart!: number;
  public approvedBoundaryArticleId!: number | null;
  public plannedEligibleCount!: number;
  public attemptedCount!: number;
  public completedCount!: number;
  public failedCount!: number;
  public invalidResponseCount!: number;
  public skippedCount!: number;
  public status!: AiApproverRunV02Status;
  public endingReason!: string | null;
  public modelName!: string;
  public selectionSnapshot!: AiApproverV02SelectionItem[];
  public previewToken!: string | null;
  public previewExpiresAt!: Date | null;
  public startedAt!: Date | null;
  public endedAt!: Date | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

export function initAiApproverRunV02() {
  AiApproverRunV02.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      jobId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      activePromptVersionId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      selectionMode: {
        type: DataTypes.STRING(64),
        allowNull: false,
        validate: {
          isIn: [["article_position_count", "until_last_approved"]],
        },
      },
      requestedArticleCount: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: {
          min: 1,
        },
      },
      allowPastApprovedBoundary: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      allowDescriptionFallback: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      highestArticleIdAtStart: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: {
          min: 1,
        },
      },
      approvedBoundaryArticleId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: {
          min: 1,
        },
      },
      plannedEligibleCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        validate: {
          min: 0,
        },
      },
      attemptedCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        validate: {
          min: 0,
        },
      },
      completedCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        validate: {
          min: 0,
        },
      },
      failedCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        validate: {
          min: 0,
        },
      },
      invalidResponseCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        validate: {
          min: 0,
        },
      },
      skippedCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        validate: {
          min: 0,
        },
      },
      status: {
        type: DataTypes.STRING(64),
        allowNull: false,
        defaultValue: "draft",
        validate: {
          isIn: [[
            "draft",
            "expired",
            "queued",
            "running",
            "completed",
            "canceled",
            "failed",
            "circuit_breaker",
          ]],
        },
      },
      endingReason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      modelName: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      selectionSnapshot: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      previewToken: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      previewExpiresAt: {
        type: DataTypes.DATE,
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
    },
    {
      sequelize,
      modelName: "AiApproverRunV02",
      tableName: "AiApproverRunsV02",
      timestamps: true,
      indexes: [
        {
          name: "idx_ai_approver_runs_v02_job_id",
          fields: ["jobId"],
        },
        {
          name: "idx_ai_approver_runs_v02_status",
          fields: ["status"],
        },
        {
          name: "idx_ai_approver_runs_v02_created_at",
          fields: ["createdAt"],
        },
        {
          name: "idx_ai_approver_runs_v02_status_preview_expires_at",
          fields: ["status", "previewExpiresAt"],
        },
        {
          name: "uq_ai_approver_runs_v02_preview_token",
          unique: true,
          fields: ["previewToken"],
        },
      ],
    },
  );

  return AiApproverRunV02;
}

export default AiApproverRunV02;
