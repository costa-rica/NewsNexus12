import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from './_connection';

interface NewsApiRequestAttributes {
  id: number;
  newsArticleAggregatorSourceId: number;
  countOfArticlesReceivedFromRequest: number | null;
  countOfArticlesSavedToDbFromRequest: number | null;
  countOfArticlesAvailableFromRequest: number | null;
  dateStartOfRequest: string | null;
  dateEndOfRequest: string | null;
  status: string | null;
  url: string | null;
  andString: string | null;
  orString: string | null;
  notString: string | null;
  isFromAutomation: boolean;
}

interface NewsApiRequestCreationAttributes extends Optional<NewsApiRequestAttributes, 'id' | 'countOfArticlesReceivedFromRequest' | 'countOfArticlesSavedToDbFromRequest' | 'countOfArticlesAvailableFromRequest' | 'dateStartOfRequest' | 'dateEndOfRequest' | 'status' | 'url' | 'andString' | 'orString' | 'notString' | 'isFromAutomation'> {}

export class NewsApiRequest extends Model<NewsApiRequestAttributes, NewsApiRequestCreationAttributes> implements NewsApiRequestAttributes {
  public id!: number;
  public newsArticleAggregatorSourceId!: number;
  public countOfArticlesReceivedFromRequest!: number | null;
  public countOfArticlesSavedToDbFromRequest!: number | null;
  public countOfArticlesAvailableFromRequest!: number | null;
  public dateStartOfRequest!: string | null;
  public dateEndOfRequest!: string | null;
  public status!: string | null;
  public url!: string | null;
  public andString!: string | null;
  public orString!: string | null;
  public notString!: string | null;
  public isFromAutomation!: boolean;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

export function initNewsApiRequest() {
  NewsApiRequest.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    newsArticleAggregatorSourceId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    countOfArticlesReceivedFromRequest: {
      type: DataTypes.INTEGER,
    },
    countOfArticlesSavedToDbFromRequest: {
      type: DataTypes.INTEGER,
    },
    countOfArticlesAvailableFromRequest: {
      type: DataTypes.INTEGER,
    },
    dateStartOfRequest: {
      type: DataTypes.DATEONLY,
    },
    dateEndOfRequest: {
      type: DataTypes.DATEONLY,
    },
    status: {
      type: DataTypes.STRING,
    },
    url: {
      type: DataTypes.TEXT,
    },
    andString: {
      type: DataTypes.TEXT,
    },
    orString: {
      type: DataTypes.TEXT,
    },
    notString: {
      type: DataTypes.TEXT,
    },
    isFromAutomation: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
  },
  {
    sequelize,
    modelName: 'NewsApiRequest',
    tableName: 'NewsApiRequests',
    timestamps: true,
  }
  );
  return NewsApiRequest;
}

export default NewsApiRequest;