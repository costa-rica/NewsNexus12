import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "./_connection";

export type WeeklyArticleFlowPhaseData = Record<string, unknown>;
export type WeeklyArticleFlowErrorData = Record<string, unknown>;

export interface WeeklyArticleFlowRun02Attributes {
  id: number;
  runStartedAt: Date;
  runCompleted: boolean;
  runCompletedAt: Date | null;
  lastPhaseStarted: number | null;
  lastPhaseCompleted: number | null;
  phaseData: WeeklyArticleFlowPhaseData;
  lastError: WeeklyArticleFlowErrorData | null;
  backupPath: string | null;
  backupByteSize: string | null;
  backupSha256: string | null;
  backupManifestVersion: number | null;
  firstRssRequestId: number | null;
  firstRssArticleId: number | null;
  rssArticlesAddedCount: number | null;
  articleCount: number | null;
  rssJobId: string | null;
  semanticScorerJobId: string | null;
  stateAssignerJobId: string | null;
  aiApproverV02JobId: string | null;
  targetArticleThresholdDaysOld: number | null;
}

type WeeklyArticleFlowRun02CreationAttributes = Optional<
  WeeklyArticleFlowRun02Attributes,
  | "id"
  | "runCompleted"
  | "runCompletedAt"
  | "lastPhaseStarted"
  | "lastPhaseCompleted"
  | "phaseData"
  | "lastError"
  | "backupPath"
  | "backupByteSize"
  | "backupSha256"
  | "backupManifestVersion"
  | "firstRssRequestId"
  | "firstRssArticleId"
  | "rssArticlesAddedCount"
  | "articleCount"
  | "rssJobId"
  | "semanticScorerJobId"
  | "stateAssignerJobId"
  | "aiApproverV02JobId"
  | "targetArticleThresholdDaysOld"
>;

const requireJsonObject = (value: unknown): void => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("must be a JSON object");
  }
};

const requireJsonObjectOrNull = (value: unknown): void => {
  if (value === null) return;
  requireJsonObject(value);
};

export class WeeklyArticleFlowRun02
  extends Model<
    WeeklyArticleFlowRun02Attributes,
    WeeklyArticleFlowRun02CreationAttributes
  >
  implements WeeklyArticleFlowRun02Attributes
{
  public id!: number;
  public runStartedAt!: Date;
  public runCompleted!: boolean;
  public runCompletedAt!: Date | null;
  public lastPhaseStarted!: number | null;
  public lastPhaseCompleted!: number | null;
  public phaseData!: WeeklyArticleFlowPhaseData;
  public lastError!: WeeklyArticleFlowErrorData | null;
  public backupPath!: string | null;
  public backupByteSize!: string | null;
  public backupSha256!: string | null;
  public backupManifestVersion!: number | null;
  public firstRssRequestId!: number | null;
  public firstRssArticleId!: number | null;
  public rssArticlesAddedCount!: number | null;
  public articleCount!: number | null;
  public rssJobId!: string | null;
  public semanticScorerJobId!: string | null;
  public stateAssignerJobId!: string | null;
  public aiApproverV02JobId!: string | null;
  public targetArticleThresholdDaysOld!: number | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

export function initWeeklyArticleFlowRun02() {
  WeeklyArticleFlowRun02.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      runStartedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      runCompleted: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      runCompletedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null,
      },
      lastPhaseStarted: {
        type: DataTypes.SMALLINT,
        allowNull: true,
        defaultValue: null,
        validate: { isInt: true, min: 1, max: 7 },
      },
      lastPhaseCompleted: {
        type: DataTypes.SMALLINT,
        allowNull: true,
        defaultValue: null,
        validate: { isInt: true, min: 1, max: 7 },
      },
      phaseData: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
        validate: { isJsonObject: requireJsonObject },
      },
      lastError: {
        type: DataTypes.JSONB,
        allowNull: true,
        defaultValue: null,
        validate: { isJsonObjectOrNull: requireJsonObjectOrNull },
      },
      backupPath: {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: null,
      },
      backupByteSize: {
        type: DataTypes.BIGINT,
        allowNull: true,
        defaultValue: null,
      },
      backupSha256: {
        type: DataTypes.STRING(64),
        allowNull: true,
        defaultValue: null,
        validate: { is: /^[a-f0-9]{64}$/ },
      },
      backupManifestVersion: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: null,
        validate: { isInt: true, min: 1 },
      },
      firstRssRequestId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: null,
        validate: { isInt: true, min: 1 },
      },
      firstRssArticleId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: null,
        validate: { isInt: true, min: 1 },
      },
      rssArticlesAddedCount: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: null,
        validate: { isInt: true, min: 0 },
      },
      articleCount: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: null,
        validate: { isInt: true, min: 0 },
      },
      rssJobId: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null,
      },
      semanticScorerJobId: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null,
      },
      stateAssignerJobId: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null,
      },
      aiApproverV02JobId: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null,
      },
      targetArticleThresholdDaysOld: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: null,
        validate: { isInt: true, min: 1 },
      },
    },
    {
      sequelize,
      tableName: "WeeklyArticleFlowRuns02",
      timestamps: true,
      validate: {
        completedPhaseWasStarted(this: WeeklyArticleFlowRun02) {
          if (
            this.lastPhaseCompleted !== null &&
            (this.lastPhaseStarted === null ||
              this.lastPhaseCompleted > this.lastPhaseStarted)
          ) {
            throw new Error("lastPhaseCompleted must not exceed lastPhaseStarted");
          }
        },
        completionTimestampMatchesState(this: WeeklyArticleFlowRun02) {
          if (this.runCompleted !== (this.runCompletedAt !== null)) {
            throw new Error("runCompleted and runCompletedAt must be set together");
          }
        },
      },
    },
  );

  return WeeklyArticleFlowRun02;
}
