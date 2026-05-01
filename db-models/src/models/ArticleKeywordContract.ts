import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from './_connection';

interface ArticleKeywordContractAttributes {
  id: number;
  articleId: number;
  entityWhoCategorizesId: number;
  ranking: number;
}

interface ArticleKeywordContractCreationAttributes extends Optional<ArticleKeywordContractAttributes, 'id'> {}

export class ArticleKeywordContract extends Model<ArticleKeywordContractAttributes, ArticleKeywordContractCreationAttributes> implements ArticleKeywordContractAttributes {
  public id!: number;
  public articleId!: number;
  public entityWhoCategorizesId!: number;
  public ranking!: number;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

export function initArticleKeywordContract() {
  ArticleKeywordContract.init(
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
      entityWhoCategorizesId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      ranking: {
        type: DataTypes.FLOAT,
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: 'ArticleKeywordContract',
      tableName: 'ArticleKeywordContracts',
      timestamps: true,
      indexes: [
        { name: 'idx_article_keyword_contracts_article_id', fields: ['articleId'] },
      ],
    }
  );
  return ArticleKeywordContract;
}

export default ArticleKeywordContract;
