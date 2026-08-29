"use client";

import React, { useEffect, useState } from "react";
import { LoadingDots } from "@/components/common/LoadingDots";
import { useAppSelector } from "@/store/hooks";
import type { ReviewArticleContentResponse } from "@/types/article";
import { Modal } from "./index";

interface ModalReviewArticleContentProps {
	articleId: number;
	onClose: () => void;
}

const ModalReviewArticleContent: React.FC<ModalReviewArticleContentProps> = ({
	articleId,
	onClose,
}) => {
	const { token } = useAppSelector((state) => state.user);
	const [details, setDetails] = useState<ReviewArticleContentResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

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
					`${process.env.NEXT_PUBLIC_API_BASE_URL}/articles/review-selected-content/${articleId}`,
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

	return (
		<Modal isOpen={true} onClose={onClose} className="max-w-6xl">
			<div className="max-h-[90vh] overflow-y-auto p-6 sm:p-8">
				<div className="mb-6">
					<h2 className="mb-2 text-2xl font-semibold text-gray-900 dark:text-white">
						Article Content
					</h2>
					<p className="text-sm text-gray-500 dark:text-gray-400">
						Read-only article content
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
					</div>
				)}
			</div>
		</Modal>
	);
};

export default ModalReviewArticleContent;
