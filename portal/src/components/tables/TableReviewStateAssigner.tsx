"use client";
import React, { useState, useMemo } from "react";
import {
	useReactTable,
	getCoreRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	getFilteredRowModel,
	flexRender,
	createColumnHelper,
	SortingState,
	PaginationState,
} from "@tanstack/react-table";
import Link from "next/link";
import type { StateAssignerArticle } from "@/types/article";
import { CheckCircleIcon } from "@/icons";
import ModalStateAssignerDetails from "@/components/ui/modal/ModalStateAssignerDetails";
import { useAppSelector } from "@/store/hooks";

// Create columnHelper outside component for stable reference
const columnHelper = createColumnHelper<StateAssignerArticle>();

interface TableReviewStateAssignerProps {
	data: StateAssignerArticle[];
	onArticleUpdate: (articleId: number, isHumanApproved: boolean) => void;
}

const TableReviewStateAssigner: React.FC<TableReviewStateAssignerProps> = ({
	data,
	onArticleUpdate,
}) => {
	const [pagination, setPagination] = useState<PaginationState>({
		pageIndex: 0,
		pageSize: 10,
	});
	const [sorting, setSorting] = useState<SortingState>([]);
	const [globalFilter, setGlobalFilter] = useState("");
	const [selectedArticleId, setSelectedArticleId] = useState<number | null>(
		null
	);
	const { token } = useAppSelector((state) => state.user);

	const handleApproveReject = async (
		articleId: number,
		stateId: number,
		currentIsHumanApproved: boolean
	) => {
		const action = currentIsHumanApproved ? "reject" : "approve";

		try {
			const response = await fetch(
				`${process.env.NEXT_PUBLIC_API_BASE_URL}/analysis/state-assigner/human-verify/${articleId}`,
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${token}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						action,
						stateId,
					}),
				}
			);

			if (!response.ok) {
				throw new Error(`Failed to ${action} article`);
			}

			const result = await response.json();

			// Update local state
			onArticleUpdate(articleId, result.stateAiApproved.isHumanApproved);
		} catch (error) {
			console.error(`Error ${action}ing article:`, error);
		}
	};

	const columns = useMemo(
		() => [
			columnHelper.accessor("id", {
				header: "ID",
				enableSorting: true,
				cell: ({ row }) => (
					<span className="text-xs text-gray-700 dark:text-gray-300">
						{row.original.id}
					</span>
				),
			}),
			columnHelper.accessor("title", {
				header: "Title",
				enableSorting: true,
				cell: ({ getValue }) => (
					<div className="text-xs max-w-md">{getValue()}</div>
				),
			}),
			columnHelper.accessor("url", {
				header: "URL",
				enableSorting: true,
				cell: ({ getValue }) => {
					const rawUrl = getValue();
					if (!rawUrl) return null;

					const strippedUrl = rawUrl
						.replace(/^https?:\/\//, "")
						.replace(/^www\./, "");

					return (
						<div className="text-xs relative group">
							<Link
								href={rawUrl}
								target="_blank"
								className="text-brand-500 hover:text-brand-600 visited:text-purple-600 dark:text-brand-400 dark:visited:text-purple-400"
							>
								{strippedUrl.slice(0, 30)}
							</Link>
							<span className="invisible group-hover:visible absolute left-0 top-full mt-1 px-2 py-1 bg-gray-800 text-white text-xs rounded z-10 whitespace-nowrap">
								{rawUrl}
							</span>
						</div>
					);
				},
			}),
			columnHelper.accessor("publishedDate", {
				header: "Published Date",
				enableSorting: true,
				cell: ({ getValue }) => {
					const dateString = getValue();
					if (!dateString) return <div className="text-xs">N/A</div>;

					const date = new Date(dateString);
					const formattedDate = date.toLocaleDateString("en-US", {
						year: "numeric",
						month: "short",
						day: "numeric",
					});

					return <div className="text-xs">{formattedDate}</div>;
				},
			}),
			columnHelper.accessor("stateAssignment.stateName", {
				header: "State",
				enableSorting: true,
				cell: ({ getValue }) => (
					<div className="text-xs">{getValue()}</div>
				),
			}),
			columnHelper.accessor("semanticRatingMax", {
				header: "Nexus Semantic Rating",
				enableSorting: true,
				cell: ({ getValue }) => {
					const value = getValue();
					if (value === null || value === undefined) {
						return <div className="text-center text-xs">N/A</div>;
					}
					const normalized = Math.max(0, Math.min(1, Number(value)));
					const green = Math.floor(normalized * 200);
					const color = `rgb(${128 - green / 3}, ${green}, ${128 - green / 3})`;
					const percent = Math.round(normalized * 100);
					return (
						<div className="flex justify-center">
							<span
								className="flex items-center justify-center w-10 h-10 rounded-full text-xs font-semibold"
								style={{ backgroundColor: color }}
							>
								{percent}%
							</span>
						</div>
					);
				},
			}),
			columnHelper.accessor("locationClassifierScore", {
				header: "Nexus Location Rating",
				enableSorting: true,
				cell: ({ getValue }) => {
					const value = getValue();
					if (value === null || value === undefined) {
						return <div className="text-center text-xs">N/A</div>;
					}
					const normalized = Math.max(0, Math.min(1, Number(value)));
					const green = Math.floor(normalized * 200);
					const color = `rgb(${128 - green / 3}, ${green}, ${128 - green / 3})`;
					const percent = Math.round(normalized * 100);
					return (
						<div className="flex justify-center">
							<span
								className="flex items-center justify-center w-10 h-10 rounded-full text-xs font-semibold"
								style={{ backgroundColor: color }}
							>
								{percent}%
							</span>
						</div>
					);
				},
			}),
			columnHelper.accessor("stateAssignment.isHumanApproved", {
				header: "Human Approved",
				enableSorting: true,
				cell: ({ row }) => {
					const article = row.original;
					const isApproved = article.stateAssignment.isHumanApproved;
					const stateId = article.stateAssignment.stateId;
					const canVerifyState = stateId !== null;

					return (
						<div className="flex justify-center">
							<button
								onClick={() =>
									canVerifyState &&
									handleApproveReject(article.id, stateId, isApproved)
								}
								disabled={!canVerifyState}
								className={`p-1 rounded transition-colors ${
									isApproved
										? "text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
										: "text-gray-400 hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-500"
								} disabled:cursor-not-allowed disabled:opacity-40`}
								title={
									canVerifyState
										? isApproved
											? "Approved - Click to reject"
											: "Unapproved - Click to approve"
										: "No AI state to approve"
								}
							>
								<CheckCircleIcon className="w-6 h-6" />
							</button>
						</div>
					);
				},
			}),
			columnHelper.display({
				id: "details",
				header: "",
				cell: ({ row }) => {
					const article = row.original;

					return (
						<div className="flex justify-center">
							<button
								onClick={() => setSelectedArticleId(article.id)}
								className="px-3 py-1 text-xs text-white bg-brand-500 rounded hover:bg-brand-600 dark:bg-brand-400 dark:hover:bg-brand-500 transition-colors"
							>
								Details
							</button>
						</div>
					);
				},
			}),
		],
		[onArticleUpdate, token]
	);

	const table = useReactTable({
		data,
		columns,
		getCoreRowModel: getCoreRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		state: {
			pagination,
			sorting,
			globalFilter,
		},
		onSortingChange: setSorting,
		onPaginationChange: setPagination,
		onGlobalFilterChange: setGlobalFilter,
		autoResetPageIndex: false,
	});

	return (
		<>
			<div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
				{/* Table Controls */}
				<div className="flex flex-wrap items-center justify-between gap-4 p-4 border-b border-gray-200 dark:border-gray-800">
					{/* Show rows */}
					<div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
						<span>Show rows:</span>
						{[5, 10, 20].map((size) => (
							<button
								key={size}
								onClick={() =>
									setPagination((prev) => ({
										...prev,
										pageSize: size,
										pageIndex: 0,
									}))
								}
								className={`px-3 py-1 rounded ${
									pagination.pageSize === size
										? "bg-brand-500 text-white"
										: "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
								}`}
							>
								{size}
							</button>
						))}
					</div>

					{/* Search */}
					<div className="flex-1 max-w-xs">
						<input
							type="text"
							value={globalFilter ?? ""}
							onChange={(e) => setGlobalFilter(e.target.value)}
							className="w-full h-9 rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-theme-xs focus:outline-hidden focus:border-brand-300 focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
							placeholder="Search..."
						/>
					</div>

					{/* Pagination */}
					<div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
						<button
							onClick={() => table.previousPage()}
							disabled={!table.getCanPreviousPage()}
							className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-gray-800 dark:hover:bg-gray-700"
						>
							&lt; Prev
						</button>
						<span>
							Page {table.getState().pagination.pageIndex + 1} of{" "}
							{table.getPageCount()}
						</span>
						<button
							onClick={() => table.nextPage()}
							disabled={!table.getCanNextPage()}
							className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-gray-800 dark:hover:bg-gray-700"
						>
							Next &gt;
						</button>
					</div>
				</div>

				{/* Table */}
				<div>
					<table className="w-full">
						<thead className="bg-gray-50 dark:bg-gray-800/50">
							{table.getHeaderGroups().map((headerGroup) => (
								<tr key={headerGroup.id}>
									{headerGroup.headers.map((header) => (
										<th
											key={header.id}
											onClick={header.column.getToggleSortingHandler()}
											className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
										>
											<div className="flex items-center gap-1">
												{flexRender(
													header.column.columnDef.header,
													header.getContext()
												)}
												{{
													asc: " ▲",
													desc: " ▼",
												}[header.column.getIsSorted() as string] ?? ""}
											</div>
										</th>
									))}
								</tr>
							))}
						</thead>
						<tbody className="divide-y divide-gray-200 dark:divide-gray-800">
							{table.getPaginationRowModel().rows.map((row) => (
								<tr
									key={row.id}
									className="transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50"
								>
									{row.getVisibleCells().map((cell) => (
										<td
											key={cell.id}
											className="px-4 py-3 text-sm text-gray-800 dark:text-gray-200"
										>
											{flexRender(cell.column.columnDef.cell, cell.getContext())}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</div>

			{/* Modal */}
			{selectedArticleId && (
				<ModalStateAssignerDetails
					articleId={selectedArticleId}
					onClose={() => setSelectedArticleId(null)}
					onArticleUpdate={onArticleUpdate}
				/>
			)}
		</>
	);
};

export default TableReviewStateAssigner;
