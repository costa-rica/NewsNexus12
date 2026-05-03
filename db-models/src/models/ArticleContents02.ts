import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from './_connection';

interface ArticleContents02Attributes {
  id: number;
  articleId: number;
  url: string | null;
  googleRssUrl: string;
  googleFinalUrl: string | null;
  publisherFinalUrl: string | null;
  title: string | null;
  content: string | null;
  status: string;
  failureType: string | null;
  details: string;
  extractionSource: string;
  bodySource: string;
  googleStatusCode: number | null;
  publisherStatusCode: number | null;
}

interface ArticleContents02CreationAttributes
  extends Optional<
    ArticleContents02Attributes,
    | 'id'
    | 'url'
    | 'googleFinalUrl'
    | 'publisherFinalUrl'
    | 'title'
    | 'content'
    | 'failureType'
    | 'details'
    | 'extractionSource'
    | 'bodySource'
    | 'googleStatusCode'
    | 'publisherStatusCode'
  > {}

export class ArticleContents02
  extends Model<ArticleContents02Attributes, ArticleContents02CreationAttributes>
  implements ArticleContents02Attributes
{
  public id!: number;
  public articleId!: number;
  public url!: string | null;
  public googleRssUrl!: string;
  public googleFinalUrl!: string | null;
  public publisherFinalUrl!: string | null;
  public title!: string | null;
  public content!: string | null;
  public status!: string;
  public failureType!: string | null;
  public details!: string;
  public extractionSource!: string;
  public bodySource!: string;
  public googleStatusCode!: number | null;
  public publisherStatusCode!: number | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

export function initArticleContents02() {
  ArticleContents02.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
      },
      articleId: {
        type: DataTypes.INTEGER,
        allowNull: false
      },
      url: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      googleRssUrl: {
        type: DataTypes.TEXT,
        allowNull: false
      },
      googleFinalUrl: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      publisherFinalUrl: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      title: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      content: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      status: {
        type: DataTypes.STRING,
        allowNull: false
      },
      failureType: {
        type: DataTypes.STRING,
        allowNull: true
      },
      details: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: ''
      },
      extractionSource: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'none'
      },
      bodySource: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'none'
      },
      googleStatusCode: {
        type: DataTypes.INTEGER,
        allowNull: true
      },
      publisherStatusCode: {
        type: DataTypes.INTEGER,
        allowNull: true
      }
    },
    {
      sequelize,
      modelName: 'ArticleContents02',
      tableName: 'ArticleContents02',
      timestamps: true,
      indexes: [
        { name: 'idx_article_contents02_article_id', fields: ['articleId'] },
      ]
    }
  );

  return ArticleContents02;
}

export default ArticleContents02;
