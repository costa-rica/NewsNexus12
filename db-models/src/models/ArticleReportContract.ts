import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from './_connection';

interface ArticleReportContractAttributes {
  id: number;
  reportId: number;
  articleId: number;
  articleReferenceNumberInReport: string | null;
  articleAcceptedByCpsc: boolean;
  articleRejectionReason: string | null;
}

interface ArticleReportContractCreationAttributes extends Optional<ArticleReportContractAttributes, 'id' | 'articleReferenceNumberInReport' | 'articleAcceptedByCpsc' | 'articleRejectionReason'> {}

export class ArticleReportContract extends Model<ArticleReportContractAttributes, ArticleReportContractCreationAttributes> implements ArticleReportContractAttributes {
  public id!: number;
  public reportId!: number;
  public articleId!: number;
  public articleReferenceNumberInReport!: string | null;
  public articleAcceptedByCpsc!: boolean;
  public articleRejectionReason!: string | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

export function initArticleReportContract() {
  ArticleReportContract.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      reportId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      articleId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      articleReferenceNumberInReport: {
        type: DataTypes.STRING,
      },
      articleAcceptedByCpsc: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      articleRejectionReason: {
        type: DataTypes.TEXT,
      },
    },
    {
      sequelize,
      modelName: 'ArticleReportContract',
      tableName: 'ArticleReportContracts',
      timestamps: true,
    }
  );
  return ArticleReportContract;
}

export default ArticleReportContract;