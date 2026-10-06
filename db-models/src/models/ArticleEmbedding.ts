import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "./_connection";

interface ArticleEmbeddingAttributes {
	id: number;
	articleId: number;
	modelName: string;
	embeddingDimension: number;
	textHash: string;
	embedding: Buffer;
}

interface ArticleEmbeddingCreationAttributes
	extends Optional<ArticleEmbeddingAttributes, "id"> {}

export class ArticleEmbedding
	extends Model<ArticleEmbeddingAttributes, ArticleEmbeddingCreationAttributes>
	implements ArticleEmbeddingAttributes
{
	public id!: number;
	public articleId!: number;
	public modelName!: string;
	public embeddingDimension!: number;
	public textHash!: string;
	public embedding!: Buffer;

	public readonly createdAt!: Date;
	public readonly updatedAt!: Date;
}

export function initArticleEmbedding() {
	ArticleEmbedding.init(
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
			modelName: {
				type: DataTypes.STRING,
				allowNull: false,
			},
			embeddingDimension: {
				type: DataTypes.INTEGER,
				allowNull: false,
			},
			textHash: {
				type: DataTypes.STRING(64),
				allowNull: false,
			},
			embedding: {
				type: DataTypes.BLOB,
				allowNull: false,
			},
		},
		{
			sequelize,
			modelName: "ArticleEmbedding",
			tableName: "ArticleEmbeddings",
			timestamps: true,
			indexes: [
				{
					name: "idx_article_embeddings_article_id_model_name",
					unique: true,
					fields: ["articleId", "modelName"],
				},
			],
		}
	);
	return ArticleEmbedding;
}

export default ArticleEmbedding;
