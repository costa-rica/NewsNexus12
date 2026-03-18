"use client";

import React, { useEffect, useMemo, useState } from "react";
import { LoadingDots } from "@/components/common/LoadingDots";
import { useAppSelector } from "@/store/hooks";
import type {
  AiApproverArticleDetailsResponse,
  AiApproverScoreRow,
} from "@/types/article";
import { Modal } from "./index";
import { ModalInformationOk } from "./ModalInformationOk";

interface ModalAiApproverDetailsProps {
  articleId: number;
  onClose: () => void;
  onScoresUpdated?: (articleId: number) => void;
}

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

function getStatusLabel(value: boolean | null): string {
  if (value === true) return "approve";
  if (value === false) return "reject";
  return "undetermined";
}

function scoreCircleStyle(score: number) {
  const normalized = Math.max(0, Math.min(1, Number(score)));
  const green = Math.floor(normalized * 200);
  return {
    backgroundColor: `rgb(${128 - green / 3}, ${green}, ${128 - green / 3})`,
  };
}

const ModalAiApproverDetails: React.FC<ModalAiApproverDetailsProps> = ({
  articleId,
  onClose,
  onScoresUpdated,
}) => {
  const { token } = useAppSelector((state) => state.user);
  const [details, setDetails] = useState<AiApproverArticleDetailsResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPromptIds, setExpandedPromptIds] = useState<number[]>([]);
  const [humanApprovalValue, setHumanApprovalValue] = useState<boolean | null>(null);
  const [reasonHumanRejected, setReasonHumanRejected] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedbackModal, setFeedbackModal] = useState<FeedbackModalState>(
    DEFAULT_FEEDBACK_MODAL_STATE,
  );

  const fetchDetails = async () => {
    if (!token) {
      setError("Authentication token not found");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/analysis/ai-approver/article/${articleId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch AI approver details: ${response.statusText}`);
      }

      const data = (await response.json()) as AiApproverArticleDetailsResponse;
      setDetails(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchDetails();
  }, [articleId, token]);

  const topEligibleScore = useMemo(() => {
    if (!details) return null;
    return (
      details.scores.find((score) => score.id === details.topEligibleScoreId) ?? null
    );
  }, [details]);

  useEffect(() => {
    if (!topEligibleScore) {
      setHumanApprovalValue(null);
      setReasonHumanRejected("");
      return;
    }

    setHumanApprovalValue(topEligibleScore.isHumanApproved);
    setReasonHumanRejected(topEligibleScore.reasonHumanRejected ?? "");
  }, [topEligibleScore]);

  const togglePrompt = (promptId: number) => {
    setExpandedPromptIds((current) =>
      current.includes(promptId)
        ? current.filter((id) => id !== promptId)
        : [...current, promptId],
    );
  };

  const handleValidate = async () => {
    if (!topEligibleScore) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/analysis/ai-approver/human-verify/${topEligibleScore.id}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            isHumanApproved: humanApprovalValue,
            reasonHumanRejected:
              humanApprovalValue === false ? reasonHumanRejected : null,
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Failed to update human validation");
      }

      await fetchDetails();
      onScoresUpdated?.(articleId);
      setFeedbackModal({
        show: true,
        title: "Success",
        message: "AI approver human validation updated.",
        variant: "success",
      });
    } catch (err) {
      setFeedbackModal({
        show: true,
        title: "Error",
        message: err instanceof Error ? err.message : "An error occurred",
        variant: "error",
      });
    } finally {
      setIsSubmitting(false);
    }
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

  if (error || !details) {
    return (
      <Modal isOpen={true} onClose={onClose}>
        <div className="p-6 sm:p-8">
          <h2 className="mb-4 text-2xl font-semibold text-gray-900 dark:text-white">
            Error
          </h2>
          <p className="text-red-600 dark:text-red-400">
            {error || "Failed to load AI approver details"}
          </p>
        </div>
      </Modal>
    );
  }

  return (
    <>
      <Modal isOpen={true} onClose={onClose} className="max-w-5xl">
        <div className="max-h-[90vh] overflow-y-auto p-6 sm:p-8">
          <div className="mb-6">
            <h2 className="mb-2 text-2xl font-semibold text-gray-900 dark:text-white">
              AI Approver Details
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Article ID: {articleId}
            </p>
          </div>

          <div className="space-y-4">
            {details.scores.length === 0 ? (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-300">
                No AI approver scores found for this article.
              </div>
            ) : (
              details.scores.map((score: AiApproverScoreRow) => {
                const isExpanded = expandedPromptIds.includes(score.id);
                const isTopEligible = score.id === details.topEligibleScoreId;

                return (
                  <div
                    key={score.id}
                    className={`rounded-xl border p-4 ${
                      isTopEligible
                        ? "border-brand-300 bg-brand-50 dark:border-brand-700 dark:bg-brand-900/10"
                        : "border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900/20"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex justify-center">
                        {score.score !== null ? (
                          <span
                            className="flex h-10 w-10 items-center justify-center rounded-full text-xs font-semibold"
                            style={scoreCircleStyle(score.score)}
                          >
                            {Math.round(score.score * 100)}%
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">N/A</span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => togglePrompt(score.id)}
                        className="text-sm font-semibold text-brand-500 hover:text-brand-600 hover:underline dark:text-brand-400 dark:hover:text-brand-300"
                      >
                        {score.promptVersion?.name || `Prompt ${score.promptVersionId}`}
                      </button>

                      <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                        {score.resultStatus}
                      </span>

                      {isTopEligible && (
                        <span className="rounded-full bg-brand-500 px-2.5 py-1 text-xs text-white">
                          current top
                        </span>
                      )}
                    </div>

                    <div className="mt-3 text-sm text-gray-700 dark:text-gray-300">
                      {score.reason ? (
                        <p>{score.reason}</p>
                      ) : (
                        <p className="italic text-gray-500 dark:text-gray-400">
                          {score.errorMessage || "No reason provided."}
                        </p>
                      )}
                    </div>

                    {isExpanded && score.promptVersion?.promptInMarkdown && (
                      <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                          Prompt
                        </p>
                        <pre className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">
                          {score.promptVersion.promptInMarkdown}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div className="mt-8 rounded-xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-700 dark:bg-gray-900/20">
            <h3 className="mb-3 text-lg font-semibold text-gray-900 dark:text-white">
              Human Validation
            </h3>

            {topEligibleScore ? (
              <div className="space-y-4">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  This validation applies only to the current highest non-rejected
                  score row. Accepting this score does not approve the article for
                  the report.
                </p>

                <div className="flex flex-wrap gap-2">
                  {[
                    { label: "Approve", value: true },
                    { label: "Reject", value: false },
                    { label: "Undetermined", value: null },
                  ].map((option) => (
                    <button
                      key={option.label}
                      type="button"
                      onClick={() => setHumanApprovalValue(option.value)}
                      className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                        humanApprovalValue === option.value
                          ? "bg-brand-500 text-white"
                          : "bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                {humanApprovalValue === false && (
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
                      Rejection Reason
                    </label>
                    <input
                      type="text"
                      value={reasonHumanRejected}
                      onChange={(event) => setReasonHumanRejected(event.target.value)}
                      className="h-11 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                      placeholder="Why should this score be rejected?"
                    />
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => void handleValidate()}
                  disabled={
                    isSubmitting ||
                    (humanApprovalValue === false &&
                      reasonHumanRejected.trim().length === 0)
                  }
                  className="rounded-lg bg-brand-500 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-brand-600 dark:hover:bg-brand-700"
                >
                  {isSubmitting
                    ? "Validating Human Approval Status..."
                    : "Validate Human Approval Status"}
                </button>

                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Current selection: {getStatusLabel(humanApprovalValue)}
                </p>
              </div>
            ) : (
              <p className="text-sm text-gray-600 dark:text-gray-400">
                No eligible score row is available for human validation.
              </p>
            )}
          </div>
        </div>
      </Modal>

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
    </>
  );
};

export default ModalAiApproverDetails;
