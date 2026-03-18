// State Assignment type
export interface StateAssignment {
	promptId: number;
	isHumanApproved: boolean;
	isDeterminedToBeError: boolean;
	occuredInTheUS: boolean;
	reasoning: string;
	stateId: number;
	stateName: string;
}

// Shared Article type for the application
export interface Article {
	id: number;
	title: string;
	publicationName: string;
	publishedDate: string;
	description: string;
	url: string;
	content?: string;
	isApproved?: boolean;
	isBeingReviewed?: boolean;
	isRelevant?: boolean;
	States?: Array<{ id: number; name: string }>;
	statesStringCommaSeparated?: string;
	requestQueryString?: string;
	nameOfOrg?: string;
	semanticRatingMax?: number | string;
	locationClassifierScore?: number | string;
	aiApproverTopScore?: number | null;
	aiApproverTopScoreId?: number | null;
	aiApproverTopPromptVersionId?: number | null;
	aiApproverTopPromptName?: string | null;
	stateAssignment?: StateAssignment | null;
}

export interface AiApproverPromptVersion {
	id: number;
	name: string;
	description: string | null;
	promptInMarkdown: string;
	isActive: boolean;
	endedAt: string | null;
}

export interface AiApproverScoreRow {
	id: number;
	articleId: number;
	promptVersionId: number;
	resultStatus: "completed" | "failed" | "invalid_response" | string;
	score: number | null;
	reason: string | null;
	errorCode: string | null;
	errorMessage: string | null;
	isHumanApproved: boolean | null;
	reasonHumanRejected: string | null;
	createdAt: string;
	updatedAt: string;
	promptVersion: AiApproverPromptVersion | null;
}

export interface AiApproverArticleDetailsResponse {
	result: boolean;
	articleId: number;
	topEligibleScoreId: number | null;
	scores: AiApproverScoreRow[];
}

// Article Report Contract (junction table between articles and reports)
export interface ArticleReportContract {
	id: number;
	articleId: number;
	reportId: number;
	articleReferenceNumberInReport: string;
	isAccepted: boolean;
	rejectionReason?: string | null;
}

// Approved Article type for reports page (extends Article with report-specific fields)
export interface ApprovedArticle extends Article {
	stageArticleForReport: boolean;
	isSubmitted?: boolean;
	stateAbbreviation?: string;
	articleHasBeenAcceptedByAll?: boolean;
	ArticleReportContracts: ArticleReportContract[];
}

// Request type for article requests analysis page
export interface ArticleRequest {
	id: number;
	nameOfOrg: string;
	andString: string;
	orString?: string;
	notString?: string;
	includeOrExcludeDomainsString?: string;
	countOfApprovedArticles: number;
}

// Unassigned article type for count by state analysis
export interface UnassignedArticle {
	id: number;
	title: string;
	url: string;
}

// State count data type - uses Record for dynamic column keys
export type StateCountData = Record<string, string | number>;

// ArticleApproved record from AI approval system
export interface ArticleApproved {
	id: number;
	artificialIntelligenceId: number;
	createdAt: string;
	isApproved: boolean;
	headlineForPdfReport: string;
	publicationNameForPdfReport: string;
	publicationDateForPdfReport: string;
	textForPdfReport: string;
	urlForPdfReport: string;
	kmNotes: string;
}

// ChatGPT Approved Article type for ChatGPT analysis page
export interface ChatGPTApprovedArticle extends Article {
	author?: string;
	urlToImage?: string;
	entityWhoFoundArticleId?: number;
	newsApiRequestId?: number | null;
	newsRssRequestId?: number | null;
	createdAt?: string;
	stateAbbreviation?: string;
	ArticlesApproved02: ArticleApproved[];
	ArticleApprovedsIsApproved?: number | null;
}

// State Assigner types
export interface StateAssignerArticle {
	id: number;
	title: string;
	description: string;
	url: string;
	createdAt: string;
	publishedDate: string;
	semanticRatingMax: number | null;
	semanticRatingMaxLabel: string | null;
	locationClassifierScore: number | null;
	locationClassifierScoreLabel: string | null;
	stateAssignment: StateAssignment;
}

export interface StateAssignerResponse {
	result: boolean;
	message: string;
	count: number;
	articles: StateAssignerArticle[];
}

// Article details types for state assigner modal
export interface StateInfo {
	id: number;
	name: string;
}

export interface StateAiApproved {
	promptId: number;
	isHumanApproved: boolean;
	reasoning: string;
	state: StateInfo;
}

export interface ArticleDetailsResponse {
	articleId: number;
	title: string;
	description?: string;
	url: string;
	content?: string;
	stateHumanApprovedArray?: StateInfo[];
	stateAiApproved?: StateAiApproved;
}

// Human verify response type
export interface HumanVerifyResponse {
	status: string;
	stateHumanApprovedArray: StateInfo[];
	stateAiApproved: StateAiApproved;
}

// Google RSS Article type (from /google-rss/make-request endpoint)
export interface GoogleRssArticle {
	title: string;
	link: string;
	description: string;
	source: string;
	pubDate: string;
	content?: string;
	selected?: boolean; // For UI selection state
}

// Google RSS Make Request Response
export interface GoogleRssMakeRequestResponse {
	success: boolean;
	url?: string;
	articlesArray?: GoogleRssArticle[];
	count?: number;
	error?: string;
	message?: string;
}

// Google RSS Add to Database Request Body
export interface GoogleRssAddToDatabaseRequest {
	articlesArray: GoogleRssArticle[];
	url: string;
	and_keywords?: string;
	and_exact_phrases?: string;
	or_keywords?: string;
	or_exact_phrases?: string;
	time_range?: string;
}
