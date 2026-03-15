"use client";

import React, { useState } from "react";
import { useAppSelector } from "@/store/hooks";
import { CollapsibleAutomationSection } from "@/components/automations/CollapsibleAutomationSection";
import { FixedAutomationSpreadsheetControls } from "@/components/automations/FixedAutomationSpreadsheetControls";
import { WorkerNodeJobStatusPanel } from "@/components/automations/WorkerNodeJobStatusPanel";
import { Modal } from "@/components/ui/modal";
import { ModalInformationOk } from "@/components/ui/modal/ModalInformationOk";

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

const GOOGLE_RSS_FILE_NAME = "AutomatedRequestsGoogleNewsRss04.xlsx";
const GOOGLE_RSS_ENDPOINT_NAME = "/request-google-rss/start-job";

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
    };

    if (parsed.error?.details && parsed.error.details.length > 0) {
      return parsed.error.details
        .map((detail) => `${detail.field}: ${detail.message}`)
        .join("\n");
    }

    if (parsed.error?.message) {
      return parsed.error.message;
    }
  } catch (_error) {
    return errorBody;
  }

  return errorBody;
}

export function GoogleRssSection() {
  const { token } = useAppSelector((state) => state.user);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [alertModal, setAlertModal] = useState<AlertModalState>(
    DEFAULT_ALERT_MODAL_STATE,
  );

  const handleStartGoogleRss = async () => {
    setIsSubmitting(true);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/automations/request-google-rss/start-job`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          method: "POST",
          body: JSON.stringify({}),
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
          "Google RSS job was queued successfully.",
        show: true,
        title: "Google RSS Job Queued",
        variant: "success",
      });
      setRefreshSignal((current) => current + 1);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error starting job.";

      setAlertModal({
        message,
        show: true,
        title: "Google RSS Request Failed",
        variant: "error",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <CollapsibleAutomationSection title="Google RSS" defaultOpen={false}>
        <div className="space-y-6">
          <button
            type="button"
            onClick={() => void handleStartGoogleRss()}
            disabled={isSubmitting}
            className="rounded-lg bg-brand-500 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-brand-600 dark:hover:bg-brand-700"
          >
            {isSubmitting
              ? "Starting Google RSS Job..."
              : "Start Requesting Google RSS Queries"}
          </button>

          <WorkerNodeJobStatusPanel
            endpointName={GOOGLE_RSS_ENDPOINT_NAME}
            refreshSignal={refreshSignal}
            title="Last Google RSS Job"
          />

          <FixedAutomationSpreadsheetControls fileName={GOOGLE_RSS_FILE_NAME} />
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
