import { AiApproverArticleScore } from "./AiApproverArticleScore";
import { AiApproverPromptVersion } from "./AiApproverPromptVersion";
import { Article } from "./Article";
import { ArticleApproved } from "./ArticleApproved";
import { ArticleContent } from "./ArticleContent";
import { ArticleDuplicateAnalysis } from "./ArticleDuplicateAnalysis";
import { ArticleEntityWhoCategorizedArticleContract } from "./ArticleEntityWhoCategorizedArticleContract";
import { ArticleEntityWhoCategorizedArticleContracts02 } from "./ArticleEntityWhoCategorizedArticleContracts02";
import { ArticleIsRelevant } from "./ArticleIsRelevant";
import { ArticleKeywordContract } from "./ArticleKeywordContract";
import { ArticleReportContract } from "./ArticleReportContract";
import { ArticleReviewed } from "./ArticleReviewed";
import { ArticlesApproved02 } from "./ArticlesApproved02";
import { ArticleStateContract } from "./ArticleStateContract";
import { ArticleStateContract02 } from "./ArticleStateContract02";
import { ArtificialIntelligence } from "./ArtificialIntelligence";
import { EntityWhoCategorizedArticle } from "./EntityWhoCategorizedArticle";
import { EntityWhoFoundArticle } from "./EntityWhoFoundArticle";
import { Keyword } from "./Keyword";
import { NewsApiRequest } from "./NewsApiRequest";
import { NewsApiRequestWebsiteDomainContract } from "./NewsApiRequestWebsiteDomainContract";
import { NewsArticleAggregatorSource } from "./NewsArticleAggregatorSource";
import { NewsArticleAggregatorSourceStateContract } from "./NewsArticleAggregatorSourceStateContract";
import { NewsRssRequest } from "./NewsRssRequest";
import { Prompt } from "./Prompt";
import { Report } from "./Report";
import { State } from "./State";
import { User } from "./User";
import { WebsiteDomain } from "./WebsiteDomain";

export function applyAssociations(): void {
	// --- AI Approver associations ---
	AiApproverPromptVersion.hasMany(AiApproverArticleScore, {
		foreignKey: "promptVersionId",
	});
	AiApproverArticleScore.belongsTo(AiApproverPromptVersion, {
		foreignKey: "promptVersionId",
	});

	// --- EntityWhoCategorizedArticle associations ---
	EntityWhoCategorizedArticle.hasMany(ArticleKeywordContract, {
		foreignKey: "entityWhoCategorizesId",
	});

	ArticleKeywordContract.belongsTo(EntityWhoCategorizedArticle, {
		foreignKey: "entityWhoCategorizesId",
	});

	// --- ArtificialIntelligence associations ---
	ArtificialIntelligence.hasMany(EntityWhoCategorizedArticle, {
		foreignKey: "artificialIntelligenceId",
	});
	EntityWhoCategorizedArticle.belongsTo(ArtificialIntelligence, {
		foreignKey: "artificialIntelligenceId",
	});

	ArtificialIntelligence.hasMany(ArticlesApproved02, {
		foreignKey: "artificialIntelligenceId",
	});
	ArticlesApproved02.belongsTo(ArtificialIntelligence, {
		foreignKey: "artificialIntelligenceId",
	});

	// --- State associations ---
	State.hasMany(ArticleStateContract, { foreignKey: "stateId" });
	ArticleStateContract.belongsTo(State, { foreignKey: "stateId" });

	State.hasMany(ArticleStateContract02, { foreignKey: "stateId" });
	ArticleStateContract02.belongsTo(State, { foreignKey: "stateId" });

	// --- Prompt associations ---
	Prompt.hasMany(ArticleStateContract02, { foreignKey: "promptId" });
	ArticleStateContract02.belongsTo(Prompt, { foreignKey: "promptId" });

	// --- Report associations ---
	Report.hasMany(ArticleReportContract, { foreignKey: "reportId" });
	ArticleReportContract.belongsTo(Report, { foreignKey: "reportId" });

	// --- User associations ---
	User.hasMany(EntityWhoCategorizedArticle, { foreignKey: "userId" });
	EntityWhoCategorizedArticle.belongsTo(User, { foreignKey: "userId" });

	User.hasMany(EntityWhoFoundArticle, { foreignKey: "userId" });
	EntityWhoFoundArticle.belongsTo(User, { foreignKey: "userId" });

	User.hasMany(Report, { foreignKey: "userId" });
	Report.belongsTo(User, { foreignKey: "userId" });

	User.hasMany(ArticleReviewed, { foreignKey: "userId" });
	ArticleReviewed.belongsTo(User, { foreignKey: "userId" });

	User.hasMany(ArticleApproved, { foreignKey: "userId" });
	ArticleApproved.belongsTo(User, { foreignKey: "userId" });

	User.hasMany(ArticleIsRelevant, { foreignKey: "userId" });
	ArticleIsRelevant.belongsTo(User, { foreignKey: "userId" });

	// --- NewsArticleAggregatorSource associations ---
	NewsArticleAggregatorSource.hasOne(EntityWhoFoundArticle, {
		foreignKey: "newsArticleAggregatorSourceId",
	});
	EntityWhoFoundArticle.belongsTo(NewsArticleAggregatorSource, {
		foreignKey: "newsArticleAggregatorSourceId",
	});

	NewsArticleAggregatorSource.hasMany(NewsApiRequest, {
		foreignKey: "newsArticleAggregatorSourceId",
	});
	NewsApiRequest.belongsTo(NewsArticleAggregatorSource, {
		foreignKey: "newsArticleAggregatorSourceId",
	});

	NewsArticleAggregatorSource.hasMany(NewsRssRequest, {
		foreignKey: "newsArticleAggregatorSourceId",
	});
	NewsRssRequest.belongsTo(NewsArticleAggregatorSource, {
		foreignKey: "newsArticleAggregatorSourceId",
	});

	// --- Article associations ---
	Article.hasMany(ArticleStateContract, { foreignKey: "articleId" });
	ArticleStateContract.belongsTo(Article, { foreignKey: "articleId" });

	Article.hasMany(ArticleKeywordContract, { foreignKey: "articleId" });
	ArticleKeywordContract.belongsTo(Article, { foreignKey: "articleId" });

	Article.hasMany(ArticleContent, { foreignKey: "articleId" });
	ArticleContent.belongsTo(Article, { foreignKey: "articleId" });

	Article.hasMany(ArticleReportContract, { foreignKey: "articleId" });
	ArticleReportContract.belongsTo(Article, { foreignKey: "articleId" });

	Article.hasMany(ArticleReviewed, { foreignKey: "articleId" });
	ArticleReviewed.belongsTo(Article, { foreignKey: "articleId" });

	Article.hasMany(ArticleApproved, { foreignKey: "articleId" });
	ArticleApproved.belongsTo(Article, { foreignKey: "articleId" });

	Article.hasMany(ArticleIsRelevant, { foreignKey: "articleId" });
	ArticleIsRelevant.belongsTo(Article, { foreignKey: "articleId" });

	Article.hasMany(ArticlesApproved02, { foreignKey: "articleId" });
	ArticlesApproved02.belongsTo(Article, { foreignKey: "articleId" });

	Article.hasMany(ArticleStateContract02, { foreignKey: "articleId" });
	ArticleStateContract02.belongsTo(Article, { foreignKey: "articleId" });

	Article.hasMany(AiApproverArticleScore, { foreignKey: "articleId" });
	AiApproverArticleScore.belongsTo(Article, { foreignKey: "articleId" });

	// --- ArticleDuplicateAnalysis associations ---
	Article.hasMany(ArticleDuplicateAnalysis, {
		foreignKey: "articleIdNew",
		as: "newArticleDuplicateAnalyses"
	});
	ArticleDuplicateAnalysis.belongsTo(Article, {
		foreignKey: "articleIdNew",
		as: "newArticle"
	});

	Article.hasMany(ArticleDuplicateAnalysis, {
		foreignKey: "articleIdApproved",
		as: "approvedArticleDuplicateAnalyses"
	});
	ArticleDuplicateAnalysis.belongsTo(Article, {
		foreignKey: "articleIdApproved",
		as: "approvedArticle"
	});

	// --- EntityWhoFoundArticle associations ---
	EntityWhoFoundArticle.hasMany(Article, {
		foreignKey: "entityWhoFoundArticleId",
	});
	Article.belongsTo(EntityWhoFoundArticle, {
		foreignKey: "entityWhoFoundArticleId",
	});

	// --- NewsArticleAggregatorSourceStateContract associations ---
	NewsArticleAggregatorSource.hasMany(
		NewsArticleAggregatorSourceStateContract,
		{
			foreignKey: "newsArticleAggregatorSourceId",
		}
	);
	NewsArticleAggregatorSourceStateContract.belongsTo(
		NewsArticleAggregatorSource,
		{
			foreignKey: "newsArticleAggregatorSourceId",
		}
	);

	State.hasMany(NewsArticleAggregatorSourceStateContract, {
		foreignKey: "stateId",
	});
	NewsArticleAggregatorSourceStateContract.belongsTo(State, {
		foreignKey: "stateId",
	});

	// --- Article has many to many State (through ArticleStateContract) ---
	Article.belongsToMany(State, {
		through: ArticleStateContract,
		foreignKey: "articleId",
	});
	State.belongsToMany(Article, {
		through: ArticleStateContract,
		foreignKey: "stateId",
	});

	// --- NewsApiRequest 0/1 to Many Articles ---
	NewsApiRequest.hasMany(Article, { foreignKey: "newsApiRequestId" });
	Article.belongsTo(NewsApiRequest, { foreignKey: "newsApiRequestId" });

	// --- NewsRssRequest 0/1 to Many Articles ---
	NewsRssRequest.hasMany(Article, { foreignKey: "newsRssRequestId" });
	Article.belongsTo(NewsRssRequest, { foreignKey: "newsRssRequestId" });

	// --- NewsApiRequestWebsiteDomainContract associations: create a many to many relationship between NewsApiRequest and WebsiteDomain ---
	NewsApiRequest.hasMany(NewsApiRequestWebsiteDomainContract, {
		foreignKey: "newsApiRequestId",
	});
	NewsApiRequestWebsiteDomainContract.belongsTo(NewsApiRequest, {
		foreignKey: "newsApiRequestId",
	});

	WebsiteDomain.hasMany(NewsApiRequestWebsiteDomainContract, {
		foreignKey: "websiteDomainId",
	});
	NewsApiRequestWebsiteDomainContract.belongsTo(WebsiteDomain, {
		foreignKey: "websiteDomainId",
	});

	// --- Article has many to many EntityWhoCategorizedArticle (through ArticleEntityWhoCategorizedArticleContract) ---
	Article.hasMany(ArticleEntityWhoCategorizedArticleContract, {
		foreignKey: "articleId",
	});
	ArticleEntityWhoCategorizedArticleContract.belongsTo(Article, {
		foreignKey: "articleId",
	});

	EntityWhoCategorizedArticle.hasMany(
		ArticleEntityWhoCategorizedArticleContract,
		{
			foreignKey: "entityWhoCategorizesId",
		}
	);
	ArticleEntityWhoCategorizedArticleContract.belongsTo(
		EntityWhoCategorizedArticle,
		{
			foreignKey: "entityWhoCategorizesId",
		}
	);

	// --- Article has many to many EntityWhoCategorizedArticle (through ArticleEntityWhoCategorizedArticleContracts02) ---
	Article.hasMany(ArticleEntityWhoCategorizedArticleContracts02, {
		foreignKey: "articleId",
	});
	ArticleEntityWhoCategorizedArticleContracts02.belongsTo(Article, {
		foreignKey: "articleId",
	});

	EntityWhoCategorizedArticle.hasMany(
		ArticleEntityWhoCategorizedArticleContracts02,
		{
			foreignKey: "entityWhoCategorizesId",
		}
	);
	ArticleEntityWhoCategorizedArticleContracts02.belongsTo(
		EntityWhoCategorizedArticle,
		{
			foreignKey: "entityWhoCategorizesId",
		}
	);

	// --- EntityWhoCategorizedArticle associations with ArticleStateContract02 ---
	EntityWhoCategorizedArticle.hasMany(ArticleStateContract02, {
		foreignKey: "entityWhoCategorizesId",
	});
	ArticleStateContract02.belongsTo(EntityWhoCategorizedArticle, {
		foreignKey: "entityWhoCategorizesId",
	});

	console.log("✅ Associations have been set up");
}
