"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import {
	updateStateArray,
	toggleShowSummaryStatistics,
	toggleShowRecentlyApprovedByUser,
} from "@/store/features/user/userSlice";
import { SummaryStatistics } from "@/components/common/SummaryStatistics";
import { RecentlyApprovedByUser } from "@/components/common/RecentlyApprovedByUser";
import TableReviewArticles from "@/components/tables/TableReviewArticles";
import MultiSelect from "@/components/form/MultiSelect";
import { Modal } from "@/components/ui/modal";
import { ModalInformationOk } from "@/components/ui/modal/ModalInformationOk";
import { ModalInformationYesOrNo } from "@/components/ui/modal/ModalInformationYesOrNo";
import { LoadingDots } from "@/components/common/LoadingDots";
import type { Article } from "@/types/article";

interface State {
	id: number;
	name: string;
}

interface NewArticle {
	id?: number;
	publicationName?: string;
	title?: string;
	url?: string;
	publishedDate?: string;
	content?: string;
	States?: State[];
}

export default function AddDeleteArticle() {
	const dispatch = useAppDispatch();
	const userReducer = useAppSelector((state) => state.user);
	const { token, stateArray = [], articleTableBodyParams } = userReducer;

	const [newArticle, setNewArticle] = useState<NewArticle>({});
	const [articlesArray, setArticlesArray] = useState<Article[]>([]);
	const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
	const [isOpenDeleteModal, setIsOpenDeleteModal] = useState(false);
	const [articleToDelete, setArticleToDelete] = useState<Article | null>(null);
	const [isOpenUpdateModal, setIsOpenUpdateModal] = useState(false);
	const [isUpdating, setIsUpdating] = useState(false);
	const [inputErrors, setInputErrors] = useState({
		publicationName: false,
		title: false,
		publishedDate: false,
		content: false,
	});
	const [loadingTable, setLoadingTable] = useState(false);
	const [alertModal, setAlertModal] = useState<{
		show: boolean;
		variant: "success" | "error" | "warning";
		title: string;
		message: string;
	}>({
		show: false,
		variant: "success",
		title: "",
		message: "",
	});

	const updateStateArrayWithArticleState = useCallback((article: { States?: State[] }) => {
		if (!article?.States) {
			const tempStatesArray = stateArray.map((stateObj) => ({
				...stateObj,
				selected: false,
			}));
			dispatch(updateStateArray(tempStatesArray));
			return;
		}
		const articleStateIds = article.States.map((state) => state.id);
		const tempStatesArray = stateArray.map((stateObj) => {
			if (articleStateIds.includes(stateObj.id)) {
				return { ...stateObj, selected: true };
			} else {
				return { ...stateObj, selected: false };
			}
		});
		dispatch(updateStateArray(tempStatesArray));
	}, [dispatch, stateArray]);

	const fetchArticlesArray = useCallback(async () => {
		if (!token) return;

		try {
			setLoadingTable(true);
			const response = await fetch(
				`${process.env.NEXT_PUBLIC_API_BASE_URL}/articles`,
				{
					headers: {
						Authorization: `Bearer ${token}`,
						"Content-Type": "application/json",
					},
					method: "POST",
					body: JSON.stringify(articleTableBodyParams),
				}
			);

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Server Error: ${errorText}`);
			}

			const result = await response.json();

			if (result.articlesArray && Array.isArray(result.articlesArray)) {
				setArticlesArray(result.articlesArray);
			} else {
				setArticlesArray([]);
			}
		} catch (error) {
			console.error("Error fetching data:", error);
			setArticlesArray([]);
		} finally {
			setLoadingTable(false);
		}
	}, [token, articleTableBodyParams]);

	useEffect(() => {
		fetchArticlesArray();
		updateStateArrayWithArticleState({ States: [] });
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [fetchArticlesArray]);

	const handleAddAndSubmitArticle = async () => {
		if (!token) return;

		const selectedStateObjs = stateArray.filter((st) => st.selected);
		const errors = {
			publicationName: !newArticle.publicationName,
			title: !newArticle.title,
			publishedDate: !newArticle.publishedDate,
			content: !newArticle.content,
		};
		setInputErrors(errors);

		if (
			!newArticle.publicationName ||
			!newArticle.title ||
			!newArticle.publishedDate ||
			!newArticle.content
		) {
			setAlertModal({
				show: true,
				variant: "warning",
				title: "Missing Required Fields",
				message:
					"Please fill in all required fields: publication name, title, published date, content",
			});
			return;
		}

		if (selectedStateObjs.length === 0) {
			setAlertModal({
				show: true,
				variant: "warning",
				title: "State Required",
				message: "Please select at least one state",
			});
			return;
		}

		const updatedArticle = {
			...newArticle,
			stateObjArray: selectedStateObjs,
			isApproved: true,
			kmNotes: "added manually",
		};

		try {
			const response = await fetch(
				`${process.env.NEXT_PUBLIC_API_BASE_URL}/articles/add-article`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${token}`,
					},
					body: JSON.stringify(updatedArticle),
				}
			);

			const resJson = await response.json();

			if (response.status === 400) {
				setAlertModal({
					show: true,
					variant: "error",
					title: "Error",
					message: resJson.message,
				});
				return;
			} else {
				setAlertModal({
					show: true,
					variant: "success",
					title: "Success",
					message: "Successfully added article",
				});
				const blankArticle = {
					publicationName: "",
					title: "",
					url: "",
					publishedDate: "",
					content: "",
					States: [],
				};
				setNewArticle(blankArticle);
				updateStateArrayWithArticleState(blankArticle);
			}
		} catch (error) {
			console.error("Error adding article:", error);
		}
		fetchArticlesArray();
	};

	const handleSelectArticleFromTable = async (article: Article) => {
		if (!token) return;

		try {
			const response = await fetch(
				`${process.env.NEXT_PUBLIC_API_BASE_URL}/articles/get-approved/${article.id}`,
				{
					headers: { Authorization: `Bearer ${token}` },
				}
			);

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Server Error: ${errorText}`);
			}

			const result = await response.json();

			if (result.article && result.article.id) {
				setSelectedArticle({
					...result.article,
					...article,
					content: result.content,
				});
				setNewArticle({
					...result.article,
					...article,
					content: result.content,
				});
				updateStateArrayWithArticleState(article);
			} else {
				setSelectedArticle({ ...article, content: article.description });
				setNewArticle({ ...article, content: article.description });
				updateStateArrayWithArticleState(article);
			}
		} catch (error) {
			console.error("Error fetching data:", error);
		}
	};

	const handleDeleteArticle = async (article: Article) => {
		setArticleToDelete(article);
		setIsOpenDeleteModal(true);
	};

	const confirmDelete = async () => {
		if (!token || !articleToDelete) return;

		try {
			const response = await fetch(
				`${process.env.NEXT_PUBLIC_API_BASE_URL}/articles/${articleToDelete.id}`,
				{
					method: "DELETE",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${token}`,
					},
				}
			);

			if (response.status !== 200) {
				console.log(`There was a server error: ${response.status}`);
				setAlertModal({
					show: true,
					variant: "error",
					title: "Delete Failed",
					message: `There was a server error: ${response.status}. Unable to delete article.`,
				});
				return;
			}

			const tempArticlesArray = articlesArray.filter(
				(article) => article.id !== articleToDelete.id
			);
			setArticlesArray(tempArticlesArray);
			setSelectedArticle(null);
			setNewArticle({});
			updateStateArrayWithArticleState({ States: [] });
			setAlertModal({
				show: true,
				variant: "success",
				title: "Success",
				message: "Article deleted successfully!",
			});
		} catch (error) {
			console.error("Error deleting article:", error);
			setAlertModal({
				show: true,
				variant: "error",
				title: "Error",
				message: "Error deleting article. Please try again.",
			});
		} finally {
			setIsOpenDeleteModal(false);
			setArticleToDelete(null);
		}
	};

	const handleUpdateArticleData = async () => {
		if (!token || !newArticle?.id) return;

		setIsUpdating(true);
		setIsOpenUpdateModal(false);

		try {
			// Get selected state IDs
			const selectedStateIds = stateArray
				.filter((st) => st.selected)
				.map((st) => st.id);

			// Prepare request body
			const requestBody = {
				newPublicationName: newArticle.publicationName || null,
				newTitle: newArticle.title || null,
				newUrl: newArticle.url || null,
				newPublishedDate: newArticle.publishedDate || null,
				newStateIdsArray: selectedStateIds.length > 0 ? selectedStateIds : null,
				newContent: newArticle.content || null,
			};

			const response = await fetch(
				`${process.env.NEXT_PUBLIC_API_BASE_URL}/articles/update-approved-all/${newArticle.id}`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${token}`,
					},
					body: JSON.stringify(requestBody),
				}
			);

			const resJson = await response.json();

			if (!response.ok) {
				setAlertModal({
					show: true,
					variant: "error",
					title: "Update Failed",
					message: resJson.message || `Server error: ${response.status}`,
				});
				return;
			}

			setAlertModal({
				show: true,
				variant: "success",
				title: "Success",
				message: "Article updated successfully!",
			});
		} catch (error) {
			console.error("Error updating article:", error);
			setAlertModal({
				show: true,
				variant: "error",
				title: "Error",
				message: "Error updating article. Please try again.",
			});
		} finally {
			setIsUpdating(false);
		}
	};

	return (
		<div className="flex flex-col gap-4 md:gap-6">
			<h1 className="text-title-xl text-gray-700 dark:text-gray-300">
				Add / Delete Article
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

			{/* Form Section */}
			<div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
				<div className="space-y-4">
					{/* Article ID Header - only shown when editing */}
					{newArticle?.id && (
						<div className="mb-6 pb-4 border-b border-gray-200 dark:border-gray-700">
							<h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
								Article ID: {newArticle.id}
							</h3>
						</div>
					)}

					{/* Publication Name */}
					<div className="flex flex-col gap-2">
						<label
							htmlFor="publicationName"
							className="text-sm font-medium text-gray-700 dark:text-gray-300"
						>
							Publication Name:
						</label>
						<input
							id="publicationName"
							type="text"
							value={newArticle?.publicationName || ""}
							className={`px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-gray-800 dark:text-white max-w-2xl ${
								inputErrors.publicationName
									? "border-red-500"
									: "border-gray-300 dark:border-gray-700"
							}`}
							onChange={(e) =>
								setNewArticle({
									...newArticle,
									publicationName: e.target.value,
								})
							}
						/>
					</div>

					{/* Title */}
					<div className="flex flex-col gap-2">
						<label
							htmlFor="title"
							className="text-sm font-medium text-gray-700 dark:text-gray-300"
						>
							Title:
						</label>
						<input
							id="title"
							type="text"
							value={newArticle?.title || ""}
							className={`px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-gray-800 dark:text-white max-w-2xl ${
								inputErrors.title
									? "border-red-500"
									: "border-gray-300 dark:border-gray-700"
							}`}
							onChange={(e) =>
								setNewArticle({ ...newArticle, title: e.target.value })
							}
						/>
					</div>

					{/* URL */}
					<div className="flex flex-col gap-2">
						<label
							htmlFor="url"
							className="text-sm font-medium text-gray-700 dark:text-gray-300"
						>
							URL:
						</label>
						<input
							id="url"
							type="text"
							value={newArticle?.url || ""}
							className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white max-w-2xl"
							onChange={(e) =>
								setNewArticle({ ...newArticle, url: e.target.value })
							}
						/>
					</div>

					{/* Published Date */}
					<div className="flex flex-col gap-2">
						<label
							htmlFor="publishedDate"
							className="text-sm font-medium text-gray-700 dark:text-gray-300"
						>
							Published Date:
						</label>
						<input
							id="publishedDate"
							type="date"
							value={newArticle?.publishedDate || ""}
							className={`px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-gray-800 dark:text-white max-w-xs ${
								inputErrors.publishedDate
									? "border-red-500"
									: "border-gray-300 dark:border-gray-700"
							}`}
							onChange={(e) =>
								setNewArticle({ ...newArticle, publishedDate: e.target.value })
							}
						/>
					</div>

					{/* Article State */}
					<div className="flex flex-col gap-2">
						<div className="max-w-xs">
							<MultiSelect
								label="Article State"
								options={stateArray.map((state) => ({
									value: state.id.toString(),
									text: state.name,
									selected: state.selected,
								}))}
								defaultSelected={stateArray
									.filter((s) => s.selected)
									.map((s) => s.id.toString())}
								onChange={(selectedValues) => {
									const updated = stateArray.map((state) => ({
										...state,
										selected: selectedValues.includes(state.id.toString()),
									}));
									dispatch(updateStateArray(updated));
								}}
							/>
						</div>
					</div>

					{/* Content */}
					<div className="flex flex-col gap-2">
						<label
							htmlFor="content"
							className="text-sm font-medium text-gray-700 dark:text-gray-300"
						>
							Content:
						</label>
						<textarea
							id="content"
							value={newArticle?.content || ""}
							className={`px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-gray-800 dark:text-white min-h-[200px] ${
								inputErrors.content
									? "border-red-500"
									: "border-gray-300 dark:border-gray-700"
							}`}
							onChange={(e) =>
								setNewArticle({
									...newArticle,
									content: e.target.value,
								})
							}
						/>
					</div>

					{/* Buttons */}
					<div className="flex gap-3 pt-2">
						{newArticle?.id ? (
							<>
								<button
									onClick={() => {
										setNewArticle({});
										updateStateArrayWithArticleState({ States: [] });
									}}
									className="px-6 py-2 text-sm font-medium text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
								>
									Clear
								</button>
								<button
									onClick={() => setIsOpenUpdateModal(true)}
									className="px-6 py-2 text-sm font-medium text-white bg-brand-500 rounded-lg hover:bg-brand-600 dark:bg-brand-600 dark:hover:bg-brand-700"
								>
									Update
								</button>
							</>
						) : (
							<button
								onClick={handleAddAndSubmitArticle}
								className="px-6 py-2 text-sm font-medium text-white bg-brand-500 rounded-lg hover:bg-brand-600 dark:bg-brand-600 dark:hover:bg-brand-700"
							>
								Submit
							</button>
						)}
					</div>
				</div>
			</div>

			{/* Articles Table */}
			<TableReviewArticles
				data={articlesArray}
				selectedRowId={selectedArticle?.id}
				loading={loadingTable}
				showDeleteColumn={true}
				onSelectArticle={handleSelectArticleFromTable}
				onDeleteArticle={handleDeleteArticle}
			/>

			{/* Delete Confirmation Modal */}
			{isOpenDeleteModal && articleToDelete && (
				<Modal
					isOpen={isOpenDeleteModal}
					onClose={() => setIsOpenDeleteModal(false)}
				>
					<div className="p-6">
						<h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-4">
							Are you sure?
						</h2>
						<div className="mb-6 space-y-2">
							<p className="text-gray-700 dark:text-gray-300">
								Delete Article ID: {articleToDelete.id}
							</p>
							<p className="font-bold text-gray-800 dark:text-white">
								{articleToDelete.title}
							</p>
							<p className="text-gray-600 dark:text-gray-400">
								This action cannot be undone.
							</p>
						</div>
						<div className="flex gap-3 justify-end">
							<button
								onClick={() => setIsOpenDeleteModal(false)}
								className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
							>
								Cancel
							</button>
							<button
								onClick={confirmDelete}
								className="px-4 py-2 text-sm font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-700"
							>
								Delete
							</button>
						</div>
					</div>
				</Modal>
			)}

			{/* Update Confirmation Modal */}
			{isOpenUpdateModal && (
				<Modal
					isOpen={isOpenUpdateModal}
					onClose={() => setIsOpenUpdateModal(false)}
				>
					<ModalInformationYesOrNo
						title="Update Article"
						message="This will permanently change the article data in the database. Are you sure you want to proceed?"
						onYes={handleUpdateArticleData}
						onNo={() => setIsOpenUpdateModal(false)}
						onClose={() => setIsOpenUpdateModal(false)}
						yesButtonText="Update"
						noButtonText="Cancel"
						yesButtonStyle="primary"
					/>
				</Modal>
			)}

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

			{/* Loading Overlay */}
			{isUpdating && (
				<div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
					<div className="bg-white dark:bg-gray-800 rounded-lg p-8 flex flex-col items-center gap-4">
						<LoadingDots size={4} />
						<p className="text-gray-700 dark:text-gray-300 text-lg font-medium">
							Updating article...
						</p>
					</div>
				</div>
			)}
		</div>
	);
}
