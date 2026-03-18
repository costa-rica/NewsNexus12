import { sequelize } from "./_connection";

import {
	initAiApproverArticleScore,
	AiApproverArticleScore,
} from "./AiApproverArticleScore";
import {
	initAiApproverPromptVersion,
	AiApproverPromptVersion,
} from "./AiApproverPromptVersion";
import { initArticle, Article } from "./Article";
import { initArticleApproved, ArticleApproved } from "./ArticleApproved";
import { initArticleContent, ArticleContent } from "./ArticleContent";
import {
	initArticleDuplicateAnalysis,
	ArticleDuplicateAnalysis,
} from "./ArticleDuplicateAnalysis";
import {
	initArticleEntityWhoCategorizedArticleContract,
	ArticleEntityWhoCategorizedArticleContract,
} from "./ArticleEntityWhoCategorizedArticleContract";
import {
	initArticleEntityWhoCategorizedArticleContracts02,
	ArticleEntityWhoCategorizedArticleContracts02,
} from "./ArticleEntityWhoCategorizedArticleContracts02";
import { initArticleIsRelevant, ArticleIsRelevant } from "./ArticleIsRelevant";
import {
	initArticleKeywordContract,
	ArticleKeywordContract,
} from "./ArticleKeywordContract";
import {
	initArticleReportContract,
	ArticleReportContract,
} from "./ArticleReportContract";
import { initArticleReviewed, ArticleReviewed } from "./ArticleReviewed";
import {
	initArticlesApproved02,
	ArticlesApproved02,
} from "./ArticlesApproved02";
import {
	initArticleStateContract,
	ArticleStateContract,
} from "./ArticleStateContract";
import {
	initArticleStateContract02,
	ArticleStateContract02,
} from "./ArticleStateContract02";
import {
	initArtificialIntelligence,
	ArtificialIntelligence,
} from "./ArtificialIntelligence";
import {
	initEntityWhoCategorizedArticle,
	EntityWhoCategorizedArticle,
} from "./EntityWhoCategorizedArticle";
import {
	initEntityWhoFoundArticle,
	EntityWhoFoundArticle,
} from "./EntityWhoFoundArticle";
import { initKeyword, Keyword } from "./Keyword";
import { initNewsApiRequest, NewsApiRequest } from "./NewsApiRequest";
import {
	initNewsApiRequestWebsiteDomainContract,
	NewsApiRequestWebsiteDomainContract,
} from "./NewsApiRequestWebsiteDomainContract";
import {
	initNewsArticleAggregatorSource,
	NewsArticleAggregatorSource,
} from "./NewsArticleAggregatorSource";
import {
	initNewsArticleAggregatorSourceStateContract,
	NewsArticleAggregatorSourceStateContract,
} from "./NewsArticleAggregatorSourceStateContract";
import { initNewsRssRequest, NewsRssRequest } from "./NewsRssRequest";
import { initPrompt, Prompt } from "./Prompt";
import { initReport, Report } from "./Report";
import { initState, State } from "./State";
import { initUser, User } from "./User";
import { initWebsiteDomain, WebsiteDomain } from "./WebsiteDomain";

import { applyAssociations } from "./_associations";

export function initModels() {
	initAiApproverArticleScore();
	initAiApproverPromptVersion();
	initArticle();
	initArticleApproved();
	initArticleContent();
	initArticleDuplicateAnalysis();
	initArticleEntityWhoCategorizedArticleContract();
	initArticleEntityWhoCategorizedArticleContracts02();
	initArticleIsRelevant();
	initArticleKeywordContract();
	initArticleReportContract();
	initArticleReviewed();
	initArticlesApproved02();
	initArticleStateContract();
	initArticleStateContract02();
	initArtificialIntelligence();
	initEntityWhoCategorizedArticle();
	initEntityWhoFoundArticle();
	initKeyword();
	initNewsApiRequest();
	initNewsApiRequestWebsiteDomainContract();
	initNewsArticleAggregatorSource();
	initNewsArticleAggregatorSourceStateContract();
	initNewsRssRequest();
	initPrompt();
	initReport();
	initState();
	initUser();
	initWebsiteDomain();

	applyAssociations();

	return {
		sequelize,
		AiApproverArticleScore,
		AiApproverPromptVersion,
		Article,
		ArticleApproved,
		ArticleContent,
		ArticleDuplicateAnalysis,
		ArticleEntityWhoCategorizedArticleContract,
		ArticleEntityWhoCategorizedArticleContracts02,
		ArticleIsRelevant,
		ArticleKeywordContract,
		ArticleReportContract,
		ArticleReviewed,
		ArticlesApproved02,
		ArticleStateContract,
		ArticleStateContract02,
		ArtificialIntelligence,
		EntityWhoCategorizedArticle,
		EntityWhoFoundArticle,
		Keyword,
		NewsApiRequest,
		NewsApiRequestWebsiteDomainContract,
		NewsArticleAggregatorSource,
		NewsArticleAggregatorSourceStateContract,
		NewsRssRequest,
		Prompt,
		Report,
		State,
		User,
		WebsiteDomain,
	};
}

export {
	sequelize,
	AiApproverArticleScore,
	AiApproverPromptVersion,
	Article,
	ArticleApproved,
	ArticleContent,
	ArticleDuplicateAnalysis,
	ArticleEntityWhoCategorizedArticleContract,
	ArticleEntityWhoCategorizedArticleContracts02,
	ArticleIsRelevant,
	ArticleKeywordContract,
	ArticleReportContract,
	ArticleReviewed,
	ArticlesApproved02,
	ArticleStateContract,
	ArticleStateContract02,
	ArtificialIntelligence,
	EntityWhoCategorizedArticle,
	EntityWhoFoundArticle,
	Keyword,
	NewsApiRequest,
	NewsApiRequestWebsiteDomainContract,
	NewsArticleAggregatorSource,
	NewsArticleAggregatorSourceStateContract,
	NewsRssRequest,
	Prompt,
	Report,
	State,
	User,
	WebsiteDomain,
};
