import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from './_connection';

interface ArticleAttributes {
  id: number;
  publicationName: string | null;
  author: string | null;
  title: string | null;
  description: string | null;
  url: string | null;
  urlToImage: string | null;
  publishedDate: string | null;
  entityWhoFoundArticleId: number | null;
  newsApiRequestId: number | null;
  newsRssRequestId: number | null;
}

interface ArticleCreationAttributes extends Optional<ArticleAttributes, 'id' | 'publicationName' | 'author' | 'title' | 'description' | 'url' | 'urlToImage' | 'publishedDate' | 'entityWhoFoundArticleId' | 'newsApiRequestId' | 'newsRssRequestId'> {}

export class Article extends Model<ArticleAttributes, ArticleCreationAttributes> implements ArticleAttributes {
  public id!: number;
  public publicationName!: string | null;
  public author!: string | null;
  public title!: string | null;
  public description!: string | null;
  public url!: string | null;
  public urlToImage!: string | null;
  public publishedDate!: string | null;
  public entityWhoFoundArticleId!: number | null;
  public newsApiRequestId!: number | null;
  public newsRssRequestId!: number | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

export function initArticle() {
  Article.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      publicationName: {
        type: DataTypes.TEXT,
      },
      author: {
        type: DataTypes.TEXT,
      },
      title: {
        type: DataTypes.TEXT,
      },
      description: {
        type: DataTypes.TEXT,
      },
      url: {
        type: DataTypes.TEXT,
      },
      urlToImage: {
        type: DataTypes.TEXT,
      },
      publishedDate: {
        type: DataTypes.DATEONLY,
      },
      entityWhoFoundArticleId: {
        type: DataTypes.INTEGER,
      },
      newsApiRequestId: {
        type: DataTypes.INTEGER,
      },
      newsRssRequestId: {
        type: DataTypes.INTEGER,
      },
    },
    {
      sequelize,
      modelName: 'Article',
      tableName: 'Articles',
      timestamps: true,
    }
  );
  return Article;
}

export default Article;