import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from './_connection';

interface NewsArticleAggregatorSourceAttributes {
  id: number;
  nameOfOrg: string | null;
  url: string | null;
  apiKey: string | null;
  isApi: boolean;
  isRss: boolean;
}

interface NewsArticleAggregatorSourceCreationAttributes extends Optional<NewsArticleAggregatorSourceAttributes, 'id' | 'nameOfOrg' | 'url' | 'apiKey' | 'isApi' | 'isRss'> {}

export class NewsArticleAggregatorSource extends Model<NewsArticleAggregatorSourceAttributes, NewsArticleAggregatorSourceCreationAttributes> implements NewsArticleAggregatorSourceAttributes {
  public id!: number;
  public nameOfOrg!: string | null;
  public url!: string | null;
  public apiKey!: string | null;
  public isApi!: boolean;
  public isRss!: boolean;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

export function initNewsArticleAggregatorSource() {
  NewsArticleAggregatorSource.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      nameOfOrg: {
        type: DataTypes.STRING,
      },
      url: {
        type: DataTypes.TEXT,
      },
      apiKey: {
        type: DataTypes.STRING,
      },
      isApi: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      isRss: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
    },
    {
      sequelize,
      modelName: 'NewsArticleAggregatorSource',
      tableName: 'NewsArticleAggregatorSources',
      timestamps: true,
    }
  );
  return NewsArticleAggregatorSource;
}

export default NewsArticleAggregatorSource;