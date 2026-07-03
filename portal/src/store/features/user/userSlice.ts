// src/store/features/user/userSlice.ts

import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { ApprovedArticle } from "@/types/article";

const getDateDaysAgo = (daysAgo: number) => {
	const date = new Date();
	date.setDate(date.getDate() - daysAgo);
	return date.toISOString().slice(0, 10);
};

export interface RequestTableBodyParams {
	includeIsFromAutomation: boolean;
	dateLimitOnRequestMade: string | null;
}

export interface ArticleTableBodyParams {
	returnOnlyThisPublishedDateOrAfter: string | null;
	returnOnlyThisCreatedAtDateOrAfter: string | null;
	returnOnlyIsNotApproved: boolean;
	returnOnlyIsRelevant: boolean;
	limit: number;
}

export interface RequestsAnalysisTableBodyParams {
	dateRequestsLimit: string | null;
}

export interface StateItem {
	id: number;
	name: string;
	selected: boolean;
}

export interface UserState {
	token: string | null;
	username: string | null;
	email: string | null;
	userId: number | null;
	isAdmin: boolean;
	stateArray: StateItem[];
	articlesSummaryStatistics: Record<string, unknown>;
	showSummaryStatistics: boolean;
	showRecentlyApprovedByUser: boolean;
	hideIrrelevant: boolean;
	hideApproved?: boolean;
	requestTableBodyParams: RequestTableBodyParams;
	articleTableBodyParams: ArticleTableBodyParams;
	approvedArticlesArray: ApprovedArticle[];
	requestsAnalysisTableBodyParams: RequestsAnalysisTableBodyParams;
}

const initialState: UserState = {
	token: null,
	username: null,
	email: null,
	userId: null,
	isAdmin: false,
	stateArray: [],
	articlesSummaryStatistics: {},
	showSummaryStatistics: false,
	showRecentlyApprovedByUser: false,
	hideIrrelevant: false,
	hideApproved: false,
	requestTableBodyParams: {
		includeIsFromAutomation: false,
		dateLimitOnRequestMade: null,
	},
	articleTableBodyParams: {
		returnOnlyThisPublishedDateOrAfter: getDateDaysAgo(90),
		returnOnlyThisCreatedAtDateOrAfter: getDateDaysAgo(90),
		returnOnlyIsNotApproved: true,
		returnOnlyIsRelevant: true,
		limit: 20000,
	},
	approvedArticlesArray: [],
	requestsAnalysisTableBodyParams: {
		dateRequestsLimit: null,
	},
};

export const userSlice = createSlice({
	name: "user",
	initialState,
	reducers: {
		loginUser: (
			state,
			action: PayloadAction<{
				token: string;
				user: { username: string; email: string; isAdmin?: boolean; id: number };
			}>
		) => {
			state.token = action.payload.token;
			state.username = action.payload.user.username || "some_name";
			state.email = action.payload.user.email || "some_name@mail.com";
			state.userId = action.payload.user.id;
			state.isAdmin = action.payload.user.isAdmin || false;
		},

		logoutUser: (state) => {
			state.token = null;
			state.username = null;
			state.email = null;
			state.userId = null;
		},

		updateStateArray: (state, action: PayloadAction<StateItem[]>) => {
			state.stateArray = action.payload;
		},

		updateArticlesSummaryStatistics: (
			state,
			action: PayloadAction<Record<string, unknown>>
		) => {
			state.articlesSummaryStatistics = action.payload;
		},

		toggleHideIrrelevant: (state) => {
			state.hideIrrelevant = !state.hideIrrelevant;
			state.articleTableBodyParams.returnOnlyIsRelevant = state.hideIrrelevant;
		},

		toggleHideApproved: (state) => {
			state.hideApproved = !state.hideApproved;
			state.articleTableBodyParams.returnOnlyIsNotApproved = state.hideApproved;
		},

		toggleShowSummaryStatistics: (state) => {
			state.showSummaryStatistics = !state.showSummaryStatistics;
		},

		toggleShowRecentlyApprovedByUser: (state) => {
			state.showRecentlyApprovedByUser = !state.showRecentlyApprovedByUser;
		},

		updateRequestTableBodyParams: (
			state,
			action: PayloadAction<Partial<RequestTableBodyParams>>
		) => {
			state.requestTableBodyParams = {
				...state.requestTableBodyParams,
				...action.payload,
			};
		},

		updateArticleTableBodyParams: (
			state,
			action: PayloadAction<Partial<ArticleTableBodyParams>>
		) => {
			state.articleTableBodyParams = {
				...state.articleTableBodyParams,
				...action.payload,
			};
		},

		updateApprovedArticlesArray: (state, action: PayloadAction<ApprovedArticle[]>) => {
			state.approvedArticlesArray = action.payload;
		},

		logoutUserFully: (state) => {
			state.token = null;
			state.username = null;
			state.email = null;
			state.userId = null;
			state.isAdmin = false;
			state.stateArray = [];
			state.articlesSummaryStatistics = {};
			state.showSummaryStatistics = false;
			state.showRecentlyApprovedByUser = false;
			state.hideIrrelevant = false;
			state.hideApproved = false;
			state.requestTableBodyParams = {
				includeIsFromAutomation: false,
				dateLimitOnRequestMade: null,
			};
			state.articleTableBodyParams = {
				returnOnlyThisPublishedDateOrAfter: getDateDaysAgo(90),
				returnOnlyThisCreatedAtDateOrAfter: getDateDaysAgo(90),
				returnOnlyIsNotApproved: true,
				returnOnlyIsRelevant: true,
				limit: 20000,
			};
			state.approvedArticlesArray = [];
			console.log("-----> Finished Super Logout !!!");
		},

		updateRequestsAnalysisTableBodyParams: (
			state,
			action: PayloadAction<Partial<RequestsAnalysisTableBodyParams>>
		) => {
			state.requestsAnalysisTableBodyParams = {
				...state.requestsAnalysisTableBodyParams,
				...action.payload,
			};
		},
	},
});

export const {
	loginUser,
	logoutUser,
	updateStateArray,
	updateArticlesSummaryStatistics,
	toggleHideIrrelevant,
	toggleHideApproved,
	toggleShowSummaryStatistics,
	toggleShowRecentlyApprovedByUser,
	updateRequestTableBodyParams,
	updateArticleTableBodyParams,
	updateApprovedArticlesArray,
	logoutUserFully,
	updateRequestsAnalysisTableBodyParams,
} = userSlice.actions;

export default userSlice.reducer;
