"use client";

import React, { useState } from "react";
import { useAppSelector } from "@/store/hooks";
import { CollapsibleAutomationSection } from "@/components/automations/CollapsibleAutomationSection";
import { WorkerNodeJobStatusPanel } from "@/components/automations/WorkerNodeJobStatusPanel";
import { Modal } from "@/components/ui/modal";
import { ModalInformationOk } from "@/components/ui/modal/ModalInformationOk";
import { ArticleTargetingFields } from "@/components/automations/ArticleTargetingFields";
import { ARTICLE_AUTOMATION_DEFAULTS } from "@/components/automations/articleTargetingDefaults";
import { InfoIcon } from "@/icons";

type AlertModalState = {
  message: string;
  show: boolean;
  title: string;
  variant: "error" | "info" | "success" | "warning";
};

const DEFAULT_ALERT_MODAL_STATE: AlertModalState = {
  message: "",
  show: false,
  title: "",
  variant: "info",
};

const ARTICLE_CONTENT_SCRAPER_ENDPOINT_NAME = "/article-content-scraper/start-job";

function buildWorkerNodeResponseMessage(result: {
  endpointName?: string;
  jobId?: string;
  status?: string;
}): string {
  return [
    result.jobId ? `Job ID: ${result.jobId}` : null,
    result.status ? `Status: ${result.status}` : null,
    result.endpointName ? `Endpoint: ${result.endpointName}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function getErrorMessage(errorBody: string): string {
  try {
    const parsed = JSON.parse(errorBody) as {
      error?: { message?: string; details?: Array<{ field: string; message: string }> };
      message?: string;
    };

    if (parsed.error?.details && parsed.error.details.length > 0) {
      return parsed.error.details
        .map((detail) => `${detail.field}: ${detail.message}`)
        .join("\n");
    }

    if (parsed.error?.message) {
      return parsed.error.message;
    }

    if (parsed.message) {
      return parsed.message;
    }
  } catch (_error) {
    return errorBody;
  }

  return errorBody;
}

export function ScrapeArticleContentSection() {
  const { token } = useAppSelector((state) => state.user);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [targetArticleThresholdDaysOld, setTargetArticleThresholdDaysOld] =
    useState(ARTICLE_AUTOMATION_DEFAULTS.targetArticleThresholdDaysOld);
  const [targetArticleStateReviewCount, setTargetArticleStateReviewCount] =
    useState(ARTICLE_AUTOMATION_DEFAULTS.targetArticleStateReviewCount);
  const [
    includeArticlesThatMightHaveBeenStateAssigned,
    setIncludeArticlesThatMightHaveBeenStateAssigned,
  ] = useState(false);
  const [alertModal, setAlertModal] = useState<AlertModalState>(
    DEFAULT_ALERT_MODAL_STATE,
  );

  const handleStartScraper = async () => {
    setIsSubmitting(true);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/automations/article-content-scraper/start-job`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          method: "POST",
          body: JSON.stringify({
            targetArticleThresholdDaysOld: Number(targetArticleThresholdDaysOld),
            targetArticleStateReviewCount: Number(targetArticleStateReviewCount),
            includeArticlesThatMightHaveBeenStateAssigned,
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(getErrorMessage(errorText));
      }

      const result = (await response.json()) as {
        endpointName?: string;
        jobId?: string;
        status?: string;
      };

      setAlertModal({
        message:
          buildWorkerNodeResponseMessage(result) ||
          "Article content scraper job was queued successfully.",
        show: true,
        title: "Article Content Scraper Job Queued",
        variant: "success",
      });
      setRefreshSignal((current) => current + 1);
    } catch (error) {
      setAlertModal({
        message:
          error instanceof Error ? error.message : "Unknown error starting job.",
        show: true,
        title: "Article Content Scraper Request Failed",
        variant: "error",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <CollapsibleAutomationSection
        title="Scrape Article Content"
        defaultOpen={false}
      >
        <div className="space-y-6">
          <button
            type="button"
            onClick={() => void handleStartScraper()}
            disabled={isSubmitting}
            className="rounded-lg bg-brand-500 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-brand-600 dark:hover:bg-brand-700"
          >
            {isSubmitting
              ? "Starting Article Content Scraper..."
              : "Start Article Content Scraper"}
          </button>

          <WorkerNodeJobStatusPanel
            endpointName={ARTICLE_CONTENT_SCRAPER_ENDPOINT_NAME}
            refreshSignal={refreshSignal}
            title="Last Article Content Scraper Job"
          />

          <ArticleTargetingFields
            thresholdDaysId="articleContentScraperThresholdDays"
            reviewCountId="articleContentScraperReviewCount"
            thresholdDaysValue={targetArticleThresholdDaysOld}
            reviewCountValue={targetArticleStateReviewCount}
            onThresholdDaysChange={setTargetArticleThresholdDaysOld}
            onReviewCountChange={setTargetArticleStateReviewCount}
          />

          <div className="flex items-start gap-3 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
            <input
              id="includeArticlesThatMightHaveBeenStateAssigned"
              type="checkbox"
              checked={includeArticlesThatMightHaveBeenStateAssigned}
              onChange={(e) =>
                setIncludeArticlesThatMightHaveBeenStateAssigned(e.target.checked)
              }
              className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 dark:border-gray-700 dark:bg-gray-800"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <label
                  htmlFor="includeArticlesThatMightHaveBeenStateAssigned"
                  className="text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  Include articles that might have been state assigned
                </label>
                <div className="group relative inline-flex overflow-visible">
                  <span className="inline-flex h-6 w-6 items-center justify-center overflow-visible rounded-full text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300">
                    <InfoIcon className="h-5 w-5 overflow-visible" />
                  </span>
                  <span className="pointer-events-none invisible absolute left-1/2 top-full z-10 mt-2 w-72 -translate-x-1/2 rounded-lg bg-gray-900 px-3 py-2 text-xs font-normal text-white opacity-0 shadow-lg transition-all group-hover:visible group-hover:opacity-100 dark:bg-gray-700">
                    When checked, this scraper includes articles that may already
                    have AI state assignments, but still excludes articles that
                    have any ArticleApproveds row and articles with
                    ArticleIsRelevants.isRelevant = false.
                  </span>
                </div>
              </div>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Leave unchecked for the default scraper targeting that matches the
                normal state assigner selection.
              </p>
            </div>
          </div>
        </div>
      </CollapsibleAutomationSection>

      <Modal
        isOpen={alertModal.show}
        onClose={() => setAlertModal(DEFAULT_ALERT_MODAL_STATE)}
      >
        <ModalInformationOk
          title={alertModal.title}
          message={alertModal.message}
          variant={alertModal.variant}
          onClose={() => setAlertModal(DEFAULT_ALERT_MODAL_STATE)}
        />
      </Modal>
    </>
  );
}
