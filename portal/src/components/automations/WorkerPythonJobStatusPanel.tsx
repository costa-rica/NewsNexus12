"use client";

import React, { useEffect, useState } from "react";
import { useAppSelector } from "@/store/hooks";
import { Modal } from "@/components/ui/modal";
import { ModalInformationOk } from "@/components/ui/modal/ModalInformationOk";
import { TrashBinIcon } from "@/icons";

type AlertModalState = {
  message: string;
  show: boolean;
  title: string;
  variant: "error" | "info" | "success" | "warning";
};

type WorkerPythonJobRecord = {
  createdAt: string;
  endedAt?: string;
  endpointName: string;
  failureReason?: string;
  jobId: string;
  result?: {
    completedStepCount?: number;
    currentStep?: string;
    currentStepProcessed?: number;
    currentStepStatus?: string;
    statusText?: string;
    summaryStatus?: string;
  };
  startedAt?: string;
  status: "canceled" | "completed" | "failed" | "queued" | "running";
};

type WorkerPythonJobStatusPanelProps = {
  endpointName: string;
  refreshSignal?: number;
  title: string;
};

const DEFAULT_ALERT_MODAL_STATE: AlertModalState = {
  message: "",
  show: false,
  title: "",
  variant: "info",
};

const REFRESH_ICON_PATH =
  "M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.96-.69 2.8l1.46 1.46A7.95 7.95 0 0020 12c0-4.42-3.58-8-8-8Zm-6.31.2L4.23 5.66A7.95 7.95 0 004 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3c-3.31 0-6-2.69-6-6 0-1.01.25-1.96.69-2.8Z";

function formatDate(dateValue?: string): string {
  if (!dateValue) {
    return "Not available";
  }

  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) {
    return dateValue;
  }

  return parsed.toLocaleString();
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

function getStatusClasses(status: WorkerPythonJobRecord["status"]): string {
  switch (status) {
    case "completed":
      return "bg-success-50 text-success-700 dark:bg-success-900/20 dark:text-success-400";
    case "failed":
      return "bg-error-50 text-error-700 dark:bg-error-900/20 dark:text-error-400";
    case "canceled":
      return "bg-warning-50 text-warning-700 dark:bg-warning-900/20 dark:text-warning-400";
    case "running":
      return "bg-blue-light-50 text-blue-light-700 dark:bg-blue-light-900/20 dark:text-blue-light-400";
    case "queued":
    default:
      return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  }
}

export function WorkerPythonJobStatusPanel({
  endpointName,
  refreshSignal = 0,
  title,
}: WorkerPythonJobStatusPanelProps) {
  const { token } = useAppSelector((state) => state.user);
  const [job, setJob] = useState<WorkerPythonJobRecord | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);
  const [alertModal, setAlertModal] = useState<AlertModalState>(
    DEFAULT_ALERT_MODAL_STATE,
  );

  const fetchLatestJob = async (showErrorModal = true) => {
    setIsRefreshing(true);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/automations/worker-python/latest-job?endpointName=${encodeURIComponent(endpointName)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(getErrorMessage(errorText));
      }

      const result = (await response.json()) as { job: WorkerPythonJobRecord | null };
      setJob(result.job);
    } catch (error) {
      if (showErrorModal) {
        setAlertModal({
          message:
            error instanceof Error
              ? error.message
              : "Unable to refresh job status.",
          show: true,
          title: "Refresh Failed",
          variant: "error",
        });
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void fetchLatestJob(false);
  }, [endpointName, refreshSignal, token]);

  const handleCancelJob = async () => {
    if (!job) {
      return;
    }

    setIsCanceling(true);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/automations/worker-python/cancel-job/${encodeURIComponent(job.jobId)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          method: "POST",
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(getErrorMessage(errorText));
      }

      const result = (await response.json()) as {
        jobId: string;
        outcome: "canceled" | "cancel_requested";
      };

      setAlertModal({
        message: `Job ID: ${result.jobId}\nOutcome: ${result.outcome}`,
        show: true,
        title: "Cancel Requested",
        variant: "success",
      });
      await fetchLatestJob(false);
    } catch (error) {
      setAlertModal({
        message: error instanceof Error ? error.message : "Unable to cancel job.",
        show: true,
        title: "Cancel Failed",
        variant: "error",
      });
    } finally {
      setIsCanceling(false);
    }
  };

  const canCancel = job?.status === "queued" || job?.status === "running";

  return (
    <>
      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-white/[0.02]">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-800 dark:text-white/90">
              {title}
            </h3>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Latest worker-python job for this workflow.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void fetchLatestJob(true)}
              disabled={isRefreshing}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              aria-label="Refresh job status"
            >
              <svg
                viewBox="0 0 24 24"
                className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
                fill="currentColor"
                aria-hidden="true"
              >
                <path d={REFRESH_ICON_PATH} />
              </svg>
            </button>

            <button
              type="button"
              onClick={() => void handleCancelJob()}
              disabled={!canCancel || isCanceling}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <TrashBinIcon className="h-4 w-4" />
              Cancel
            </button>
          </div>
        </div>

        {job ? (
          <div className="space-y-3 text-sm text-gray-600 dark:text-gray-400">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${getStatusClasses(job.status)}`}
              >
                {job.status}
              </span>
              <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
                {job.jobId}
              </span>
            </div>
            <div>Created: {formatDate(job.createdAt)}</div>
            <div>Started: {formatDate(job.startedAt)}</div>
            <div>Ended: {formatDate(job.endedAt)}</div>
            {job.result?.statusText ? (
              <div>Status Detail: {job.result.statusText}</div>
            ) : null}
            {job.result?.summaryStatus ? (
              <div>Workflow Status: {job.result.summaryStatus}</div>
            ) : null}
            {job.result?.currentStep ? (
              <div>
                Current Step: {job.result.currentStep}
                {job.result.currentStepStatus
                  ? ` (${job.result.currentStepStatus})`
                  : ""}
              </div>
            ) : null}
            {typeof job.result?.currentStepProcessed === "number" ? (
              <div>Current Step Processed: {job.result.currentStepProcessed}</div>
            ) : null}
            {typeof job.result?.completedStepCount === "number" ? (
              <div>Completed Steps: {job.result.completedStepCount}</div>
            ) : null}
            {job.failureReason ? <div>Reason: {job.failureReason}</div> : null}
          </div>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No job has been queued for this workflow yet.
          </p>
        )}
      </div>

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
