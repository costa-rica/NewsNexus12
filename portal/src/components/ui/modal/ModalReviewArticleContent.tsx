"use client";

import React, { useEffect, useMemo, useState } from "react";
import { LoadingDots } from "@/components/common/LoadingDots";
import Input from "@/components/form/input/InputField";
import TextArea from "@/components/form/input/TextArea";
import { useAppSelector } from "@/store/hooks";
import type {
	AiApproverPromptVersion,
	ReviewArticleContentResponse,
	ReviewPageAiApproverStartJobResponse,
} from "@/types/article";
import { Modal } from "./index";

interface ModalReviewArticleContentProps {
	articleId: number;
	onClose: () => void;
}

type FeedbackState = {
	message: string;
	title: string;
	variant: "error" | "success";
} | null;

type SortColumn = "id" | "name" | "description" | "isActive" | "endedAt";
type SortDirection = "asc" | "desc";

const DEFAULT_SORT: {
	column: SortColumn;
	direction: SortDirection;
} = {
	column: "id",
	direction: "desc",
};

const ModalReviewArticleContent: React.FC<ModalReviewArticleContentProps> = ({
	articleId,
	onClose,
}) => {
	const { token } = useAppSelector((state) => state.user);
	const [details, setDetails] = useState<ReviewArticleContentResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [prompts, setPrompts] = useState<AiApproverPromptVersion[]>([]);
	const [promptsLoading, setPromptsLoading] = useState(true);
	const [promptsError, setPromptsError] = useState<string | null>(null);
	const [isPickerOpen, setIsPickerOpen] = useState(false);
	const [pageSize, setPageSize] = useState<5 | 10 | 20>(10);
	const [currentPage, setCurrentPage] = useState(1);
	const [sortColumn, setSortColumn] = useState<SortColumn>(DEFAULT_SORT.column);
	const [sortDirection, setSortDirection] = useState<SortDirection>(
		DEFAULT_SORT.direction
	);
	const [selectedPromptSource, setSelectedPromptSource] = useState<{
		id: number;
		name: string;
	} | null>(null);
	const [formName, setFormName] = useState("");
	const [promptInMarkdown, setPromptInMarkdown] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [feedback, setFeedback] = useState<FeedbackState>(null);

	useEffect(() => {
		const fetchDetails = async () => {
			if (!token) {
				setError("Authentication token not found");
				setLoading(false);
				return;
			}

			try {
				setLoading(true);
				const response = await fetch(
					`${process.env.NEXT_PUBLIC_API_BASE_URL}/analysis/ai-approver/review-article-content/${articleId}`,
					{
						headers: {
							Authorization: `Bearer ${token}`,
						},
					}
				);

				if (!response.ok) {
					throw new Error(
						`Failed to fetch review article content: ${response.statusText}`
					);
				}

				const data = (await response.json()) as ReviewArticleContentResponse;
				setDetails(data);
				setError(null);
			} catch (err) {
				setError(err instanceof Error ? err.message : "An error occurred");
			} finally {
				setLoading(false);
			}
		};

		void fetchDetails();
	}, [articleId, token]);

	useEffect(() => {
		const fetchPrompts = async () => {
			if (!token) {
				setPromptsError("Authentication token not found");
				setPromptsLoading(false);
				return;
			}

			try {
				setPromptsLoading(true);
				const response = await fetch(
					`${process.env.NEXT_PUBLIC_API_BASE_URL}/analysis/ai-approver/prompts`,
					{
						headers: {
							Authorization: `Bearer ${token}`,
						},
					}
				);

				if (!response.ok) {
					throw new Error(
						`Failed to fetch AI approver prompts: ${response.statusText}`
					);
				}

				const result = (await response.json()) as {
					prompts?: AiApproverPromptVersion[];
				};
				setPrompts(result.prompts || []);
				setPromptsError(null);
			} catch (err) {
				setPromptsError(err instanceof Error ? err.message : "An error occurred");
			} finally {
				setPromptsLoading(false);
			}
		};

		void fetchPrompts();
	}, [token]);

	const sortedPrompts = useMemo(() => {
		return [...prompts].sort((left, right) => {
			const sortMultiplier = sortDirection === "asc" ? 1 : -1;

			switch (sortColumn) {
				case "id":
					return (left.id - right.id) * sortMultiplier;
				case "name":
					return left.name.localeCompare(right.name) * sortMultiplier;
				case "description":
					return (left.description || "").localeCompare(right.description || "") * sortMultiplier;
				case "isActive":
					return (Number(left.isActive) - Number(right.isActive)) * sortMultiplier;
				case "endedAt": {
					const leftValue = left.endedAt ? new Date(left.endedAt).getTime() : 0;
					const rightValue = right.endedAt ? new Date(right.endedAt).getTime() : 0;
					return (leftValue - rightValue) * sortMultiplier;
				}
				default:
					return 0;
			}
		});
	}, [prompts, sortColumn, sortDirection]);

	const totalPages = Math.max(1, Math.ceil(sortedPrompts.length / pageSize));

	const paginatedPrompts = useMemo(() => {
		const pageStart = (currentPage - 1) * pageSize;
		return sortedPrompts.slice(pageStart, pageStart + pageSize);
	}, [currentPage, pageSize, sortedPrompts]);

	useEffect(() => {
		setCurrentPage((current) => Math.min(current, totalPages));
	}, [totalPages]);

	const handleSort = (column: SortColumn) => {
		if (sortColumn === column) {
			setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
			return;
		}

		setSortColumn(column);
		setSortDirection(column === "id" ? "desc" : "asc");
	};

	const getSortIndicator = (column: SortColumn) => {
		if (sortColumn !== column) {
			return "";
		}

		return sortDirection === "asc" ? " ▲" : " ▼";
	};

	const handleSelectPrompt = (prompt: AiApproverPromptVersion) => {
		setSelectedPromptSource({
			id: prompt.id,
			name: prompt.name,
		});
		setFormName(`${prompt.name}-articleId: ${articleId}`);
		setPromptInMarkdown(prompt.promptInMarkdown);
		setFeedback(null);
	};

	const handleResetToBlank = () => {
		setSelectedPromptSource(null);
		setFormName("");
		setPromptInMarkdown("");
		setFeedback(null);
	};

	const handleSubmit = async () => {
		if (!token) {
			setFeedback({
				title: "Error",
				message: "Authentication token not found.",
				variant: "error",
			});
			return;
		}

		try {
			setIsSubmitting(true);
			setFeedback(null);
			const response = await fetch(
				`${process.env.NEXT_PUBLIC_API_BASE_URL}/analysis/ai-approver/review-page/start-job`,
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${token}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						articleId,
						name: formName,
						promptInMarkdown,
						sourcePromptVersionId: selectedPromptSource?.id ?? null,
					}),
				}
			);

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(errorText || "Failed to queue one-off AI approver job");
			}

			const result =
				(await response.json()) as ReviewPageAiApproverStartJobResponse;
			setFeedback({
				title: "One-Off Prompt Queued",
				message: `Queued job ${result.jobId} with prompt row ${result.promptVersionId}. This prompt row was saved as inactive by default.`,
				variant: "success",
			});
		} catch (err) {
			setFeedback({
				title: "Error",
				message:
					err instanceof Error
						? err.message
						: "Failed to queue one-off AI approver job.",
				variant: "error",
			});
		} finally {
			setIsSubmitting(false);
		}
	};

	const canSubmit =
		formName.trim().length > 0 && promptInMarkdown.trim().length > 0 && !isSubmitting;

	return (
		<Modal isOpen={true} onClose={onClose} className="max-w-6xl">
			<div className="max-h-[90vh] overflow-y-auto p-6 sm:p-8">
				<div className="mb-6">
					<h2 className="mb-2 text-2xl font-semibold text-gray-900 dark:text-white">
						Article Content
					</h2>
					<p className="text-sm text-gray-500 dark:text-gray-400">
						Review-page one-off AI approver modal
					</p>
				</div>

				{loading ? (
					<LoadingDots className="py-20" />
				) : error ? (
					<div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
						{error}
					</div>
				) : !details ? (
					<div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-300">
						No article content details were returned.
					</div>
				) : (
					<div className="space-y-6">
						<div className="space-y-2">
							<p className="text-sm text-gray-500 dark:text-gray-400">
								Article ID: {details.articleId}
							</p>
							<h3 className="text-xl font-semibold text-gray-900 dark:text-white">
								{details.title}
							</h3>
						</div>

						<div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900/20">
							<div className="mb-3 flex flex-wrap items-center gap-3">
								<span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-600 dark:bg-brand-900/20 dark:text-brand-300">
									{details.contentSource === "article-contents-02"
										? "ArticleContents02"
										: "No scraped content"}
								</span>
								<span className="text-xs text-gray-500 dark:text-gray-400">
									Read-only content
								</span>
							</div>

							<div className="max-h-[320px] overflow-y-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-4 text-sm leading-6 text-gray-700 dark:bg-gray-800/60 dark:text-gray-200">
								{details.content || "No article content available."}
							</div>
						</div>

						<div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900/20">
							<div className="mb-5 flex flex-wrap items-center justify-between gap-3">
								<div>
									<h3 className="text-lg font-semibold text-gray-900 dark:text-white">
										One-Off AI Approver Prompt
									</h3>
									<p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
										This creates a new inactive prompt row and queues a single
										article run.
									</p>
								</div>
								<button
									type="button"
									onClick={handleResetToBlank}
									disabled={isSubmitting}
									className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
								>
									Start Blank
								</button>
							</div>

							<div className="space-y-5">
								<div>
									<label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
										Name
									</label>
									<Input
										type="text"
										value={formName}
										onChange={(event) => setFormName(event.target.value)}
										placeholder="Give this one-off prompt a name"
										disabled={isSubmitting}
										hint={
											selectedPromptSource
												? `Copied from prompt ${selectedPromptSource.id}. You can still edit this name before submitting.`
												: "This name is editable and the saved prompt row will stay inactive by default."
										}
									/>
								</div>

								<div>
									<label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
										Prompt Markdown
									</label>
									<TextArea
										rows={14}
										value={promptInMarkdown}
										onChange={setPromptInMarkdown}
										disabled={isSubmitting}
										placeholder="Write a one-off prompt here or select one from the prompt rows section below."
										hint="Description is generated automatically by the API and the prompt row will be stored as inactive."
									/>
								</div>

								{feedback && (
									<div
										className={`rounded-lg border p-4 text-sm ${
											feedback.variant === "success"
												? "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300"
												: "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
										}`}
									>
										<div className="font-semibold">{feedback.title}</div>
										<div className="mt-1">{feedback.message}</div>
									</div>
								)}

								<div className="flex justify-end">
									<button
										type="button"
										onClick={() => void handleSubmit()}
										disabled={!canSubmit}
										className="rounded-lg bg-brand-500 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-brand-600 dark:hover:bg-brand-700"
									>
										{isSubmitting ? "Queueing..." : "Submit One-Off Prompt"}
									</button>
								</div>
							</div>
						</div>

						<div className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900/20">
							<button
								type="button"
								onClick={() => setIsPickerOpen((current) => !current)}
								className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
							>
								<div>
									<h3 className="text-lg font-semibold text-gray-900 dark:text-white">
										Prompt Rows
									</h3>
									<p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
										Open this section to copy an existing AI approver prompt into
										the one-off form.
									</p>
								</div>
								<span className="text-sm text-gray-500 dark:text-gray-400">
									{isPickerOpen ? "Hide" : "Show"}
								</span>
							</button>

							{isPickerOpen && (
								<div className="border-t border-gray-200 px-5 py-5 dark:border-gray-700">
									{promptsLoading ? (
										<LoadingDots className="py-10" />
									) : promptsError ? (
										<div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
											{promptsError}
										</div>
									) : prompts.length === 0 ? (
										<div className="rounded-lg border border-dashed border-gray-300 p-6 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-300">
											No prompt rows are available to copy yet.
										</div>
									) : (
										<div className="space-y-4">
											<div className="flex flex-wrap items-center justify-between gap-3">
												<div className="text-sm text-gray-600 dark:text-gray-400">
													Showing {paginatedPrompts.length} of {sortedPrompts.length} prompt rows
												</div>
												<div className="flex items-center gap-2">
													<span className="text-sm text-gray-600 dark:text-gray-400">
														Rows
													</span>
													{([5, 10, 20] as const).map((option) => (
														<button
															key={option}
															type="button"
															onClick={() => {
																setPageSize(option);
																setCurrentPage(1);
															}}
															className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
																pageSize === option
																	? "bg-brand-500 text-white dark:bg-brand-600"
																	: "border border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
															}`}
														>
															{option}
														</button>
													))}
												</div>
											</div>

											<div className="overflow-x-auto">
												<table className="w-full min-w-[920px]">
													<thead className="border-b border-gray-200 dark:border-gray-700">
														<tr>
															{[
																["id", "ID"],
																["name", "Name"],
																["description", "Description"],
																["isActive", "Active"],
																["endedAt", "Ended At"],
															].map(([column, label]) => (
																<th
																	key={column}
																	className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300"
																>
																	<button
																		type="button"
																		onClick={() => handleSort(column as SortColumn)}
																		className="hover:text-brand-500"
																	>
																		{label}
																		{getSortIndicator(column as SortColumn)}
																	</button>
																</th>
															))}
															<th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300">
																Action
															</th>
														</tr>
													</thead>
													<tbody className="divide-y divide-gray-200 dark:divide-gray-800">
														{paginatedPrompts.map((prompt) => (
															<tr
																key={prompt.id}
																className={
																	selectedPromptSource?.id === prompt.id
																		? "bg-brand-50 dark:bg-brand-900/10"
																		: ""
																}
															>
																<td className="px-4 py-3 text-sm text-gray-800 dark:text-gray-200">
																	{prompt.id}
																</td>
																<td className="px-4 py-3 text-sm text-gray-800 dark:text-gray-200">
																	{prompt.name}
																</td>
																<td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
																	{prompt.description || "N/A"}
																</td>
																<td className="px-4 py-3 text-sm">
																	<span
																		className={`rounded-full px-2.5 py-1 text-xs font-medium ${
																			prompt.isActive
																				? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
																				: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
																		}`}
																	>
																		{prompt.isActive ? "Active" : "Inactive"}
																	</span>
																</td>
																<td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
																	{prompt.endedAt
																		? new Date(prompt.endedAt).toLocaleString()
																		: "N/A"}
																</td>
																<td className="px-4 py-3">
																	<button
																		type="button"
																		onClick={() => handleSelectPrompt(prompt)}
																		className="rounded-lg border border-brand-300 px-3 py-2 text-xs font-medium text-brand-600 transition-colors hover:bg-brand-50 dark:border-brand-700 dark:text-brand-400 dark:hover:bg-brand-900/20"
																	>
																		Use Prompt
																	</button>
																</td>
															</tr>
														))}
													</tbody>
												</table>
											</div>

											<div className="flex flex-wrap items-center justify-between gap-3">
												<div className="text-sm text-gray-600 dark:text-gray-400">
													Page {currentPage} of {totalPages}
												</div>
												<div className="flex items-center gap-2">
													<button
														type="button"
														onClick={() =>
															setCurrentPage((current) => Math.max(1, current - 1))
														}
														disabled={currentPage === 1}
														className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
													>
														Previous
													</button>
													<button
														type="button"
														onClick={() =>
															setCurrentPage((current) =>
																Math.min(totalPages, current + 1)
															)
														}
														disabled={currentPage === totalPages}
														className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
													>
														Next
													</button>
												</div>
											</div>
										</div>
									)}
								</div>
							)}
						</div>
					</div>
				)}
			</div>
		</Modal>
	);
};

export default ModalReviewArticleContent;
