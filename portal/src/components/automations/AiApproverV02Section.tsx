"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { CollapsibleAutomationSection } from "@/components/automations/CollapsibleAutomationSection";
import { WorkerPythonJobStatusPanel } from "@/components/automations/WorkerPythonJobStatusPanel";
import { Modal } from "@/components/ui/modal";
import { InfoIcon } from "@/icons";
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

type InfoTooltipProps = {
  children: React.ReactNode;
  label: string;
};

function InfoTooltip({ children, label }: InfoTooltipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const tooltipId = useId();

  return (
    <span className="relative inline-flex overflow-visible">
      <button
        type="button"
        aria-describedby={isOpen ? tooltipId : undefined}
        aria-expanded={isOpen}
        aria-label={label}
        onBlur={() => setIsOpen(false)}
        onClick={() => setIsOpen((current) => !current)}
        className="inline-flex h-6 w-6 items-center justify-center overflow-visible rounded-full text-gray-400 transition-colors hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:text-gray-500 dark:hover:text-gray-300"
      >
        <InfoIcon className="h-5 w-5 overflow-visible" />
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        className={`absolute left-1/2 top-full z-20 mt-2 w-72 max-w-[calc(100vw-3rem)] -translate-x-1/2 rounded-lg bg-gray-900 px-3 py-2 text-xs font-normal leading-5 text-white shadow-lg transition-all dark:bg-gray-700 ${
          isOpen ? "visible opacity-100" : "pointer-events-none invisible opacity-0"
        }`}
      >
        {children}
      </span>
    </span>
  );
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
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Preview a frozen article selection, then queue advisory binary
            predictions. V02 never approves or rejects articles automatically.
          </p>
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-white/[0.02]">
            <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
              Active prompt:{" "}
              {activePrompts.length === 1
                ? displayPrompt(activePrompts[0])
                : activePrompts.length === 0
                  ? "None"
                  : "Configuration error: multiple active prompts"}
            </p>
            {loadError ? (
              <p className="mt-2 text-sm text-error-600 dark:text-error-400">
                {loadError}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={startDisabled}
              onClick={() => setIsModalOpen(true)}
              className="rounded-lg bg-brand-500 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-brand-600 dark:hover:bg-brand-700"
            >
              Configure and preview run
            </button>
            <Link
              href="/articles/automations/ai-approver-v02-prompts"
              className="inline-flex items-center rounded-lg border border-gray-200 px-5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Manage V02 prompts
            </Link>
            <button
              type="button"
              onClick={() => {
                setJobRefreshSignal((current) => current + 1);
                void fetchState();
              }}
              className="rounded-lg border border-gray-200 px-5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Refresh status
            </button>
            {activeRun ? (
              <button
                type="button"
                disabled={isCanceling}
                onClick={() => void cancelRun()}
                className="rounded-lg border border-error-300 px-5 py-2 text-sm font-medium text-error-600 transition-colors hover:bg-error-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-error-700 dark:text-error-400 dark:hover:bg-error-900/20"
              >
                {isCanceling ? "Canceling..." : "Cancel run"}
              </button>
            ) : null}
          </div>

          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-white/[0.02]">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-white/90">
              Latest accepted V02 run
            </h3>
            {latestRun ? (
              <div className="mt-3 grid gap-2 text-sm text-gray-600 dark:text-gray-400 md:grid-cols-3">
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
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                No accepted run yet.
              </p>
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
        <div className="w-full max-w-2xl rounded-2xl bg-white p-6 text-gray-700 dark:bg-gray-900 dark:text-gray-300">
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">
            Configure AI Approver V02
          </h2>
          <div className="mt-5 space-y-4">
            <div className="flex flex-wrap gap-4 text-sm">
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 font-medium text-gray-700 dark:text-gray-300">
                  <input
                    type="radio"
                    checked={mode === "article_position_count"}
                    onChange={() => {
                      invalidatePreview();
                      setMode("article_position_count");
                    }}
                    className="h-4 w-4 border-gray-300 text-brand-500 focus:ring-brand-500 dark:border-gray-700 dark:bg-gray-800"
                  />
                  Mode A: article positions
                </label>
                <InfoTooltip label="About Mode A">
                  Choose how many article records to scan, starting with the
                  newest article ID and moving backward. Ineligible articles are
                  skipped, so the number of predictions may be lower than the
                  requested position count.
                </InfoTooltip>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 font-medium text-gray-700 dark:text-gray-300">
                  <input
                    type="radio"
                    checked={mode === "until_last_approved"}
                    disabled={boundaryUnavailable}
                    onChange={() => {
                      invalidatePreview();
                      setMode("until_last_approved");
                    }}
                    className="h-4 w-4 border-gray-300 text-brand-500 focus:ring-brand-500 dark:border-gray-700 dark:bg-gray-800"
                  />
                  Mode B: until last approved
                </label>
                <InfoTooltip label="About Mode B">
                  Start with the newest article ID and scan backward until just
                  before the latest approved article ID. This mode is unavailable
                  when no approved article exists.
                </InfoTooltip>
              </div>
            </div>
            {boundaryUnavailable ? (
              <p className="text-sm text-warning-600 dark:text-warning-400">
                Mode B is unavailable because no approved boundary exists.
              </p>
            ) : null}
            {mode === "article_position_count" ? (
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
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
                  className="mt-2 block w-full rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
              </label>
            ) : null}
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={allowPastBoundary}
                  disabled={mode !== "article_position_count"}
                  onChange={(event) => {
                    invalidatePreview();
                    setAllowPastBoundary(event.target.checked);
                  }}
                  className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500 dark:border-gray-700 dark:bg-gray-800"
                />
                Allow Mode A to cross the approved boundary
              </label>
              <InfoTooltip label="About crossing the approved boundary">
                By default, Mode A stops before the latest approved article ID.
                Turn this on to let AI Approver V02 analyze and predict eligible
                articles with lower article IDs. Articles already approved are
                still skipped.
              </InfoTooltip>
            </div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={allowDescription}
                onChange={(event) => {
                  invalidatePreview();
                  setAllowDescription(event.target.checked);
                }}
                className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500 dark:border-gray-700 dark:bg-gray-800"
              />
              Allow description when scraped content is unavailable
            </label>
            {modalError ? (
              <p className="text-sm text-error-600 dark:text-error-400">
                {modalError}
              </p>
            ) : null}
            {preview ? (
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600 dark:border-gray-800 dark:bg-white/[0.02] dark:text-gray-400">
                <p>Highest article ID: {preview.highestArticleIdAtStart}</p>
                <p>Approved boundary: {preview.approvedBoundaryArticleId ?? "None"}</p>
                <p>Planned eligible model calls: {preview.plannedEligibleCount}</p>
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  Final attempts may be lower because of cancellation, runtime
                  changes, or circuit breakers.
                </p>
              </div>
            ) : null}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Close
              </button>
              <button
                type="button"
                disabled={isPreviewing}
                onClick={() => void requestPreview()}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
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
                className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-brand-600 dark:hover:bg-brand-700"
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
