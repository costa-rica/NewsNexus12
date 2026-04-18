import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from './_connection';

interface ArticleIsRelevantAttributes {
  id: number;
  userId: number;
  articleId: number;
  isRelevant: boolean;
  kmNotes: string | null;
}

interface ArticleIsRelevantCreationAttributes extends Optional<ArticleIsRelevantAttributes, 'id' | 'isRelevant' | 'kmNotes'> {}

export class ArticleIsRelevant extends Model<ArticleIsRelevantAttributes, ArticleIsRelevantCreationAttributes> implements ArticleIsRelevantAttributes {
  public id!: number;
  public userId!: number;
  public articleId!: number;
  public isRelevant!: boolean;
  public kmNotes!: string | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

export function initArticleIsRelevant() {
  ArticleIsRelevant.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      articleId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      isRelevant: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      kmNotes: {
        type: DataTypes.TEXT,
      },
    },
    {
      sequelize,
      modelName: 'ArticleIsRelevant',
      tableName: 'ArticleIsRelevants',
      timestamps: true,
    }
  );
  return ArticleIsRelevant;
}

export default ArticleIsRelevant;