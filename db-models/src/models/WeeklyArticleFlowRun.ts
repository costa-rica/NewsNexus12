import { DataTypes, Model, Op, Optional } from "sequelize";
import { sequelize } from "./_connection";

export type WeeklyArticleFlowMode =
  | "dev_canary"
  | "dev_destructive_recovery"
  | "manual_production"
  | "scheduled_production";

export type WeeklyArticleFlowStatus =
  | "pending"
  | "running"
  | "completed"
  | "completed_no_new_articles"
  | "failed"
  | "failed_worker_result_contract"
  | "failure_rss_rate_limited"
  | "failure_rss_cohort_mismatch"
  | "failure_state_assigner_circuit_breaker"
  | "failure_ai_approver_v02"
  | "timed_out"
  | "canceled";

export type WeeklyArticleFlowStageResult = Record<string, unknown>;

export interface WeeklyArticleFlowRunAttributes {
  id: number;
  mode: WeeklyArticleFlowMode;
  status: WeeklyArticleFlowStatus;
  currentStage: string;
  scheduledFor: Date | null;
  startedAt: Date;
  endedAt: Date | null;
  host: string;
  sourceRevision: string;
  rssArticlesAddedCount: number | null;
  cohortArticleCount: number | null;
  stageResults: Record<string, WeeklyArticleFlowStageResult>;
  failureReason: string | null;
  jsonlFilePath: string | null;
}

interface WeeklyArticleFlowRunCreationAttributes
  extends Optional<
    WeeklyArticleFlowRunAttributes,
    | "id"
    | "status"
    | "currentStage"
    | "scheduledFor"
    | "startedAt"
    | "endedAt"
    | "rssArticlesAddedCount"
    | "cohortArticleCount"
    | "stageResults"
    | "failureReason"
    | "jsonlFilePath"
  > {}

const MODES: WeeklyArticleFlowMode[] = [
  "dev_canary",
  "dev_destructive_recovery",
  "manual_production",
  "scheduled_production",
];

const STATUSES: WeeklyArticleFlowStatus[] = [
  "pending",
  "running",
  "completed",
  "completed_no_new_articles",
  "failed",
  "failed_worker_result_contract",
  "failure_rss_rate_limited",
  "failure_rss_cohort_mismatch",
  "failure_state_assigner_circuit_breaker",
  "failure_ai_approver_v02",
  "timed_out",
  "canceled",
];

export class WeeklyArticleFlowRun
  extends Model<
    WeeklyArticleFlowRunAttributes,
    WeeklyArticleFlowRunCreationAttributes
  >
  implements WeeklyArticleFlowRunAttributes
{
  public id!: number;
  public mode!: WeeklyArticleFlowMode;
  public status!: WeeklyArticleFlowStatus;
  public currentStage!: string;
  public scheduledFor!: Date | null;
  public startedAt!: Date;
  public endedAt!: Date | null;
  public host!: string;
  public sourceRevision!: string;
  public rssArticlesAddedCount!: number | null;
  public cohortArticleCount!: number | null;
  public stageResults!: Record<string, WeeklyArticleFlowStageResult>;
  public failureReason!: string | null;
  public jsonlFilePath!: string | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

export function initWeeklyArticleFlowRun() {
  WeeklyArticleFlowRun.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      mode: {
        type: DataTypes.STRING(64),
        allowNull: false,
        validate: { isIn: [MODES] },
      },
      status: {
        type: DataTypes.STRING(64),
        allowNull: false,
        defaultValue: "pending",
        validate: { isIn: [STATUSES] },
      },
      currentStage: {
        type: DataTypes.STRING(128),
        allowNull: false,
        defaultValue: "preflight",
        validate: { notEmpty: true },
      },
      scheduledFor: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      startedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      endedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      host: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: { notEmpty: true },
      },
      sourceRevision: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: { notEmpty: true },
      },
      rssArticlesAddedCount: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { min: 0 },
      },
      cohortArticleCount: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { min: 0 },
      },
      stageResults: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      failureReason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      jsonlFilePath: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "WeeklyArticleFlowRun",
      tableName: "WeeklyArticleFlowRuns",
      timestamps: true,
      indexes: [
        {
          name: "idx_weekly_article_flow_runs_status",
          fields: ["status"],
        },
        {
          name: "idx_weekly_article_flow_runs_scheduled_for",
          fields: ["scheduledFor"],
        },
        {
          name: "idx_weekly_article_flow_runs_created_at",
          fields: ["createdAt"],
        },
        {
          name: "uq_weekly_article_flow_runs_single_active",
          fields: [sequelize.literal("(1)")],
          unique: true,
          where: {
            status: { [Op.in]: ["pending", "running"] },
          },
        },
      ],
    },
  );

  return WeeklyArticleFlowRun;
}

export default WeeklyArticleFlowRun;
