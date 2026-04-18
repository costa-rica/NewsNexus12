import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "./_connection";

// Define the Attributes Interface
interface ArticleStateContract02Attributes {
  id: number;
  articleId: number;
  stateId: number | null;
  entityWhoCategorizesId: number;
  promptId: number;
  isHumanApproved: boolean;
  isDeterminedToBeError: boolean;
  occuredInTheUS: boolean | null;
  reasoning: string | null;
}

// Define the Creation Attributes Interface
interface ArticleStateContract02CreationAttributes
  extends Optional<
    ArticleStateContract02Attributes,
    | "id"
    | "stateId"
    | "isHumanApproved"
    | "isDeterminedToBeError"
    | "occuredInTheUS"
  > {}

// Define the Class
export class ArticleStateContract02
  extends Model<
    ArticleStateContract02Attributes,
    ArticleStateContract02CreationAttributes
  >
  implements ArticleStateContract02Attributes
{
  public id!: number;
  public articleId!: number;
  public stateId!: number | null;
  public entityWhoCategorizesId!: number;
  public promptId!: number;
  public isHumanApproved!: boolean;
  public isDeterminedToBeError!: boolean;
  public occuredInTheUS!: boolean | null;
  public reasoning!: string | null;

  // Timestamps
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

// Define the initialization function
export function initArticleStateContract02() {
  ArticleStateContract02.init(
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
      stateId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      entityWhoCategorizesId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      promptId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      isHumanApproved: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      isDeterminedToBeError: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      occuredInTheUS: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
      },
      reasoning: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "ArticleStateContract02",
      tableName: "ArticleStateContracts02",
      timestamps: true,
    }
  );
  return ArticleStateContract02;
}

export default ArticleStateContract02;
