"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import MultiSelect from "@/components/form/MultiSelect";
import { CollapsibleAutomationSection } from "@/components/automations/CollapsibleAutomationSection";
import { WorkerPythonJobStatusPanel } from "@/components/automations/WorkerPythonJobStatusPanel";
import { Modal } from "@/components/ui/modal";
import { ModalInformationOk } from "@/components/ui/modal/ModalInformationOk";
import { useAppSelector } from "@/store/hooks";

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

const AI_APPROVER_ENDPOINT_NAME = "/ai-approver/start-job";

function buildWorkerPythonResponseMessage(result: {
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

export function AiApproverSection() {
  const { token, stateArray = [] } = useAppSelector((state) => state.user);
  const [articleCount, setArticleCount] = useState("25");
  const [requireStateAssignment, setRequireStateAssignment] = useState(true);
  const [selectedStateValues, setSelectedStateValues] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [alertModal, setAlertModal] = useState<AlertModalState>(
    DEFAULT_ALERT_MODAL_STATE,
  );

  const stateOptions = useMemo(
    () =>
      stateArray.map((state) => ({
        value: state.id.toString(),
        text: state.name,
        selected: selectedStateValues.includes(state.id.toString()),
      })),
    [selectedStateValues, stateArray],
  );

  const handleStartAiApprover = async () => {
    setIsSubmitting(true);

    try {
      const body: {
        limit: number;
        requireStateAssignment: boolean;
        stateIds?: number[];
      } = {
        limit: Number(articleCount),
        requireStateAssignment,
      };

      if (selectedStateValues.length > 0) {
        body.stateIds = selectedStateValues.map((value) => Number(value));
      }

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/automations/ai-approver/start-job`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
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
          buildWorkerPythonResponseMessage(result) ||
          "AI approver job was queued successfully.",
        show: true,
        title: "AI Approver Job Queued",
        variant: "success",
      });
      setRefreshSignal((current) => current + 1);
    } catch (error) {
      setAlertModal({
        message:
          error instanceof Error ? error.message : "Unknown error starting job.",
        show: true,
        title: "AI Approver Request Failed",
        variant: "error",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <CollapsibleAutomationSection title="AI Approver" defaultOpen={false}>
        <div className="space-y-6">
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Queue the worker-python AI approver workflow, optionally require
              AI-assigned states, and filter to specific states for the run.
            </p>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="aiApproverArticleCount"
                  className="text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  Article Count
                </label>
                <input
                  id="aiApproverArticleCount"
                  type="number"
                  min="1"
                  step="1"
                  value={articleCount}
                  onChange={(event) => setArticleCount(event.target.value)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
              </div>

              <div className="flex items-end">
                <label className="flex items-center gap-3 rounded-lg border border-gray-200 px-4 py-3 text-sm text-gray-700 dark:border-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={requireStateAssignment}
                    onChange={(event) =>
                      setRequireStateAssignment(event.target.checked)
                    }
                    className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                  />
                  Filter only articles with AI-assigned states
                </label>
              </div>
            </div>

            <MultiSelect
              label="States (Optional)"
              options={stateOptions}
              defaultSelected={selectedStateValues}
              onChange={setSelectedStateValues}
              disabled={!requireStateAssignment}
            />

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void handleStartAiApprover()}
                disabled={isSubmitting}
                className="rounded-lg bg-brand-500 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-brand-600 dark:hover:bg-brand-700"
              >
                {isSubmitting ? "Starting AI Approver..." : "Start AI Approver"}
              </button>

              <Link
                href="/analysis/ai-approver-prompts"
                className="rounded-lg border border-gray-300 px-6 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Manage Agent Prompts
              </Link>
            </div>
          </div>

          <WorkerPythonJobStatusPanel
            endpointName={AI_APPROVER_ENDPOINT_NAME}
            refreshSignal={refreshSignal}
            title="Last AI Approver Job"
          />
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
