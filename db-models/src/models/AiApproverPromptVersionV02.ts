import { DataTypes, Model, Op, Optional } from "sequelize";
import { sequelize } from "./_connection";

export interface AiApproverPromptVersionV02Attributes {
  id: number;
  title: string | null;
  promptInMarkdown: string;
  isActive: boolean;
  firstUsedAt: Date | null;
}

interface AiApproverPromptVersionV02CreationAttributes
  extends Optional<
    AiApproverPromptVersionV02Attributes,
    "id" | "title" | "isActive" | "firstUsedAt"
  > {}

export class AiApproverPromptVersionV02
  extends Model<
    AiApproverPromptVersionV02Attributes,
    AiApproverPromptVersionV02CreationAttributes
  >
  implements AiApproverPromptVersionV02Attributes
{
  public id!: number;
  public title!: string | null;
  public promptInMarkdown!: string;
  public isActive!: boolean;
  public firstUsedAt!: Date | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

export function initAiApproverPromptVersionV02() {
  AiApproverPromptVersionV02.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      title: {
        type: DataTypes.STRING,
        allowNull: true,
        set(value: string | null) {
          const normalized = value?.trim() ?? "";
          this.setDataValue("title", normalized.length > 0 ? normalized : null);
        },
      },
      promptInMarkdown: {
        type: DataTypes.TEXT,
        allowNull: false,
        validate: {
          notEmpty: true,
        },
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      firstUsedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "AiApproverPromptVersionV02",
      tableName: "AiApproverPromptVersionsV02",
      timestamps: true,
      indexes: [
        {
          name: "uq_ai_approver_prompt_versions_v02_title_nonnull",
          unique: true,
          fields: ["title"],
          where: {
            title: {
              [Op.ne]: null,
            },
          },
        },
        {
          name: "uq_ai_approver_prompt_versions_v02_single_active",
          unique: true,
          fields: ["isActive"],
          where: {
            isActive: true,
          },
        },
        {
          name: "idx_ai_approver_prompt_versions_v02_is_active",
          fields: ["isActive"],
        },
      ],
    },
  );

  return AiApproverPromptVersionV02;
}

export default AiApproverPromptVersionV02;
