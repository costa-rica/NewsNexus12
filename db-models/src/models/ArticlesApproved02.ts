import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from './_connection';

interface ArticlesApproved02Attributes {
  id: number;
  artificialIntelligenceId: number;
  articleId: number;
  isApproved: boolean;
  headlineForPdfReport: string | null;
  publicationNameForPdfReport: string | null;
  publicationDateForPdfReport: string | null;
  textForPdfReport: string | null;
  urlForPdfReport: string | null;
  kmNotes: string | null;
}

interface ArticlesApproved02CreationAttributes extends Optional<ArticlesApproved02Attributes, 'id' | 'isApproved' | 'headlineForPdfReport' | 'publicationNameForPdfReport' | 'publicationDateForPdfReport' | 'textForPdfReport' | 'urlForPdfReport' | 'kmNotes'> {}

export class ArticlesApproved02 extends Model<ArticlesApproved02Attributes, ArticlesApproved02CreationAttributes> implements ArticlesApproved02Attributes {
  public id!: number;
  public artificialIntelligenceId!: number;
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

export function initArticlesApproved02() {
  ArticlesApproved02.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      artificialIntelligenceId: {
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
      modelName: 'ArticlesApproved02',
      tableName: 'ArticlesApproved02',
      timestamps: true,
    }
  );
  return ArticlesApproved02;
}

export default ArticlesApproved02;
