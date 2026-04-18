import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from './_connection';

interface ArticleApprovedAttributes {
  id: number;
  userId: number;
  articleId: number;
  isApproved: boolean;
  headlineForPdfReport: string | null;
  publicationNameForPdfReport: string | null;
  publicationDateForPdfReport: string | null;
  textForPdfReport: string | null;
  urlForPdfReport: string | null;
  kmNotes: string | null;
}

interface ArticleApprovedCreationAttributes extends Optional<ArticleApprovedAttributes, 'id' | 'isApproved' | 'headlineForPdfReport' | 'publicationNameForPdfReport' | 'publicationDateForPdfReport' | 'textForPdfReport' | 'urlForPdfReport' | 'kmNotes'> {}

export class ArticleApproved extends Model<ArticleApprovedAttributes, ArticleApprovedCreationAttributes> implements ArticleApprovedAttributes {
  public id!: number;
  public userId!: number;
  public articleId!: number;
  public isApproved!: boolean;
  public headlineForPdfReport!: string | null;
  public publicationNameForPdfReport!: string | null;
  public publicationDateForPdfReport!: string | null;
  public textForPdfReport!: string | null;
  public urlForPdfReport!: string | null;
  public kmNotes!: string | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

export function initArticleApproved() {
  ArticleApproved.init(
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
      isApproved: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      headlineForPdfReport: {
        type: DataTypes.TEXT,
      },
      publicationNameForPdfReport: {
        type: DataTypes.STRING,
      },
      publicationDateForPdfReport: {
        type: DataTypes.DATEONLY,
      },
      textForPdfReport: {
        type: DataTypes.TEXT,
      },
      urlForPdfReport: {
        type: DataTypes.TEXT,
      },
      kmNotes: {
        type: DataTypes.TEXT,
      },
    },
    {
      sequelize,
      modelName: 'ArticleApproved',
      tableName: 'ArticleApproveds',
      timestamps: true,
    }
  );
  return ArticleApproved;
}

export default ArticleApproved;