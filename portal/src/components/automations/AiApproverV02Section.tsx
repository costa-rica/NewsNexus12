"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CollapsibleAutomationSection } from "@/components/automations/CollapsibleAutomationSection";
import { WorkerPythonJobStatusPanel } from "@/components/automations/WorkerPythonJobStatusPanel";
import { Modal } from "@/components/ui/modal";
import { useAppSelector } from "@/store/hooks";
import type { AiApproverPromptVersionV02 } from "@/types/article";

type SelectionMode = "article_position_count" | "until_last_approved";

type RunSummary = {
  id: number;
  jobId: string | null;
  selectionMode: SelectionMode;
  plannedEligibleCount: number;
  attemptedCount: number;
  completedCount: number;
  failedCount: number;
  invalidResponseCount: number;
  skippedCount: number;
  status: string;
  endingReason: string | null;
  approvedBoundaryArticleId: number | null;
  highestArticleIdAtStart: number;
  startedAt: string | null;
  endedAt: string | null;
};

type Preview = RunSummary & {
  previewToken: string;
};

type QueueStatus = {
  jobId: string;
  status: string;
  failureReason?: string | null;
};

const AI_APPROVER_V02_ENDPOINT_NAME = "/ai-approver-v02/start";

function messageFromBody(body: unknown): string {
  if (body && typeof body === "object" && "message" in body) {
    return String(body.message);
  }
  return "The request could not be completed.";
}

function displayPrompt(prompt: AiApproverPromptVersionV02): string {
  return prompt.title?.trim() || `Prompt_id_${prompt.id}`;
}

export function AiApproverV02Section() {
  const { token } = useAppSelector((state) => state.user);
  const [prompts, setPrompts] = useState<AiApproverPromptVersionV02[]>([]);
  const [latestRun, setLatestRun] = useState<RunSummary | null>(null);
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [mode, setMode] = useState<SelectionMode>("article_position_count");
  const [count, setCount] = useState("25");
  const [allowPastBoundary, setAllowPastBoundary] = useState(false);
  const [allowDescription, setAllowDescription] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [boundaryUnavailable, setBoundaryUnavailable] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);
  const [jobRefreshSignal, setJobRefreshSignal] = useState(0);
  const activePrompts = useMemo(
    () => prompts.filter((prompt) => prompt.isActive),
    [prompts],
  );
  const activeRun =
    latestRun?.status === "queued" || latestRun?.status === "running";

  const fetchState = useCallback(async () => {
    setIsLoading(true);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [promptResponse, runResponse] = await Promise.all([
        fetch(
          `${process.env.NEXT_PUBLIC_API_BASE_URL}/analysis/ai-approver-v02/prompts`,
          { headers },
        ),
        fetch(
          `${process.env.NEXT_PUBLIC_API_BASE_URL}/automations/ai-approver-v02/runs/latest`,
          { headers },
        ),
      ]);
      if (!promptResponse.ok || !runResponse.ok) {
        throw new Error("Unable to load AI Approver V02 configuration.");
      }
      const promptBody = (await promptResponse.json()) as {
        prompts: AiApproverPromptVersionV02[];
      };
      const run = (await runResponse.json()) as RunSummary | null;
      setPrompts(promptBody.prompts);
      setLatestRun(run);
      if (run) {
        const detailResponse = await fetch(
          `${process.env.NEXT_PUBLIC_API_BASE_URL}/automations/ai-approver-v02/runs/${run.id}`,
          { headers },
        );
        if (!detailResponse.ok) {
          throw new Error("Unable to load the V02 queue status.");
        }
        const detail = (await detailResponse.json()) as {
          queueStatus: QueueStatus | null;
        };
        setQueueStatus(detail.queueStatus);
      } else {
        setQueueStatus(null);
      }
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Load failed.");
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial authenticated API load
    void fetchState();
  }, [fetchState]);

  const invalidatePreview = () => {
    setPreview(null);
    setModalError(null);
  };

  const requestPreview = async () => {
    if (
      mode === "article_position_count" &&
      (!/^\d+$/.test(count) || Number(count) <= 0)
    ) {
      setModalError("Article position count must be a positive integer.");
      return;
    }
    setIsPreviewing(true);
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/automations/ai-approver-v02/preview`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            selectionMode: mode,
            requestedArticleCount:
              mode === "article_position_count" ? Number(count) : null,
            allowPastApprovedBoundary:
              mode === "article_position_count" && allowPastBoundary,
            allowDescriptionFallback: allowDescription,
          }),
        },
      );
      const body = (await response.json()) as Preview & {
        error?: string;
        message?: string;
      };
      if (!response.ok) {
        if (body.error === "approved_boundary_unavailable") {
          setBoundaryUnavailable(true);
        }
        throw new Error(messageFromBody(body));
      }
      setPreview(body);
      setBoundaryUnavailable(body.approvedBoundaryArticleId === null);
      setModalError(null);
    } catch (error) {
      setPreview(null);
      setModalError(error instanceof Error ? error.message : "Preview failed.");
    } finally {
      setIsPreviewing(false);
    }
  };

  const startPreview = async () => {
    if (!preview || isStarting) return;
    setIsStarting(true);
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/automations/ai-approver-v02/start`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            runId: preview.id,
            previewToken: preview.previewToken,
          }),
        },
      );
      const body = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(messageFromBody(body));
      }
      setIsModalOpen(false);
      setPreview(null);
      await fetchState();
      setJobRefreshSignal((current) => current + 1);
    } catch (error) {
      setPreview(null);
      setModalError(
        error instanceof Error
          ? `${error.message} Refresh the preview before trying again.`
          : "Start failed.",
      );
    } finally {
      setIsStarting(false);
    }
  };

  const cancelRun = async () => {
    if (!latestRun || !activeRun) return;
    setIsCanceling(true);
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/automations/ai-approver-v02/runs/${latestRun.id}/cancel`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!response.ok) {
        throw new Error(messageFromBody(await response.json()));
      }
      await fetchState();
      setJobRefreshSignal((current) => current + 1);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Cancel failed.");
    } finally {
      setIsCanceling(false);
    }
  };

  const startDisabled =
    isLoading ||
    Boolean(loadError) ||
    activeRun ||
    activePrompts.length !== 1;

  return (
    <>
      <CollapsibleAutomationSection title="AI Approver V02" defaultOpen>
        <div className="space-y-5">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Preview a frozen article selection, then queue advisory binary
            predictions. V02 never approves or rejects articles automatically.
          </p>
          <div className="rounded-lg bg-gray-50 p-4 text-sm dark:bg-gray-800/60">
            <p>
              Active prompt:{" "}
              {activePrompts.length === 1
                ? displayPrompt(activePrompts[0])
                : activePrompts.length === 0
                  ? "None"
                  : "Configuration error: multiple active prompts"}
            </p>
            {loadError ? <p className="mt-2 text-error-600">{loadError}</p> : null}
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={startDisabled}
              onClick={() => setIsModalOpen(true)}
              className="rounded-lg bg-brand-500 px-5 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Configure and preview run
            </button>
            <Link
              href="/articles/automations/ai-approver-v02-prompts"
              className="rounded-lg border border-gray-300 px-5 py-2 text-sm dark:border-gray-700"
            >
              Manage V02 prompts
            </Link>
            <button
              type="button"
              onClick={() => {
                setJobRefreshSignal((current) => current + 1);
                void fetchState();
              }}
              className="rounded-lg border border-gray-300 px-5 py-2 text-sm dark:border-gray-700"
            >
              Refresh status
            </button>
            {activeRun ? (
              <button
                type="button"
                disabled={isCanceling}
                onClick={() => void cancelRun()}
                className="rounded-lg border border-error-300 px-5 py-2 text-sm text-error-600 disabled:opacity-50"
              >
                {isCanceling ? "Canceling..." : "Cancel run"}
              </button>
            ) : null}
          </div>

          <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
            <h3 className="font-medium">Latest accepted V02 run</h3>
            {latestRun ? (
              <div className="mt-3 grid gap-2 text-sm md:grid-cols-3">
                <span>Run: {latestRun.id}</span>
                <span>Queue job: {latestRun.jobId || "Pending"}</span>
                <span>Status: {latestRun.status}</span>
                <span>Worker queue: {queueStatus?.status || "Not available"}</span>
                <span>Mode: {latestRun.selectionMode}</span>
                <span>Planned: {latestRun.plannedEligibleCount}</span>
                <span>Attempted: {latestRun.attemptedCount}</span>
                <span>Completed: {latestRun.completedCount}</span>
                <span>Failed: {latestRun.failedCount}</span>
                <span>Invalid: {latestRun.invalidResponseCount}</span>
                <span>Skipped: {latestRun.skippedCount}</span>
                <span>Started: {latestRun.startedAt ? new Date(latestRun.startedAt).toLocaleString() : "N/A"}</span>
                <span>Ended: {latestRun.endedAt ? new Date(latestRun.endedAt).toLocaleString() : "N/A"}</span>
                {latestRun.endingReason ? (
                  <span className="md:col-span-3">
                    Ending reason: {latestRun.endingReason}
                  </span>
                ) : null}
                {queueStatus?.failureReason ? (
                  <span className="md:col-span-3">
                    Queue failure: {queueStatus.failureReason}
                  </span>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-sm text-gray-500">No accepted run yet.</p>
            )}
          </div>

          <WorkerPythonJobStatusPanel
            allowCancel={false}
            endpointName={AI_APPROVER_V02_ENDPOINT_NAME}
            refreshSignal={jobRefreshSignal}
            title="Latest AI Approver V02 Queue Job"
          />
        </div>
      </CollapsibleAutomationSection>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <div className="w-full max-w-2xl rounded-2xl bg-white p-6 dark:bg-gray-900">
          <h2 className="text-xl font-semibold">Configure AI Approver V02</h2>
          <div className="mt-5 space-y-4">
            <div className="flex flex-wrap gap-4 text-sm">
              <label>
                <input
                  type="radio"
                  checked={mode === "article_position_count"}
                  onChange={() => {
                    invalidatePreview();
                    setMode("article_position_count");
                  }}
                />{" "}
                Mode A: article positions
              </label>
              <label>
                <input
                  type="radio"
                  checked={mode === "until_last_approved"}
                  disabled={boundaryUnavailable}
                  onChange={() => {
                    invalidatePreview();
                    setMode("until_last_approved");
                  }}
                />{" "}
                Mode B: until last approved
              </label>
            </div>
            {boundaryUnavailable ? (
              <p className="text-sm text-warning-600">
                Mode B is unavailable because no approved boundary exists.
              </p>
            ) : null}
            {mode === "article_position_count" ? (
              <label className="block text-sm">
                Article position count
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={count}
                  onChange={(event) => {
                    invalidatePreview();
                    setCount(event.target.value);
                  }}
                  className="mt-1 block w-full rounded-lg border p-2 dark:bg-gray-800"
                />
              </label>
            ) : null}
            <label className="block text-sm">
              <input
                type="checkbox"
                checked={allowPastBoundary}
                disabled={mode !== "article_position_count"}
                onChange={(event) => {
                  invalidatePreview();
                  setAllowPastBoundary(event.target.checked);
                }}
              />{" "}
              Allow Mode A to cross the approved boundary
            </label>
            <label className="block text-sm">
              <input
                type="checkbox"
                checked={allowDescription}
                onChange={(event) => {
                  invalidatePreview();
                  setAllowDescription(event.target.checked);
                }}
              />{" "}
              Allow description when scraped content is unavailable
            </label>
            {modalError ? <p className="text-sm text-error-600">{modalError}</p> : null}
            {preview ? (
              <div className="rounded-lg bg-gray-50 p-4 text-sm dark:bg-gray-800">
                <p>Highest article ID: {preview.highestArticleIdAtStart}</p>
                <p>Approved boundary: {preview.approvedBoundaryArticleId ?? "None"}</p>
                <p>Planned eligible model calls: {preview.plannedEligibleCount}</p>
                <p className="mt-2 text-xs text-gray-500">
                  Final attempts may be lower because of cancellation, runtime
                  changes, or circuit breakers.
                </p>
              </div>
            ) : null}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="rounded-lg border px-4 py-2 text-sm"
              >
                Close
              </button>
              <button
                type="button"
                disabled={isPreviewing}
                onClick={() => void requestPreview()}
                className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50"
              >
                {isPreviewing ? "Previewing..." : "Refresh preview"}
              </button>
              <button
                type="button"
                disabled={
                  !preview ||
                  preview.plannedEligibleCount === 0 ||
                  isStarting
                }
                onClick={() => void startPreview()}
                className="rounded-lg bg-brand-500 px-4 py-2 text-sm text-white disabled:opacity-50"
              >
                {isStarting ? "Starting..." : "Confirm and start"}
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}
