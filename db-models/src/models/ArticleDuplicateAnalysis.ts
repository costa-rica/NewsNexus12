import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "./_connection";

interface ArticleDuplicateAnalysisAttributes {
	id: number;
	articleIdNew: number;
	articleIdApproved: number;
	reportId: number | null;
	sameArticleIdFlag: number;
	articleNewState: string;
	articleApprovedState: string;
	sameStateFlag: number;
	urlCheck: number;
	contentHash: number;
	embeddingSearch: number;
}

interface ArticleDuplicateAnalysisCreationAttributes
	extends Optional<ArticleDuplicateAnalysisAttributes, "id" | "reportId"> {}

export class ArticleDuplicateAnalysis
	extends Model<
		ArticleDuplicateAnalysisAttributes,
		ArticleDuplicateAnalysisCreationAttributes
	>
	implements ArticleDuplicateAnalysisAttributes
{
	public id!: number;
	public articleIdNew!: number;
	public articleIdApproved!: number;
	public reportId!: number | null;
	public sameArticleIdFlag!: number;
	public articleNewState!: string;
	public articleApprovedState!: string;
	public sameStateFlag!: number;
	public urlCheck!: number;
	public contentHash!: number;
	public embeddingSearch!: number;

	public readonly createdAt!: Date;
	public readonly updatedAt!: Date;
}

export function initArticleDuplicateAnalysis() {
	ArticleDuplicateAnalysis.init(
		{
			id: {
				type: DataTypes.INTEGER,
				autoIncrement: true,
				primaryKey: true,
			},
			articleIdNew: {
				type: DataTypes.INTEGER,
				allowNull: false,
			},
			articleIdApproved: {
				type: DataTypes.INTEGER,
				allowNull: false,
			},
			reportId: {
				type: DataTypes.INTEGER,
				allowNull: true,
			},
			sameArticleIdFlag: {
				type: DataTypes.INTEGER,
			},
			articleNewState: {
				type: DataTypes.STRING,
			},
			articleApprovedState: {
				type: DataTypes.STRING,
			},
			sameStateFlag: {
				type: DataTypes.INTEGER,
			},
			urlCheck: {
				type: DataTypes.INTEGER,
			},
			contentHash: {
				type: DataTypes.FLOAT,
			},
			embeddingSearch: {
				type: DataTypes.FLOAT,
			},
		},
		{
			sequelize,
			modelName: "ArticleDuplicateAnalysis",
			tableName: "ArticleDuplicateAnalyses",
			timestamps: true,
			indexes: [
				{
					name: "idx_article_duplicate_analyses_article_id_new",
					fields: ["articleIdNew"],
				},
				{
					name: "idx_article_duplicate_analyses_article_id_approved",
					fields: ["articleIdApproved"],
				},
			],
		}
	);
	return ArticleDuplicateAnalysis;
}

export default ArticleDuplicateAnalysis;
