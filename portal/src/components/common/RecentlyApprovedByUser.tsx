"use client";
import React, { useEffect, useState } from "react";
import { useAppSelector } from "@/store/hooks";
import { LoadingDots } from "./LoadingDots";
import {
	TableRecentlyApprovedByUser,
	ApprovedArticleForComponent,
} from "@/components/tables/TableRecentlyApprovedByUser";

interface RecentlyApprovedByUserProps {
	onClose?: () => void;
}

export const RecentlyApprovedByUser: React.FC<
	RecentlyApprovedByUserProps
> = ({ onClose }) => {
	const { token, username } = useAppSelector((state) => state.user);
	const [articlesArray, setArticlesArray] = useState<
		ApprovedArticleForComponent[]
	>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const fetchApprovedArticles = async () => {
		if (!token) return;

		setIsLoading(true);
		setError(null);
		try {
			const response = await fetch(
				`${process.env.NEXT_PUBLIC_API_BASE_URL}/articles-approveds/for-component`,
				{
					headers: { Authorization: `Bearer ${token}` },
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
			console.error(
				"Error fetching recently approved articles:",
				error instanceof Error ? error.message : error
			);
			setError("Failed to load recently approved articles");
			setArticlesArray([]);
		} finally {
			setIsLoading(false);
		}
	};

	useEffect(() => {
		fetchApprovedArticles();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	if (isLoading) {
		return (
			<div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
				<LoadingDots className="py-20" />
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<div className="relative rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
				{/* Close button in top-left */}
				{onClose && (
					<button
						onClick={onClose}
						className="absolute -top-2 -left-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-gray-700 text-white transition-colors hover:bg-gray-800 dark:bg-gray-600 dark:hover:bg-gray-700"
						aria-label="Close recently approved by user"
					>
						✕
					</button>
				)}

				{/* Header */}
				<div className="mb-4 flex items-center justify-between">
					<h2 className="text-lg font-semibold text-gray-800 dark:text-white">
						Recently Approved by {username || "Me"}
					</h2>
					<button
						onClick={fetchApprovedArticles}
						disabled={isLoading}
						className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-brand-600 dark:hover:bg-brand-700"
					>
						Refresh
					</button>
				</div>

				{/* Error Message */}
				{error && (
					<div className="mb-4 rounded-lg bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
						{error}
					</div>
				)}

				{/* Table */}
				<TableRecentlyApprovedByUser data={articlesArray} />
			</div>
		</div>
	);
};
