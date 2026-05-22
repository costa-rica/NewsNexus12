"use client";
import React, { useState, useEffect, useCallback } from "react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import {
  updateStateArray,
  toggleShowSummaryStatistics,
  toggleShowRecentlyApprovedByUser,
} from "@/store/features/user/userSlice";
import { SummaryStatistics } from "@/components/common/SummaryStatistics";
import { RecentlyApprovedByUser } from "@/components/common/RecentlyApprovedByUser";
import MultiSelect from "@/components/form/MultiSelect";
import TableApprovedArticlesChatGpt from "@/components/tables/TableApprovedArticlesChatGpt";
import { Modal } from "@/components/ui/modal";
import { ModalInformationOk } from "@/components/ui/modal/ModalInformationOk";
import type { ChatGPTApprovedArticle } from "@/types/article";

interface State {
  id: number;
  name: string;
}

interface ArticleForm {
  id?: number;
  publicationName?: string;
  title?: string;
  url?: string;
  publishedDate?: string;
  content?: string;
  States?: State[];
}

export default function ApprovedChatGptPage() {
  const dispatch = useAppDispatch();
  const userReducer = useAppSelector((state) => state.user);
  const { token, stateArray = [] } = userReducer;

  const [articleForm, setArticleForm] = useState<ArticleForm>({});
  const [articlesArray, setArticlesArray] = useState<ChatGPTApprovedArticle[]>(
    []
  );
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

  const updateStateArrayWithArticleState = useCallback(
    (article: { States?: State[] }) => {
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
    },
    [dispatch, stateArray]
  );

  const fetchArticlesArray = useCallback(async () => {
    if (!token) return;

    try {
      setLoadingTable(true);
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/analysis/llm04/approved`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          method: "GET",
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server Error: ${errorText}`);
      }

      const result = await response.json();

      if (result.articlesArray && Array.isArray(result.articlesArray)) {
        console.log(result.articlesArray);
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
  }, [token]);

  const handleSelectArticle = (article: ChatGPTApprovedArticle) => {
    // Populate form with article data
    const formData: ArticleForm = {
      id: article.id,
      title: article.title,
      publicationName: article.publicationName,
      publishedDate: article.publishedDate?.split("T")[0], // Format date for input
      url: article.url,
      content: article.ArticlesApproved02?.[0]?.textForPdfReport || "",
      States: article.States,
    };
    setArticleForm(formData);

    // Update state selection
    updateStateArrayWithArticleState(article);
  };

  const handleArticleHumanApproved = async (articleId: number) => {
    if (!token) return;

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/analysis/llm04/human-approved/${articleId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          method: "GET",
        }
      );

      const result = await response.json();

      if (response.ok) {
        setAlertModal({
          show: true,
          variant: "success",
          title: "Success",
          message: result.message || "Successfully human approved article",
        });
        // Refresh the articles list after approval
        fetchArticlesArray();
      } else {
        setAlertModal({
          show: true,
          variant: "error",
          title: "Error",
          message: result.error || "Failed to approve article",
        });
      }
    } catch (error) {
      console.error("Error approving article:", error);
      setAlertModal({
        show: true,
        variant: "error",
        title: "Error",
        message: "An error occurred while approving the article",
      });
    }
  };

  useEffect(() => {
    fetchArticlesArray();
  }, [fetchArticlesArray]);

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <h1 className="text-title-xl text-gray-700 dark:text-gray-300">
        Approved ChatGPT Analysis
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
          {articleForm?.id && (
            <div className="mb-6 pb-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
                Article ID: {articleForm.id}
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
              value={articleForm?.publicationName || ""}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white max-w-2xl"
              onChange={(e) =>
                setArticleForm({
                  ...articleForm,
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
              value={articleForm?.title || ""}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white max-w-2xl"
              onChange={(e) =>
                setArticleForm({ ...articleForm, title: e.target.value })
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
              value={articleForm?.url || ""}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white max-w-2xl"
              onChange={(e) =>
                setArticleForm({ ...articleForm, url: e.target.value })
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
              value={articleForm?.publishedDate || ""}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white max-w-xs"
              onChange={(e) =>
                setArticleForm({
                  ...articleForm,
                  publishedDate: e.target.value,
                })
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
              value={articleForm?.content || ""}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white min-h-[200px]"
              onChange={(e) =>
                setArticleForm({
                  ...articleForm,
                  content: e.target.value,
                })
              }
            />
          </div>
        </div>
      </div>

      {/* Articles Table */}
      <TableApprovedArticlesChatGpt
        data={articlesArray}
        loading={loadingTable}
        onSelectArticle={handleSelectArticle}
        onHumanApprove={handleArticleHumanApproved}
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
    </div>
  );
}
