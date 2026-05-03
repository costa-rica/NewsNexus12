import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "./_connection";

interface AiApproverPromptVersionAttributes {
  id: number;
  name: string;
  description: string | null;
  promptInMarkdown: string;
  isActive: boolean;
  endedAt: Date | null;
  promptRole: string;
  promptKey: string | null;
  pipelineVersion: string | null;
  responseSchemaVersion: string | null;
  modelName: string | null;
}

interface AiApproverPromptVersionCreationAttributes
  extends Optional<
    AiApproverPromptVersionAttributes,
    | "id"
    | "description"
    | "isActive"
    | "endedAt"
    | "promptRole"
    | "promptKey"
    | "pipelineVersion"
    | "responseSchemaVersion"
    | "modelName"
  > {}

export class AiApproverPromptVersion
  extends Model<
    AiApproverPromptVersionAttributes,
    AiApproverPromptVersionCreationAttributes
  >
  implements AiApproverPromptVersionAttributes
{
  public id!: number;
  public name!: string;
  public description!: string | null;
  public promptInMarkdown!: string;
  public isActive!: boolean;
  public endedAt!: Date | null;
  public promptRole!: string;
  public promptKey!: string | null;
  public pipelineVersion!: string | null;
  public responseSchemaVersion!: string | null;
  public modelName!: string | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

export function initAiApproverPromptVersion() {
  AiApproverPromptVersion.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      promptInMarkdown: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      endedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      promptRole: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "category_score",
      },
      promptKey: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      pipelineVersion: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      responseSchemaVersion: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      modelName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "AiApproverPromptVersion",
      tableName: "AiApproverPromptVersions",
      timestamps: true,
      indexes: [
        {
          fields: ["isActive"],
        },
        {
          fields: ["name"],
        },
        {
          fields: ["promptRole"],
        },
        {
          fields: ["promptKey"],
        },
        {
          fields: ["pipelineVersion"],
        },
      ],
    }
  );
  return AiApproverPromptVersion;
}

export default AiApproverPromptVersion;
