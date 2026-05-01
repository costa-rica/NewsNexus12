"use client";
import React, { useState, useEffect } from "react";
import { Modal } from "./index";
import { ModalInformationOk } from "./ModalInformationOk";
import { useAppSelector } from "@/store/hooks";
import type { ArticleDetailsResponse } from "@/types/article";
import { LoadingDots } from "@/components/common/LoadingDots";
import { ChevronDownIcon, ChevronUpIcon } from "@/icons";

interface ModalStateAssignerDetailsProps {
  articleId: number;
  onClose: () => void;
  onArticleUpdate?: (articleId: number, isHumanApproved: boolean) => void;
  showFullDetails?: boolean;
}

const ModalStateAssignerDetails: React.FC<ModalStateAssignerDetailsProps> = ({
  articleId,
  onClose,
  onArticleUpdate,
  showFullDetails = true,
}) => {
  const [articleDetails, setArticleDetails] =
    useState<ArticleDetailsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isContentExpanded, setIsContentExpanded] = useState(true);
  const [feedbackModal, setFeedbackModal] = useState<{
    show: boolean;
    title: string;
    message: string;
    variant: "success" | "error";
  } | null>(null);

  const { token } = useAppSelector((state) => state.user);

  useEffect(() => {
    const fetchArticleDetails = async () => {
      if (!token) {
        setError("Authentication token not found");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_BASE_URL}/articles/article-details/${articleId}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        );

        if (!response.ok) {
          throw new Error(
            `Failed to fetch article details: ${response.statusText}`,
          );
        }

        const data = await response.json();
        setArticleDetails(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setLoading(false);
      }
    };

    fetchArticleDetails();
  }, [articleId, token]);

  const handleApproveReject = async () => {
    if (!articleDetails || !articleDetails.stateAiApproved?.state) return;

    const action = articleDetails.stateAiApproved.isHumanApproved
      ? "reject"
      : "approve";

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
            stateId: articleDetails.stateAiApproved.state.id,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to ${action} article`);
      }

      const result = await response.json();

      // Update local state
      setArticleDetails((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          stateAiApproved: result.stateAiApproved,
          stateHumanApprovedArray: result.stateHumanApprovedArray,
        };
      });

      // Update parent component state
      onArticleUpdate?.(articleId, result.stateAiApproved.isHumanApproved);

      // Show success feedback
      setFeedbackModal({
        show: true,
        title: "Success",
        message: `Article state ${action}d successfully`,
        variant: "success",
      });
    } catch (err) {
      // Show error feedback
      setFeedbackModal({
        show: true,
        title: "Error",
        message: err instanceof Error ? err.message : "An error occurred",
        variant: "error",
      });
    }
  };

  const closeFeedbackModal = () => {
    setFeedbackModal(null);
  };

  if (loading) {
    return (
      <Modal isOpen={true} onClose={onClose}>
        <div className="p-6 sm:p-8">
          <LoadingDots className="py-20" />
        </div>
      </Modal>
    );
  }

  if (error || !articleDetails) {
    return (
      <Modal isOpen={true} onClose={onClose}>
        <div className="p-6 sm:p-8">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">
            Error
          </h2>
          <p className="text-red-600 dark:text-red-400">
            {error || "Failed to load article details"}
          </p>
        </div>
      </Modal>
    );
  }

  const humanApprovedStates =
    articleDetails.stateHumanApprovedArray &&
    articleDetails.stateHumanApprovedArray.length > 0
      ? articleDetails.stateHumanApprovedArray.map((s) => s.name).join(", ")
      : "No Human Approved";

  const buttonText = articleDetails.stateAiApproved?.isHumanApproved
    ? "Reject"
    : "Approve";
  const buttonStyle = articleDetails.stateAiApproved?.isHumanApproved
    ? "bg-error-500 hover:bg-error-600 dark:bg-error-600 dark:hover:bg-error-700"
    : "bg-success-500 hover:bg-success-600 dark:bg-success-600 dark:hover:bg-success-700";

  return (
    <>
      <Modal isOpen={true} onClose={onClose} className="max-w-4xl">
        <div className="p-6 sm:p-8 max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="mb-6">
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-2">
              Article Details
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              ID: {articleDetails.articleId}
            </p>
          </div>

          {/* Title */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              {articleDetails.title}
            </h3>
          </div>

          {/* AI Approved State */}
          {articleDetails.stateAiApproved && (
            <div className="mb-6 p-4 rounded-lg bg-blue-light-50 dark:bg-blue-light-900/20 border border-blue-light-200 dark:border-blue-light-800">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                AI Approved State:{" "}
                {articleDetails.stateAiApproved.state?.name ?? "No state"}
              </h4>
              <p className="text-sm text-gray-700 dark:text-gray-300">
                <span className="font-medium">Reasoning:</span>{" "}
                {articleDetails.stateAiApproved.reasoning || "No reasoning provided."}
              </p>
            </div>
          )}

          {showFullDetails && (
            <div className="mb-6 p-4 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
              <p className="text-sm text-gray-700 dark:text-gray-300">
                <span className="font-medium">Human Approved:</span>{" "}
                {humanApprovedStates}
              </p>
            </div>
          )}

          {showFullDetails && (
            <div className="mb-6">
              <button
                onClick={() => setIsContentExpanded(!isContentExpanded)}
                className="w-full flex items-center justify-between p-4 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <span className="text-sm font-semibold text-gray-900 dark:text-white">
                  Article Content
                </span>
                {isContentExpanded ? (
                  <ChevronUpIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                ) : (
                  <ChevronDownIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                )}
              </button>
              {isContentExpanded && (
                <div className="mt-2 p-4 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
                  {articleDetails.content ? (
                    <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap max-h-96 overflow-y-auto">
                      {articleDetails.content}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                      Content not available
                    </p>
                  )}

                  <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                    <h5 className="text-xs font-semibold text-gray-700 dark:text-gray-400 uppercase mb-2">
                      Description
                    </h5>
                    {articleDetails.description ? (
                      <p className="text-sm text-gray-700 dark:text-gray-300">
                        {articleDetails.description}
                      </p>
                    ) : (
                      <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                        Description not available
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {showFullDetails && articleDetails.stateAiApproved?.state && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleApproveReject}
                className={`px-6 py-2 rounded-lg font-medium text-white transition-colors ${buttonStyle}`}
              >
                {buttonText}
              </button>
            </div>
          )}
        </div>
      </Modal>

      {/* Feedback Modal */}
      {showFullDetails && feedbackModal && (
        <Modal isOpen={feedbackModal.show} onClose={closeFeedbackModal}>
          <ModalInformationOk
            title={feedbackModal.title}
            message={feedbackModal.message}
            onClose={closeFeedbackModal}
            variant={feedbackModal.variant}
          />
        </Modal>
      )}
    </>
  );
};

export default ModalStateAssignerDetails;
