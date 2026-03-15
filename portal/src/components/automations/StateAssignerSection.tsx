"use client";

import React, { useState } from "react";
import { useAppSelector } from "@/store/hooks";
import { CollapsibleAutomationSection } from "@/components/automations/CollapsibleAutomationSection";
import { WorkerNodeJobStatusPanel } from "@/components/automations/WorkerNodeJobStatusPanel";
import { Modal } from "@/components/ui/modal";
import { ModalInformationOk } from "@/components/ui/modal/ModalInformationOk";
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

const STATE_ASSIGNER_ENDPOINT_NAME = "/state-assigner/start-job";

type InputLabelWithTooltipProps = {
  htmlFor: string;
  label: string;
  tooltip: string;
};

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

function InputLabelWithTooltip({
  htmlFor,
  label,
  tooltip,
}: InputLabelWithTooltipProps) {
  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor={htmlFor}
        className="text-sm font-medium text-gray-700 dark:text-gray-300"
      >
        {label}
      </label>
      <div className="group relative inline-flex overflow-visible">
        <span className="inline-flex h-6 w-6 items-center justify-center overflow-visible rounded-full text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300">
          <InfoIcon className="h-5 w-5 overflow-visible" />
        </span>
        <span className="pointer-events-none invisible absolute left-1/2 top-full z-10 mt-2 w-64 -translate-x-1/2 rounded-lg bg-gray-900 px-3 py-2 text-xs font-normal text-white opacity-0 shadow-lg transition-all group-hover:visible group-hover:opacity-100 dark:bg-gray-700">
          {tooltip}
        </span>
      </div>
    </div>
  );
}

export function StateAssignerSection() {
  const { token } = useAppSelector((state) => state.user);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [targetArticleThresholdDaysOld, setTargetArticleThresholdDaysOld] =
    useState("180");
  const [targetArticleStateReviewCount, setTargetArticleStateReviewCount] =
    useState("100");
  const [alertModal, setAlertModal] = useState<AlertModalState>(
    DEFAULT_ALERT_MODAL_STATE,
  );

  const handleStartStateAssigner = async () => {
    setIsSubmitting(true);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/automations/state-assigner/start-job`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          method: "POST",
          body: JSON.stringify({
            targetArticleThresholdDaysOld: Number(targetArticleThresholdDaysOld),
            targetArticleStateReviewCount: Number(targetArticleStateReviewCount),
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
          "State assigner job was queued successfully.",
        show: true,
        title: "AI State Assigner Job Queued",
        variant: "success",
      });
      setRefreshSignal((current) => current + 1);
    } catch (error) {
      setAlertModal({
        message:
          error instanceof Error ? error.message : "Unknown error starting job.",
        show: true,
        title: "AI State Assigner Request Failed",
        variant: "error",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <CollapsibleAutomationSection title="State Assigner" defaultOpen={false}>
        <div className="space-y-6">
          <button
            type="button"
            onClick={() => void handleStartStateAssigner()}
            disabled={isSubmitting}
            className="rounded-lg bg-brand-500 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-brand-600 dark:hover:bg-brand-700"
          >
            {isSubmitting ? "Starting AI State Assigner..." : "Start AI State Assigner"}
          </button>

          <WorkerNodeJobStatusPanel
            endpointName={STATE_ASSIGNER_ENDPOINT_NAME}
            refreshSignal={refreshSignal}
            title="Last AI State Assigner Job"
          />

          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <InputLabelWithTooltip
                htmlFor="stateAssignerThresholdDays"
                label="Article Threshold Days Old"
                tooltip="This value directs analysis of articles only this many days old."
              />
              <input
                id="stateAssignerThresholdDays"
                type="number"
                min="1"
                step="1"
                value={targetArticleThresholdDaysOld}
                onChange={(e) => setTargetArticleThresholdDaysOld(e.target.value)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              />
            </div>

            <div className="flex flex-col gap-2">
              <InputLabelWithTooltip
                htmlFor="stateAssignerReviewCount"
                label="Article State Review Count"
                tooltip="This value directs the number of articles to analyze."
              />
              <input
                id="stateAssignerReviewCount"
                type="number"
                min="1"
                step="1"
                value={targetArticleStateReviewCount}
                onChange={(e) => setTargetArticleStateReviewCount(e.target.value)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              />
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
