"use client";
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { SummaryStatistics } from "@/components/common/SummaryStatistics";
import { RecentlyApprovedByUser } from "@/components/common/RecentlyApprovedByUser";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { updateStateArray } from "@/store/features/user/userSlice";
import Input from "@/components/form/input/InputField";
import TextArea from "@/components/form/input/TextArea";
import MultiSelect from "@/components/form/MultiSelect";
import TableReviewArticles from "@/components/tables/TableReviewArticles";
import type { Article } from "@/types/article";
import {
	toggleHideApproved,
	toggleHideIrrelevant,
	toggleShowSummaryStatistics,
	toggleShowRecentlyApprovedByUser,
	updateArticleTableBodyParams,
} from "@/store/features/user/userSlice";
import { Modal } from "@/components/ui/modal";
import { ModalInformationOk } from "@/components/ui/modal/ModalInformationOk";
import ModalStateAssignerDetails from "@/components/ui/modal/ModalStateAssignerDetails";
import ModalAiApproverDetails from "@/components/ui/modal/ModalAiApproverDetails";
import ModalReviewArticleContent from "@/components/ui/modal/ModalReviewArticleContent";

type AiApproverTopScoreMap = Record<
	string,
	{
		id: number;
		articleId: number;
		promptVersionId: number;
		score: number | null;
		resultStatus: string;
		promptName: string | null;
	}
>;

export default function ReviewArticles() {
	const dispatch = useAppDispatch();
	const { token, stateArray = [] } = useAppSelector((state) => state.user);
	const [articlesArray, setArticlesArray] = useState<Article[]>([]);
	const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
	const [stateAssignerArticleId, setStateAssignerArticleId] = useState<number | null>(null);
	const [aiApproverArticleId, setAiApproverArticleId] = useState<number | null>(null);
	const [reviewArticleContentArticleId, setReviewArticleContentArticleId] =
		useState<number | null>(null);
	const userReducer = useAppSelector((s) => s.user);
	const [loadingComponents, setLoadingComponents] = useState({
		table01: false,
	});
	const [allowUpdateSelectedArticle] = useState(true);
	const [hasFilterChanges, setHasFilterChanges] = useState(false);
	const [alertModal, setAlertModal] = useState<{
		show: boolean;
		variant: "success" | "error";
		title: string;
		message: string;
	}>({
		show: false,
		variant: "success",
		title: "",
		message: "",
	});

	// Track initial filter values to detect changes - use ref so we can update it
	const initialFiltersRef = React.useRef({
		returnOnlyThisPublishedDateOrAfter:
			userReducer.articleTableBodyParams?.returnOnlyThisPublishedDateOrAfter ?? null,
		returnOnlyThisCreatedAtDateOrAfter:
			userReducer.articleTableBodyParams?.returnOnlyThisCreatedAtDateOrAfter ?? null,
		returnOnlyIsNotApproved:
			userReducer.articleTableBodyParams?.returnOnlyIsNotApproved ?? true,
		returnOnlyIsRelevant:
			userReducer.articleTableBodyParams?.returnOnlyIsRelevant ?? true,
	});

	// Check if filters have changed
	useEffect(() => {
		if (!userReducer.articleTableBodyParams) {
			setHasFilterChanges(false);
			return;
		}
		const changed =
			userReducer.articleTableBodyParams.returnOnlyThisPublishedDateOrAfter !==
				initialFiltersRef.current.returnOnlyThisPublishedDateOrAfter ||
			userReducer.articleTableBodyParams.returnOnlyThisCreatedAtDateOrAfter !==
				initialFiltersRef.current.returnOnlyThisCreatedAtDateOrAfter ||
			userReducer.articleTableBodyParams.returnOnlyIsNotApproved !==
				initialFiltersRef.current.returnOnlyIsNotApproved ||
			userReducer.articleTableBodyParams.returnOnlyIsRelevant !==
				initialFiltersRef.current.returnOnlyIsRelevant;
		setHasFilterChanges(changed);
	}, [userReducer.articleTableBodyParams]);

	// Transform stateArray for MultiSelect component
	const stateOptions = stateArray.map((state) => ({
		value: state.id.toString(),
		text: state.name,
		selected: state.selected || false,
	}));

	const selectedStateValues = stateOptions
		.filter((opt) => opt.selected)
		.map((opt) => opt.value);

	const handleStateChange = (selectedValues: string[]) => {
		const updatedStateArray = stateArray.map((state) => ({
			...state,
			selected: selectedValues.includes(state.id.toString()),
		}));
		dispatch(updateStateArray(updatedStateArray));
	};

	// Filter articles based on hideIrrelevant setting
	const filteredArticlesArray = useMemo(() => {
		return userReducer.hideIrrelevant
			? articlesArray.filter((article) => article.isRelevant !== false)
			: articlesArray;
	}, [articlesArray, userReducer.hideIrrelevant]);

	const handleValidateState = async () => {
		if (!selectedArticle) return;

		const selectedStateIds = stateArray
			.filter((st) => st.selected)
			.map((st) => st.id);

		try {
			const response = await fetch(
				`${process.env.NEXT_PUBLIC_API_BASE_URL}/states/${selectedArticle.id}`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${token}`,
					},
					body: JSON.stringify({ stateIdArray: selectedStateIds }),
				}
			);

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Server Error: ${errorText}`);
			}

			const result = await response.json();
			console.log("State validated:", result);

			// Show success alert
			setAlertModal({
				show: true,
				variant: "success",
				title: "Success",
				message: "State successfully validated and updated!",
			});
		} catch (error) {
			console.error("Error validating states:", error);
			setAlertModal({
				show: true,
				variant: "error",
				title: "Error",
				message: "Failed to validate state. Please try again.",
			});
		}
	};

	const handleApproveArticle = async () => {
		if (!selectedArticle) return;

		const bodyObj = {
			approvedStatus: selectedArticle.isApproved ? "Un-approve" : "Approve",
			isApproved: !selectedArticle.isApproved,
			headlineForPdfReport: selectedArticle.title,
			publicationNameForPdfReport: selectedArticle.publicationName,
			publicationDateForPdfReport: selectedArticle.publishedDate,
			textForPdfReport: selectedArticle.content || "",
			urlForPdfReport: selectedArticle.url || "",
			kmNotes: "",
		};

		try {
			const response = await fetch(
				`${process.env.NEXT_PUBLIC_API_BASE_URL}/articles/approve/${selectedArticle.id}`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${token}`,
					},
					body: JSON.stringify(bodyObj),
				}
			);

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Server Error: ${errorText}`);
			}

			const result = await response.json();
			console.log("Article approved:", result);

			// Update selectedArticle
			const newApprovedStatus = !selectedArticle.isApproved;
			setSelectedArticle({
				...selectedArticle,
				isApproved: newApprovedStatus,
			});

			// Update articlesArray so table row color changes
			setArticlesArray((prevArray) =>
				prevArray.map((article) =>
					article.id === selectedArticle.id
						? { ...article, isApproved: newApprovedStatus }
						: article
				)
			);
		} catch (error) {
			console.error("Error approving article:", error);
		}
	};

	const handleUpdateContent = async () => {
		if (!selectedArticle) return;

		try {
			const response = await fetch(
				`${process.env.NEXT_PUBLIC_API_BASE_URL}/articles/update-approved`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${token}`,
					},
					body: JSON.stringify({
						articleId: selectedArticle.id,
						contentToUpdate: selectedArticle.content,
					}),
				}
			);

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Server Error: ${errorText}`);
			}

			const result = await response.json();
			console.log("Content updated:", result);

			setAlertModal({
				show: true,
				variant: "success",
				title: "Success",
				message: "Article content successfully updated!",
			});
		} catch (error) {
			console.error("Error updating content:", error);
			setAlertModal({
				show: true,
				variant: "error",
				title: "Error",
				message: "Failed to update article content. Please try again.",
			});
		}
	};

	const mergeAiApproverTopScores = useCallback(
		(articles: Article[], topScores: AiApproverTopScoreMap = {}) =>
			articles.map((article) => {
				const scoreRow = topScores[String(article.id)];
				return {
					...article,
					aiApproverTopScore: scoreRow?.score ?? null,
					aiApproverTopScoreId: scoreRow?.id ?? null,
					aiApproverTopPromptVersionId: scoreRow?.promptVersionId ?? null,
					aiApproverTopPromptName: scoreRow?.promptName ?? null,
					aiApproverTopResultStatus: scoreRow?.resultStatus ?? null,
				};
			}),
		[]
	);

	const fetchAiApproverTopScores = useCallback(
		async (articleIds: number[]) => {
			if (!token || articleIds.length === 0) {
				return {};
			}

			const response = await fetch(
				`${process.env.NEXT_PUBLIC_API_BASE_URL}/analysis/ai-approver/top-scores`,
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${token}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ articleIds }),
				}
			);

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Server Error: ${errorText}`);
			}

			const result = await response.json();
			return (result.topScores || {}) as AiApproverTopScoreMap;
		},
		[token]
	);

	const fetchArticlesArray = async () => {
		const bodyParams = {
			...(userReducer.articleTableBodyParams || {
				returnOnlyThisPublishedDateOrAfter: null,
				returnOnlyThisCreatedAtDateOrAfter: null,
				returnOnlyIsNotApproved: true,
				returnOnlyIsRelevant: true,
			}),
			// entityWhoCategorizesIdSemantic: 1,
			semanticScorerEntityName: "NewsNexusSemanticScorer02",
		};

		try {
			setLoadingComponents((prev) => ({
				...prev,
				table01: true,
			}));
			const response = await fetch(
				`${process.env.NEXT_PUBLIC_API_BASE_URL}/articles/with-ratings`,
				{
					headers: {
						Authorization: `Bearer ${userReducer.token}`,
						"Content-Type": "application/json",
					},
					method: "POST",
					body: JSON.stringify(bodyParams),
				}
			);

			console.log(`Response status: ${response.status}`);

			if (!response.ok) {
				const errorText = await response.text(); // Log response text for debugging
				throw new Error(`Server Error: ${errorText}`);
			}

			const result = await response.json();
			console.log("Fetched Data:", result);

			if (result.articlesArray && Array.isArray(result.articlesArray)) {
				const articleIds = result.articlesArray.map((article: Article) => article.id);
				const topScores = await fetchAiApproverTopScores(articleIds);
				setArticlesArray(mergeAiApproverTopScores(result.articlesArray, topScores));
			} else {
				setArticlesArray([]);
			}
		} catch (error) {
			console.error("Error fetching data:", error);
			setArticlesArray([]);
		}
		setLoadingComponents((prev) => ({
			...prev,
			table01: false,
		}));
	};

	const handleAiApproverArticleUpdate = useCallback(
		async (articleId: number) => {
			try {
				const topScores = await fetchAiApproverTopScores([articleId]);
				setArticlesArray((prevArray) =>
					mergeAiApproverTopScores(prevArray, topScores)
				);
			} catch (error) {
				console.error("Error refreshing AI approver top score:", error);
			}
		},
		[fetchAiApproverTopScores, mergeAiApproverTopScores]
	);

	const updateStateArrayWithArticleState = useCallback(
		(article: Article) => {
			if (!article?.States || !userReducer.stateArray) {
				return;
			}
			const articleStateIds = article.States.map((state) => state.id);
			const tempStatesArray = userReducer.stateArray.map((stateObj) => {
				if (articleStateIds.includes(stateObj.id)) {
					return { ...stateObj, selected: true };
				} else {
					return { ...stateObj, selected: false };
				}
			});
			dispatch(updateStateArray(tempStatesArray));
		},
		[dispatch, userReducer.stateArray]
	);

	// Fetch articles only on initial mount
	useEffect(() => {
		fetchArticlesArray();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		if (!allowUpdateSelectedArticle) return;
		const filteredArticles = userReducer.hideIrrelevant
			? articlesArray.filter((article) => article.isRelevant !== false)
			: articlesArray;

		if (filteredArticles.length > 0) {
			void handleSelectArticleFromTable(filteredArticles[0]);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [allowUpdateSelectedArticle, articlesArray, userReducer.hideIrrelevant]);

	const handleSelectArticleFromTable = async (article: Article) => {
		console.log("Selected article:", article);

		try {
			const [approvedResponse, contentResponse] = await Promise.all([
				fetch(
					`${process.env.NEXT_PUBLIC_API_BASE_URL}/articles/get-approved/${article.id}`,
					{
						headers: { Authorization: `Bearer ${token}` },
					}
				),
				fetch(
					`${process.env.NEXT_PUBLIC_API_BASE_URL}/articles/review-selected-content/${article.id}`,
					{
						headers: { Authorization: `Bearer ${token}` },
					}
				),
			]);

			if (!approvedResponse.ok) {
				const errorText = await approvedResponse.text();
				throw new Error(`Server Error: ${errorText}`);
			}

			if (!contentResponse.ok) {
				const errorText = await contentResponse.text();
				throw new Error(`Server Error: ${errorText}`);
			}

			const result = await approvedResponse.json();
			const contentResult = (await contentResponse.json()) as {
				hasArticleContent?: boolean;
				content?: string | null;
			};
			console.log("Fetched approved article data:", result);
			console.log("Fetched selected article content:", contentResult);

			const selectedContent =
				contentResult.hasArticleContent && typeof contentResult.content === "string"
					? contentResult.content
					: null;

			if (result.article && result.article.id) {
				setSelectedArticle({
					...result.article,
					...article,
					approved: result.result,
					content: selectedContent ?? result.content,
					isApproved: true, // Mark as approved
				});
				updateStateArrayWithArticleState(result.article);
			} else {
				setSelectedArticle({
					...article,
					content: selectedContent ?? article.description,
					isApproved: false,
				});
				updateStateArrayWithArticleState(article);
			}
		} catch (error) {
			console.error("Error fetching approved article:", error);
			setSelectedArticle({
				...article,
				content: article.description,
			});
			updateStateArrayWithArticleState(article);
		}
	};

	const handleClickIsReviewed = async (articleId: number) => {
		console.log("Clicked is reviewed for article:", articleId);
		try {
			const currentArticle = articlesArray.find(
				(article) => article.id === articleId
			);
			if (!currentArticle) return;

			const response = await fetch(
				`${process.env.NEXT_PUBLIC_API_BASE_URL}/articles/is-being-reviewed/${articleId}`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${token}`,
					},
					body: JSON.stringify({
						isBeingReviewed: !currentArticle.isBeingReviewed,
					}),
				}
			);

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Server Error: ${errorText}`);
			}

			// Toggle the isBeingReviewed status in the array
			const updatedArticle = {
				...currentArticle,
				isBeingReviewed: !currentArticle.isBeingReviewed,
			};

			setArticlesArray(
				articlesArray.map((article) =>
					article.id === articleId ? updatedArticle : article
				)
			);

			// Update selected article if it matches
			if (selectedArticle?.id === articleId) {
				setSelectedArticle(updatedArticle);
			}

			console.log("Successfully toggled isBeingReviewed");
		} catch (error) {
			console.error("Error toggling isBeingReviewed:", error);
		}
	};

	const handleClickIsRelevant = async (articleId: number) => {
		console.log("Clicked is relevant for article:", articleId);
		try {
			const response = await fetch(
				`${process.env.NEXT_PUBLIC_API_BASE_URL}/articles/user-toggle-is-not-relevant/${articleId}`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${token}`,
					},
				}
			);

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Server Error: ${errorText}`);
			}

			// Toggle the isRelevant status in the array
			const currentArticle = articlesArray.find(
				(article) => article.id === articleId
			);
			if (!currentArticle) return;

			const updatedArticle = {
				...currentArticle,
				isRelevant: !currentArticle.isRelevant,
			};

			setArticlesArray(
				articlesArray.map((article) =>
					article.id === articleId ? updatedArticle : article
				)
			);

			// Update selected article if it matches
			if (selectedArticle?.id === articleId) {
				setSelectedArticle(updatedArticle);
			}

			console.log("Successfully toggled isRelevant");
		} catch (error) {
			console.error("Error toggling isRelevant:", error);
		}
	};

	const handleRefreshWithFilters = () => {
		if (!userReducer.articleTableBodyParams) return;

		// Update the ref to current filter values
		initialFiltersRef.current = {
			returnOnlyThisPublishedDateOrAfter:
				userReducer.articleTableBodyParams.returnOnlyThisPublishedDateOrAfter,
			returnOnlyThisCreatedAtDateOrAfter:
				userReducer.articleTableBodyParams.returnOnlyThisCreatedAtDateOrAfter,
			returnOnlyIsNotApproved:
				userReducer.articleTableBodyParams.returnOnlyIsNotApproved,
			returnOnlyIsRelevant:
				userReducer.articleTableBodyParams.returnOnlyIsRelevant,
		};
		fetchArticlesArray();
		setHasFilterChanges(false);
	};

	const handleStateAssignerArticleUpdate = (articleId: number, isHumanApproved: boolean) => {
		// Update the articlesArray with the new isHumanApproved status
		setArticlesArray((prevArray) =>
			prevArray.map((article) =>
				article.id === articleId && article.stateAssignment
					? {
							...article,
							stateAssignment: {
								...article.stateAssignment,
								isHumanApproved,
							},
					  }
					: article
			)
		);
	};

	return (
		<div className="flex flex-col gap-4 md:gap-6">
			<h1 className="text-title-xl text-gray-700 dark:text-gray-300">
				Review Articles
			</h1>

			{/* Summary Statistics Toggle Button - only show when stats are hidden */}
			{!userReducer.showSummaryStatistics && (
				<div className="flex items-center gap-3">
					<button
						onClick={() => dispatch(toggleShowSummaryStatistics())}
						className="rounded-lg bg-brand-500 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 dark:bg-brand-600 dark:hover:bg-brand-700"
					>
						Show Summary Statistics
					</button>
				</div>
			)}

			{/* Conditionally render Summary Statistics with close button */}
			{userReducer.showSummaryStatistics && (
				<SummaryStatistics onClose={() => dispatch(toggleShowSummaryStatistics())} />
			)}

			{/* Recently Approved By User Toggle Button - only show when component is hidden */}
			{!userReducer.showRecentlyApprovedByUser && (
				<div className="flex items-center gap-3">
					<button
						onClick={() => dispatch(toggleShowRecentlyApprovedByUser())}
						className="rounded-lg bg-brand-500 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 dark:bg-brand-600 dark:hover:bg-brand-700"
					>
						Show Recently Approved by Me
					</button>
				</div>
			)}

			{/* Conditionally render Recently Approved By User with close button */}
			{userReducer.showRecentlyApprovedByUser && (
				<RecentlyApprovedByUser
					onClose={() => dispatch(toggleShowRecentlyApprovedByUser())}
				/>
			)}

			{/* Article Approval Form */}
			<div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
				<div className="mb-6 flex items-center gap-2">
					<h2 className="text-title-md font-semibold text-gray-800 dark:text-white/90">
						Article Approval Details
					</h2>
					{selectedArticle && (
						<span className="text-sm text-gray-500 dark:text-gray-400">
							(article Id: {selectedArticle.id})
						</span>
					)}
				</div>

				<div className="grid grid-cols-1 gap-6">
					{/* Headline */}
					<div>
						<label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
							Headline
						</label>
						<Input
							type="text"
							value={selectedArticle?.title || ""}
							disabled
							placeholder="No article selected"
						/>
					</div>

					{/* Publication */}
					<div>
						<label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
							Publication
						</label>
						<Input
							type="text"
							value={selectedArticle?.publicationName || ""}
							disabled
							placeholder="No article selected"
						/>
					</div>

					{/* Publication Date */}
					<div>
						<label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
							Publication Date
						</label>
						<Input
							type="date"
							value={selectedArticle?.publishedDate || ""}
							disabled
						/>
					</div>

					{/* Article State */}
					<div>
						<MultiSelect
							label="Article State"
							options={stateOptions}
							defaultSelected={selectedStateValues}
							onChange={handleStateChange}
						/>
						<button
							onClick={handleValidateState}
							disabled={!selectedArticle}
							className="mt-3 rounded-lg bg-brand-500 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-brand-600 dark:hover:bg-brand-700"
						>
							Validate State
						</button>
					</div>

					{/* Content */}
					<div>
						<label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
							Content
						</label>
						<TextArea
							rows={8}
							value={
								selectedArticle?.content || selectedArticle?.description || ""
							}
							onChange={(value) =>
								setSelectedArticle(
									selectedArticle
										? { ...selectedArticle, content: value }
										: null
								)
							}
							disabled={!selectedArticle}
							placeholder="Article content will appear here"
						/>
					</div>

					{/* Action Buttons */}
					<div className="flex gap-3">
						<button
							onClick={handleApproveArticle}
							disabled={!selectedArticle}
							className={`rounded-lg px-6 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
								selectedArticle?.isApproved
									? "bg-gray-500 hover:bg-gray-600 dark:bg-gray-600 dark:hover:bg-gray-700"
									: "bg-brand-500 hover:bg-brand-600 dark:bg-brand-600 dark:hover:bg-brand-700"
							}`}
						>
							{selectedArticle?.isApproved ? "Un-approve" : "Approve"}
						</button>
						{selectedArticle?.isApproved && (
							<button
								onClick={handleUpdateContent}
								className="rounded-lg bg-brand-500 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 dark:bg-brand-600 dark:hover:bg-brand-700"
							>
								Update Content
							</button>
						)}
					</div>
				</div>
			</div>

			{/* Filter Controls */}
			<div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
				<h3 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">
					Filter Articles
				</h3>
				<div className="flex flex-col gap-4">
					{/* Date Filters */}
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						{/* Database Date Limit */}
						<div className="relative group">
							<label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
								Database Date Limit
								<span className="ml-1 text-xs text-gray-500 dark:text-gray-500 cursor-help">
									ⓘ
								</span>
							</label>
							<span className="invisible group-hover:visible absolute left-0 top-full mt-1 px-3 py-2 bg-gray-800 text-white text-xs rounded-lg z-10 max-w-xs whitespace-normal">
								Limits downloading articles added to the Nexus News Database
								before this date
							</span>
							<Input
								type="date"
								value={
									userReducer.articleTableBodyParams
										?.returnOnlyThisCreatedAtDateOrAfter || ""
								}
								onChange={(e) =>
									dispatch(
										updateArticleTableBodyParams({
											returnOnlyThisCreatedAtDateOrAfter:
												e.target.value || null,
										})
									)
								}
							/>
						</div>

						{/* Published Date Limit */}
						<div className="relative group">
							<label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
								Published Date Limit
								<span className="ml-1 text-xs text-gray-500 dark:text-gray-500 cursor-help">
									ⓘ
								</span>
							</label>
							<span className="invisible group-hover:visible absolute left-0 top-full mt-1 px-3 py-2 bg-gray-800 text-white text-xs rounded-lg z-10 max-w-xs whitespace-normal">
								Limits downloading articles published before this date
							</span>
							<Input
								type="date"
								value={
									userReducer.articleTableBodyParams
										?.returnOnlyThisPublishedDateOrAfter || ""
								}
								onChange={(e) =>
									dispatch(
										updateArticleTableBodyParams({
											returnOnlyThisPublishedDateOrAfter:
												e.target.value || null,
										})
									)
								}
							/>
						</div>
					</div>

					{/* Toggle Buttons and Refresh */}
					<div className="flex flex-wrap items-center gap-3">
						{/* Hide Approved Button */}
						<button
							onClick={() => dispatch(toggleHideApproved())}
							className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
								userReducer.articleTableBodyParams?.returnOnlyIsNotApproved
									? "bg-brand-500 text-white hover:bg-brand-600 dark:bg-brand-600 dark:hover:bg-brand-700"
									: "bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
							}`}
						>
							{userReducer.articleTableBodyParams?.returnOnlyIsNotApproved
								? "Show Approved"
								: "Hide Approved"}
						</button>

						{/* Hide Irrelevant Button */}
						<button
							onClick={() => dispatch(toggleHideIrrelevant())}
							className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
								userReducer.articleTableBodyParams?.returnOnlyIsRelevant
									? "bg-brand-500 text-white hover:bg-brand-600 dark:bg-brand-600 dark:hover:bg-brand-700"
									: "bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
							}`}
						>
							{userReducer.articleTableBodyParams?.returnOnlyIsRelevant
								? "Show Irrelevant"
								: "Hide Irrelevant"}
						</button>

						{/* Refresh Button - lights up when filters change */}
						<button
							onClick={handleRefreshWithFilters}
							disabled={!hasFilterChanges}
							className={`ml-auto px-6 py-2 text-sm font-medium rounded-lg transition-all ${
								hasFilterChanges
									? "bg-green-500 text-white hover:bg-green-600 dark:bg-green-600 dark:hover:bg-green-700 shadow-lg"
									: "bg-gray-300 text-gray-500 cursor-not-allowed dark:bg-gray-700 dark:text-gray-500"
							}`}
						>
							{hasFilterChanges ? "Refresh with New Filters" : "No Changes"}
						</button>
					</div>
				</div>
			</div>

			{/* Articles Table */}
			<TableReviewArticles
				data={filteredArticlesArray}
				selectedRowId={selectedArticle?.id}
				loading={loadingComponents.table01}
				showReviewedColumn={true}
				showRelevantColumn={true}
				onSelectArticle={handleSelectArticleFromTable}
				onToggleReviewed={handleClickIsReviewed}
				onToggleRelevant={handleClickIsRelevant}
				onStateAssignmentClick={setStateAssignerArticleId}
				onAiApproverClick={setAiApproverArticleId}
				onArticleContentClick={setReviewArticleContentArticleId}
			/>

			{/* Alert Modal */}
			<Modal
				isOpen={alertModal.show}
				onClose={() => setAlertModal({ ...alertModal, show: false })}
				showCloseButton={true}
			>
				<ModalInformationOk
					title={alertModal.title}
					message={alertModal.message}
					variant={alertModal.variant}
					onClose={() => setAlertModal({ ...alertModal, show: false })}
				/>
			</Modal>

			{/* State Assigner Details Modal */}
			{stateAssignerArticleId && (
				<ModalStateAssignerDetails
					articleId={stateAssignerArticleId}
					onClose={() => setStateAssignerArticleId(null)}
					onArticleUpdate={handleStateAssignerArticleUpdate}
					showFullDetails={false}
				/>
			)}

			{aiApproverArticleId && (
				<ModalAiApproverDetails
					articleId={aiApproverArticleId}
					onClose={() => setAiApproverArticleId(null)}
					onScoresUpdated={handleAiApproverArticleUpdate}
				/>
			)}

			{reviewArticleContentArticleId && (
				<ModalReviewArticleContent
					articleId={reviewArticleContentArticleId}
					onClose={() => setReviewArticleContentArticleId(null)}
					onScoresUpdated={handleAiApproverArticleUpdate}
				/>
			)}
		</div>
	);
}
