"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Input from "@/components/form/input/InputField";
import TextArea from "@/components/form/input/TextArea";
import { LoadingDots } from "@/components/common/LoadingDots";
import { Modal } from "@/components/ui/modal";
import { ModalInformationOk } from "@/components/ui/modal/ModalInformationOk";
import { ModalInformationYesOrNo } from "@/components/ui/modal/ModalInformationYesOrNo";
import { useAppSelector } from "@/store/hooks";
import type { AiApproverPromptVersion } from "@/types/article";

type FeedbackModalState = {
	show: boolean;
	title: string;
	message: string;
	variant: "success" | "error";
};

const DEFAULT_FEEDBACK_MODAL_STATE: FeedbackModalState = {
	show: false,
	title: "",
	message: "",
	variant: "success",
};

type DeleteTargetState = {
	id: number;
	name: string;
} | null;

type SourcePromptState = {
	id: number;
	name: string;
} | null;

type PageSizeOption = 5 | 10 | 20;

type SortColumn =
	| "id"
	| "name"
	| "description"
	| "promptRole"
	| "isActive"
	| "endedAt";

type SortDirection = "asc" | "desc";

const PAGE_SIZE_OPTIONS: PageSizeOption[] = [5, 10, 20];

const DEFAULT_PAGE_SIZE: PageSizeOption = 10;

const DEFAULT_SORT: {
	column: SortColumn;
	direction: SortDirection;
} = {
	column: "id",
	direction: "desc",
};

export default function AiApproverPromptsPage() {
	const { token } = useAppSelector((state) => state.user);
	const [prompts, setPrompts] = useState<AiApproverPromptVersion[]>([]);
	const [loading, setLoading] = useState(true);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [createForm, setCreateForm] = useState({
		name: "",
		description: "",
		promptInMarkdown: "",
		isActive: false,
		promptRole: "category_score",
		promptKey: "",
		pipelineVersion: "",
		responseSchemaVersion: "",
		modelName: "",
	});
	const [feedbackModal, setFeedbackModal] = useState<FeedbackModalState>(
		DEFAULT_FEEDBACK_MODAL_STATE
	);
	const [deleteTarget, setDeleteTarget] = useState<DeleteTargetState>(null);
	const [sourcePrompt, setSourcePrompt] = useState<SourcePromptState>(null);
	const [showCopyConfirmModal, setShowCopyConfirmModal] = useState(false);
	const [showActiveOnly, setShowActiveOnly] = useState(false);
	const [pageSize, setPageSize] = useState<PageSizeOption>(DEFAULT_PAGE_SIZE);
	const [currentPage, setCurrentPage] = useState(1);
	const [sortColumn, setSortColumn] = useState<SortColumn>(DEFAULT_SORT.column);
	const [sortDirection, setSortDirection] = useState<SortDirection>(
		DEFAULT_SORT.direction
	);

	const clearCreateForm = useCallback(() => {
		setCreateForm({
			name: "",
			description: "",
			promptInMarkdown: "",
			isActive: false,
			promptRole: "category_score",
			promptKey: "",
			pipelineVersion: "",
			responseSchemaVersion: "",
			modelName: "",
		});
		setSourcePrompt(null);
	}, []);

	const fetchPrompts = useCallback(async () => {
		if (!token) {
			setLoading(false);
			return;
		}

		try {
			setLoading(true);
			const response = await fetch(
				`${process.env.NEXT_PUBLIC_API_BASE_URL}/analysis/ai-approver/prompts`,
				{
					headers: {
						Authorization: `Bearer ${token}`,
					},
				}
			);

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(errorText || "Failed to fetch AI approver prompts");
			}

			const result = await response.json();
			setPrompts(result.prompts || []);
		} catch (error) {
			setFeedbackModal({
				show: true,
				title: "Error",
				message:
					error instanceof Error
						? error.message
						: "Failed to fetch AI approver prompts",
				variant: "error",
			});
		} finally {
			setLoading(false);
		}
	}, [token]);

	useEffect(() => {
		// eslint-disable-next-line react-hooks/set-state-in-effect -- client-side auth mount fetch; pending SWR migration
		void fetchPrompts();
	}, [fetchPrompts]);

	const activePromptCount = useMemo(
		() => prompts.filter((prompt) => prompt.isActive).length,
		[prompts]
	);

	const filteredAndSortedPrompts = useMemo(() => {
		const visiblePrompts = showActiveOnly
			? prompts.filter((prompt) => prompt.isActive)
			: prompts;

		const sortedPrompts = [...visiblePrompts].sort((left, right) => {
			const sortMultiplier = sortDirection === "asc" ? 1 : -1;

			switch (sortColumn) {
				case "id":
					return (left.id - right.id) * sortMultiplier;
				case "name":
					return left.name.localeCompare(right.name) * sortMultiplier;
				case "description":
					return (left.description || "").localeCompare(right.description || "") * sortMultiplier;
				case "promptRole":
					return (left.promptRole || "category_score").localeCompare(
						right.promptRole || "category_score"
					) * sortMultiplier;
				case "isActive":
					return (
						(Number(left.isActive) - Number(right.isActive)) * sortMultiplier
					);
				case "endedAt": {
					const leftValue = left.endedAt ? new Date(left.endedAt).getTime() : 0;
					const rightValue = right.endedAt ? new Date(right.endedAt).getTime() : 0;
					return (leftValue - rightValue) * sortMultiplier;
				}
				default:
					return 0;
			}
		});

		return sortedPrompts;
	}, [prompts, showActiveOnly, sortColumn, sortDirection]);

	const totalPages = Math.max(
		1,
		Math.ceil(filteredAndSortedPrompts.length / pageSize)
	);
	const safeCurrentPage = Math.min(currentPage, totalPages);

	const paginatedPrompts = useMemo(() => {
		const pageStart = (safeCurrentPage - 1) * pageSize;
		return filteredAndSortedPrompts.slice(pageStart, pageStart + pageSize);
	}, [filteredAndSortedPrompts, pageSize, safeCurrentPage]);

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
			return " ";
		}

		return sortDirection === "asc" ? " ▲" : " ▼";
	};

	const handleCreatePrompt = async () => {
		if (!token) {
			return;
		}

		try {
			setIsSubmitting(true);
			const response = await fetch(
				`${process.env.NEXT_PUBLIC_API_BASE_URL}/analysis/ai-approver/prompts`,
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${token}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(createForm),
				}
			);

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(errorText || "Failed to create AI approver prompt");
			}

			clearCreateForm();
			await fetchPrompts();
			setFeedbackModal({
				show: true,
				title: sourcePrompt ? "Prompt Copy Created" : "Prompt Created",
				message: sourcePrompt
					? "A new prompt row was created from the selected prompt."
					: "The AI approver prompt was created successfully.",
				variant: "success",
			});
		} catch (error) {
			setFeedbackModal({
				show: true,
				title: "Error",
				message:
					error instanceof Error
						? error.message
						: "Failed to create AI approver prompt",
				variant: "error",
			});
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleSelectPrompt = (prompt: AiApproverPromptVersion) => {
		setSourcePrompt({
			id: prompt.id,
			name: prompt.name,
		});
		setCreateForm({
			name: prompt.name,
			description: prompt.description || "",
			promptInMarkdown: prompt.promptInMarkdown,
			isActive: false,
			promptRole: prompt.promptRole || "category_score",
			promptKey: prompt.promptKey || "",
			pipelineVersion: prompt.pipelineVersion || "",
			responseSchemaVersion: prompt.responseSchemaVersion || "",
			modelName: prompt.modelName || "",
		});
	};

	const handleToggleActive = async (
		promptVersionId: number,
		currentIsActive: boolean
	) => {
		if (!token) {
			return;
		}

		try {
			setIsSubmitting(true);
			const confirmActivateGatekeeper =
				!currentIsActive &&
				prompts.find((prompt) => prompt.id === promptVersionId)?.promptRole ===
					"gatekeeper"
					? window.confirm(
							"Activate this gatekeeper prompt? Worker modes other than legacy can use it to route downstream AI approver calls."
					  )
					: false;
			if (
				!currentIsActive &&
				prompts.find((prompt) => prompt.id === promptVersionId)?.promptRole ===
					"gatekeeper" &&
				!confirmActivateGatekeeper
			) {
				setIsSubmitting(false);
				return;
			}

			const response = await fetch(
				`${process.env.NEXT_PUBLIC_API_BASE_URL}/analysis/ai-approver/prompts/${promptVersionId}/active`,
				{
					method: "PATCH",
					headers: {
						Authorization: `Bearer ${token}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						isActive: !currentIsActive,
						confirmActivateGatekeeper,
					}),
				}
			);

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(
					errorText || "Failed to update AI approver prompt active state"
				);
			}

			await fetchPrompts();
			setFeedbackModal({
				show: true,
				title: currentIsActive ? "Prompt Deactivated" : "Prompt Activated",
				message: currentIsActive
					? "The prompt is no longer active."
					: "The prompt is now active for the AI approver flow.",
				variant: "success",
			});
		} catch (error) {
			setFeedbackModal({
				show: true,
				title: "Error",
				message:
					error instanceof Error
						? error.message
						: "Failed to update AI approver prompt active state",
				variant: "error",
			});
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleDeletePrompt = async () => {
		if (!token || !deleteTarget) {
			return;
		}

		try {
			setIsSubmitting(true);
			const response = await fetch(
				`${process.env.NEXT_PUBLIC_API_BASE_URL}/analysis/ai-approver/prompts/${deleteTarget.id}`,
				{
					method: "DELETE",
					headers: {
						Authorization: `Bearer ${token}`,
					},
				}
			);

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(errorText || "Failed to delete AI approver prompt");
			}

			setDeleteTarget(null);
			await fetchPrompts();
			setFeedbackModal({
				show: true,
				title: "Prompt Deleted",
				message: "The prompt row was deleted successfully.",
				variant: "success",
			});
		} catch (error) {
			setDeleteTarget(null);
			setFeedbackModal({
				show: true,
				title: "Delete Blocked",
				message:
					error instanceof Error
						? error.message
						: "Failed to delete AI approver prompt",
				variant: "error",
			});
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="text-3xl font-bold text-gray-900 dark:text-white">
						AI Approver Prompt Management
					</h1>
					<p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
						Create immutable prompt rows, copy existing prompts into new
						versions, and manage which prompts are active in the AI Approver
						workflow.
					</p>
				</div>

				<div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-300">
					<div>Total Prompts: {prompts.length}</div>
					<div>Active Prompts: {activePromptCount}</div>
				</div>
			</div>

			<div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
				<div className="mb-6">
					<h2 className="text-title-md font-semibold text-gray-800 dark:text-white/90">
						Create Prompt
					</h2>
					<p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
						Prompt rows are immutable after creation. Click a prompt row ID
						below to load its values into this form and create a new copy.
					</p>
				</div>

				<div className="grid grid-cols-1 gap-6">
					<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
						<div>
							<label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
								ID
							</label>
							<Input
								type="text"
								value={
									sourcePrompt
										? `New ID will be created from source prompt ${sourcePrompt.id}`
										: "Created automatically"
								}
								disabled
							/>
						</div>

						<div>
							<label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
								Ended At
							</label>
							<Input
								type="text"
								value="Managed by API when prompt is deactivated"
								disabled
							/>
						</div>
					</div>

					<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
						<div>
							<label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
								Prompt Role
							</label>
							<select
								value={createForm.promptRole}
								onChange={(event) =>
									setCreateForm((current) => ({
										...current,
										promptRole: event.target.value,
										isActive:
											event.target.value === "gatekeeper" ? false : current.isActive,
									}))
								}
								className="h-11 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
							>
								<option value="category_score">category_score</option>
								<option value="gatekeeper">gatekeeper</option>
								<option value="legacy_category_score">legacy_category_score</option>
							</select>
						</div>

						<div>
							<label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
								Prompt Key
							</label>
							<Input
								type="text"
								value={createForm.promptKey}
								onChange={(event) =>
									setCreateForm((current) => ({
										...current,
										promptKey: event.target.value,
									}))
								}
								placeholder="consumer_product_gatekeeper_v1"
							/>
						</div>

						<div>
							<label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
								Pipeline Version
							</label>
							<Input
								type="text"
								value={createForm.pipelineVersion}
								onChange={(event) =>
									setCreateForm((current) => ({
										...current,
										pipelineVersion: event.target.value,
									}))
								}
								placeholder="ai_approver_gatekeeper_v1"
							/>
						</div>
					</div>

					<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
						<div>
							<label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
								Response Schema Version
							</label>
							<Input
								type="text"
								value={createForm.responseSchemaVersion}
								onChange={(event) =>
									setCreateForm((current) => ({
										...current,
										responseSchemaVersion: event.target.value,
									}))
								}
								placeholder="score_reason_v1"
							/>
						</div>
						<div>
							<label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
								Model Name
							</label>
							<Input
								type="text"
								value={createForm.modelName}
								onChange={(event) =>
									setCreateForm((current) => ({
										...current,
										modelName: event.target.value,
									}))
								}
								placeholder="Optional model override/audit name"
							/>
						</div>
					</div>

					<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
						<div>
							<label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
								Name
							</label>
							<Input
								type="text"
								value={createForm.name}
								onChange={(event) =>
									setCreateForm((current) => ({
										...current,
										name: event.target.value,
									}))
								}
								placeholder="Residential House Fire"
							/>
						</div>

						<div>
							<label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
								Description
							</label>
							<Input
								type="text"
								value={createForm.description}
								onChange={(event) =>
									setCreateForm((current) => ({
										...current,
										description: event.target.value,
									}))
								}
								placeholder="Short summary of what this prompt evaluates"
							/>
						</div>
					</div>

					<div>
						<label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
							Prompt Markdown
						</label>
						<TextArea
							rows={16}
							value={createForm.promptInMarkdown}
							onChange={(value) =>
								setCreateForm((current) => ({
									...current,
									promptInMarkdown: value,
								}))
							}
							placeholder="Paste the markdown prompt here"
							hint="Markdown is expected. Existing prompts are not editable after creation."
						/>
					</div>

					<div className="flex flex-wrap items-center justify-between gap-4">
						<label className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-300">
							<input
								type="checkbox"
								checked={createForm.isActive}
								onChange={(event) =>
									setCreateForm((current) => ({
										...current,
										isActive:
											current.promptRole === "gatekeeper"
												? false
												: event.target.checked,
									}))
								}
								disabled={createForm.promptRole === "gatekeeper"}
								className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
							/>
							Set active immediately
						</label>

						<div className="flex flex-wrap gap-3">
							{sourcePrompt && (
								<button
									type="button"
									onClick={clearCreateForm}
									disabled={isSubmitting}
									className="rounded-lg border border-gray-300 px-6 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
								>
									Clear
								</button>
							)}
							<button
								type="button"
								onClick={() => {
									if (sourcePrompt) {
										setShowCopyConfirmModal(true);
										return;
									}
									void handleCreatePrompt();
								}}
								disabled={
									isSubmitting ||
									createForm.name.trim().length === 0 ||
									createForm.promptInMarkdown.trim().length === 0
								}
								className="rounded-lg bg-brand-500 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-brand-600 dark:hover:bg-brand-700"
							>
								{isSubmitting
									? "Creating..."
									: sourcePrompt
										? "Copy and Create New Prompt"
										: "Create Prompt"}
							</button>
						</div>
					</div>
				</div>
			</div>

			<div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
				<div className="mb-6 flex flex-wrap items-center justify-between gap-3">
					<div>
						<h2 className="text-title-md font-semibold text-gray-800 dark:text-white/90">
							Prompt Rows
						</h2>
						<p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
							Click a prompt ID to load its values into the form above. Existing
							prompt rows are view-only.
						</p>
					</div>

					<div className="flex flex-wrap items-center gap-3">
						<button
							type="button"
							onClick={() => {
								setShowActiveOnly((current) => !current);
								setCurrentPage(1);
							}}
							disabled={loading}
							className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
						>
							{showActiveOnly ? "Show All Prompts" : "Show Active Only"}
						</button>
						<button
							type="button"
							onClick={() => void fetchPrompts()}
							disabled={loading || isSubmitting}
							className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
						>
							Refresh
						</button>
					</div>
				</div>

				{loading ? (
					<LoadingDots className="py-20" />
				) : prompts.length === 0 ? (
					<div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
						No AI Approver prompt rows found yet.
					</div>
				) : filteredAndSortedPrompts.length === 0 ? (
					<div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
						No prompt rows match the current filter.
					</div>
				) : (
					<div className="space-y-4">
						<div className="flex flex-wrap items-center justify-between gap-3">
							<div className="text-sm text-gray-600 dark:text-gray-400">
								Showing {paginatedPrompts.length} of {filteredAndSortedPrompts.length}
								{showActiveOnly ? ` active` : ""} prompt rows
							</div>

							<div className="flex flex-wrap items-center gap-2">
								<span className="text-sm text-gray-600 dark:text-gray-400">
									Rows per page
								</span>
								{PAGE_SIZE_OPTIONS.map((option) => (
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
						<table className="w-full min-w-[1100px]">
							<thead className="border-b border-gray-200 dark:border-gray-800">
								<tr>
									<th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300">
										<button
											type="button"
											onClick={() => handleSort("id")}
											className="flex items-center gap-1 hover:text-brand-500"
										>
											ID{getSortIndicator("id")}
										</button>
									</th>
									<th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300">
										<button
											type="button"
											onClick={() => handleSort("name")}
											className="flex items-center gap-1 hover:text-brand-500"
										>
											Name{getSortIndicator("name")}
										</button>
									</th>
									<th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300">
										<button
											type="button"
											onClick={() => handleSort("description")}
											className="flex items-center gap-1 hover:text-brand-500"
										>
											Description{getSortIndicator("description")}
										</button>
									</th>
									<th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300">
										<button
											type="button"
											onClick={() => handleSort("promptRole")}
											className="flex items-center gap-1 hover:text-brand-500"
										>
											Role{getSortIndicator("promptRole")}
										</button>
									</th>
									<th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300">
										<button
											type="button"
											onClick={() => handleSort("isActive")}
											className="flex items-center gap-1 hover:text-brand-500"
										>
											Active{getSortIndicator("isActive")}
										</button>
									</th>
									<th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300">
										<button
											type="button"
											onClick={() => handleSort("endedAt")}
											className="flex items-center gap-1 hover:text-brand-500"
										>
											Ended At{getSortIndicator("endedAt")}
										</button>
									</th>
									<th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-700 dark:text-gray-300">
										Actions
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-gray-200 dark:divide-gray-800">
								{paginatedPrompts.map((prompt) => (
									<tr
										key={prompt.id}
										className={
											sourcePrompt?.id === prompt.id
												? "bg-brand-50 dark:bg-brand-900/10"
												: ""
										}
									>
										<td className="px-4 py-4 text-sm text-gray-800 dark:text-gray-200">
											<button
												type="button"
												onClick={() => handleSelectPrompt(prompt)}
												className="font-medium text-brand-500 hover:text-brand-600 hover:underline dark:text-brand-400 dark:hover:text-brand-300"
											>
												{prompt.id}
											</button>
										</td>
										<td className="px-4 py-4 text-sm text-gray-800 dark:text-gray-200">
											<div className="font-medium">{prompt.name}</div>
										</td>
										<td className="px-4 py-4 text-sm text-gray-600 dark:text-gray-400">
											{prompt.description || "N/A"}
										</td>
										<td className="px-4 py-4 text-sm text-gray-600 dark:text-gray-400">
											{prompt.promptRole || "category_score"}
										</td>
										<td className="px-4 py-4 text-sm">
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
										<td className="px-4 py-4 text-sm text-gray-600 dark:text-gray-400">
											{prompt.endedAt
												? new Date(prompt.endedAt).toLocaleString()
												: "N/A"}
										</td>
										<td className="px-4 py-4">
											<div className="flex flex-wrap gap-2">
												<button
													type="button"
													onClick={() =>
														void handleToggleActive(prompt.id, prompt.isActive)
													}
													disabled={isSubmitting}
													className="rounded-lg border border-brand-300 px-3 py-2 text-xs font-medium text-brand-600 transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-brand-700 dark:text-brand-400 dark:hover:bg-brand-900/20"
												>
													{prompt.isActive ? "Deactivate" : "Activate"}
												</button>
												<button
													type="button"
													onClick={() =>
														setDeleteTarget({
															id: prompt.id,
															name: prompt.name,
														})
													}
													disabled={isSubmitting}
													className="rounded-lg border border-red-300 px-3 py-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
												>
													Delete
												</button>
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
						</div>

						<div className="flex flex-wrap items-center justify-between gap-3">
							<div className="text-sm text-gray-600 dark:text-gray-400">
								Page {safeCurrentPage} of {totalPages}
							</div>

							<div className="flex items-center gap-2">
								<button
									type="button"
									onClick={() =>
										setCurrentPage((current) =>
											Math.max(1, Math.min(current, totalPages) - 1)
										)
									}
									disabled={safeCurrentPage === 1}
									className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
								>
									Previous
								</button>
								<button
									type="button"
									onClick={() =>
										setCurrentPage((current) =>
											Math.min(totalPages, Math.min(current, totalPages) + 1)
										)
									}
									disabled={safeCurrentPage === totalPages}
									className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
								>
									Next
								</button>
							</div>
						</div>
					</div>
				)}
			</div>

			<Modal
				isOpen={feedbackModal.show}
				onClose={() => setFeedbackModal(DEFAULT_FEEDBACK_MODAL_STATE)}
			>
				<ModalInformationOk
					title={feedbackModal.title}
					message={feedbackModal.message}
					variant={feedbackModal.variant}
					onClose={() => setFeedbackModal(DEFAULT_FEEDBACK_MODAL_STATE)}
				/>
			</Modal>

			<Modal
				isOpen={showCopyConfirmModal}
				onClose={() => setShowCopyConfirmModal(false)}
				className="max-w-xl"
			>
				<ModalInformationYesOrNo
					title="Copy and Create New Prompt?"
					message={`A new prompt row will be created from source prompt ${sourcePrompt?.id ?? ""}. Make sure you give it a new name and description before continuing. A new ID will be created for the copied prompt.`}
					onYes={() => void handleCreatePrompt()}
					onClose={() => setShowCopyConfirmModal(false)}
					yesButtonText="Yes, Create Copy"
					noButtonText="Cancel"
					yesButtonStyle="primary"
				/>
			</Modal>

			<Modal
				isOpen={deleteTarget !== null}
				onClose={() => setDeleteTarget(null)}
				className="max-w-xl"
			>
				<div className="p-6 sm:p-8">
					<h2 className="text-xl font-semibold text-gray-900 dark:text-white">
						Delete Prompt?
					</h2>
					<p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
						Delete prompt row{" "}
						<span className="font-medium text-gray-900 dark:text-white">
							{deleteTarget?.name}
						</span>
						. This is a hard delete and will only succeed if no
						`AiApproverArticleScores` rows reference this prompt version.
					</p>

					<div className="mt-6 flex justify-end gap-3">
						<button
							type="button"
							onClick={() => setDeleteTarget(null)}
							className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
						>
							Cancel
						</button>
						<button
							type="button"
							onClick={() => void handleDeletePrompt()}
							disabled={isSubmitting}
							className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-red-600 dark:hover:bg-red-700"
						>
							{isSubmitting ? "Deleting..." : "Delete"}
						</button>
					</div>
				</div>
			</Modal>
		</div>
	);
}
