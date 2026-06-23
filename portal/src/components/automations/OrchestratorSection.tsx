"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAppSelector } from "@/store/hooks";
import { CollapsibleAutomationSection } from "@/components/automations/CollapsibleAutomationSection";
import { Modal } from "@/components/ui/modal";
import { ModalInformationOk } from "@/components/ui/modal/ModalInformationOk";

// ─── Types ────────────────────────────────────────────────────────────────────

type OrchestratorRunStatus =
  | "running"
  | "completed"
  | "completed_no_new_articles"
  | "failed"
  | "canceled"
  | "timed_out";

type OrchestratorStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "timed_out"
  | "canceled"
  | "skipped";

type OrchestratorStepName =
  | "delete_articles"
  | "google_rss"
  | "state_assigner"
  | "ai_approver"
  | "semantic_scorer"
  | "report";

type OrchestratorStep = {
  id: number;
  stepName: OrchestratorStepName;
  stepOrder: number;
  enabled: boolean;
  status: OrchestratorStepStatus;
  childJobId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  endingMessage: string | null;
};

type OrchestratorRun = {
  id: number;
  runMode?: "standard" | "continuation";
  status: OrchestratorRunStatus;
  startedAt: string;
  endedAt: string | null;
  articleIdMinExclusive: number | null;
  articleIdMaxInclusive: number | null;
  reportFilePath: string | null;
  failureReason: string | null;
  aiApproverEnabled: boolean;
  semanticScorerEnabled: boolean;
  canRequestContinuationAssessment?: boolean;
  continuationSignalReasonCode?: ContinuationSignalReasonCode;
  continuationSignalWarnings?: string[];
};

type AlertModalState = {
  message: string;
  show: boolean;
  title: string;
  variant: "error" | "info" | "success" | "warning";
};

type ContinuationSignalReasonCode =
  | "assessment_available"
  | "active_orchestration_run"
  | "already_active_continuation"
  | "source_is_continuation"
  | "source_running"
  | "source_completed"
  | "completed_no_new_articles"
  | "pre_google_rss"
  | "unsupported_run_status"
  | string;

type ContinuationAssessmentReasonCode =
  | "eligible_google_rss_interrupted"
  | "eligible_downstream_interrupted"
  | "active_orchestration_run"
  | "already_active_continuation"
  | "source_is_continuation"
  | "source_running"
  | "source_completed"
  | "completed_no_new_articles"
  | "pre_google_rss"
  | "report_only_continuation_deferred"
  | "unrecognized_failure_shape"
  | string;

type ContinuationBlockingReason = string | { code?: string; message?: string };

type GoogleRssResumePlan = {
  status: "ready" | "phase_4_deferred" | "not_applicable" | "unavailable" | string;
  reason?: string;
  resumeAfter?: {
    requestId?: number | null;
    queryRowIndex?: number | null;
    queryRowId?: string | null;
    requestUrl?: string | null;
  } | null;
  startFrom?: {
    queryRowIndex?: number | null;
    queryRowId?: string | null;
  };
  rowsTotal?: number;
  expectedRequestCount?: number;
  matchedRequestCount?: number;
  replayAllowed?: boolean;
};

type ContinuationAssessmentStep = {
  stepName: OrchestratorStepName;
  stepOrder: number;
  sourceStepId: number | null;
  sourceStatus: string | null;
  sourceChildJobId: string | null;
  sourceEndingReason: string | null;
  sourceEndingMessage: string | null;
  sourceResult: Record<string, unknown> | null;
};

type ContinuationAssessment = {
  eligible: boolean;
  reasonCode: ContinuationAssessmentReasonCode;
  sourceRunId: number;
  sourceStatus: OrchestratorRunStatus;
  runMode: "standard" | "continuation" | string;
  articleIdMinExclusive: number | null;
  articleIdMaxInclusive: number | null;
  plannedArticleIdMaxInclusive: number | null;
  inheritedSteps: ContinuationAssessmentStep[];
  runnableSteps: ContinuationAssessmentStep[];
  googleRssResumePlan: GoogleRssResumePlan;
  warnings: string[];
  blockingReasons: ContinuationBlockingReason[];
};

type ContinuePostSuccess = {
  runId?: number;
  sourceRunId?: number;
  sourceOrchestratorRunId?: number;
  runMode?: "continuation" | string;
};

type ContinuationModalState = {
  run: OrchestratorRun | null;
  isOpen: boolean;
  isLoadingAssessment: boolean;
  isConfirming: boolean;
  assessment: ContinuationAssessment | null;
  errorMessage: string | null;
  successRunId: number | null;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const STEP_LABELS: Record<OrchestratorStepName, string> = {
  delete_articles: "1. Delete Old Articles",
  google_rss: "2. Google RSS Ingestion",
  state_assigner: "3. State Assigner",
  ai_approver: "4. AI Approver",
  semantic_scorer: "5. Semantic Scorer",
  report: "6. Generate Report",
};

const MANDATORY_STEPS: OrchestratorStepName[] = [
  "delete_articles",
  "google_rss",
  "state_assigner",
  "report",
];

const POLL_INTERVAL_MS = 5_000;

const DEFAULT_ALERT: AlertModalState = {
  message: "",
  show: false,
  title: "",
  variant: "info",
};

const DEFAULT_CONTINUATION_MODAL: ContinuationModalState = {
  run: null,
  isOpen: false,
  isLoadingAssessment: false,
  isConfirming: false,
  assessment: null,
  errorMessage: null,
  successRunId: null,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function formatDuration(start: string | null, end: string | null): string {
  if (!start || !end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const secs = s % 60;
  if (m < 60) return `${m}m ${secs}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function getRunStatusClasses(status: OrchestratorRunStatus): string {
  switch (status) {
    case "completed":
    case "completed_no_new_articles":
      return "bg-success-50 text-success-700 dark:bg-success-900/20 dark:text-success-400";
    case "failed":
    case "timed_out":
      return "bg-error-50 text-error-700 dark:bg-error-900/20 dark:text-error-400";
    case "canceled":
      return "bg-warning-50 text-warning-700 dark:bg-warning-900/20 dark:text-warning-400";
    case "running":
      return "bg-blue-light-50 text-blue-light-700 dark:bg-blue-light-900/20 dark:text-blue-light-400";
  }
}

function getStepStatusClasses(status: OrchestratorStepStatus): string {
  switch (status) {
    case "completed":
      return "text-success-600 dark:text-success-400";
    case "failed":
    case "timed_out":
      return "text-error-600 dark:text-error-400";
    case "running":
      return "text-blue-light-600 dark:text-blue-light-400";
    case "canceled":
      return "text-warning-600 dark:text-warning-400";
    case "skipped":
      return "text-gray-400 dark:text-gray-500";
    default:
      return "text-gray-500 dark:text-gray-400";
  }
}

function parseApiError(body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      orchestratorRunId?: number;
      activeRunId?: number;
      message?: string;
      error?: { message?: string };
      blockingReasons?: ContinuationBlockingReason[];
      assessment?: {
        blockingReasons?: ContinuationBlockingReason[];
      };
    };
    const message = parsed.message ?? parsed.error?.message;
    const blockingReasons = parsed.blockingReasons ?? parsed.assessment?.blockingReasons ?? [];
    const blockingReasonSummary = blockingReasons.map(blockingReasonText).join(" ");
    if (parsed.orchestratorRunId !== undefined && parsed.message) {
      return parsed.message;
    }
    if (parsed.activeRunId !== undefined && message) {
      return `${message} Active run id: ${parsed.activeRunId}.`;
    }
    if (message && blockingReasonSummary) {
      return `${message} ${blockingReasonSummary}`;
    }
    return message ?? (blockingReasonSummary || body);
  } catch {
    return body;
  }
}

function blockingReasonText(reason: ContinuationBlockingReason): string {
  if (typeof reason === "string") return reason;
  return reason.message ?? reason.code ?? "Continuation is blocked.";
}

function formatStepName(stepName: OrchestratorStepName): string {
  return STEP_LABELS[stepName] ?? stepName;
}

function formatArticleBound(value: number | null): string {
  return value === null ? "not set" : `#${value}`;
}

function formatPlannedUpperBound(value: number | null): string {
  return value === null ? "captured when downstream processing starts" : `#${value}`;
}

function formatGoogleRssResume(plan: GoogleRssResumePlan | null | undefined): string {
  if (!plan) return "not available";
  const reason = plan.reason ? ` ${plan.reason}` : "";
  if (plan.status === "not_applicable") return `not applicable.${reason}`;
  if (plan.status === "ready") {
    const requestId = plan.resumeAfter?.requestId;
    const rowId = plan.resumeAfter?.queryRowId;
    const rowIndex = plan.resumeAfter?.queryRowIndex;
    const marker =
      requestId !== undefined && requestId !== null
        ? ` after request #${requestId}`
        : rowId
          ? ` after query row ${rowId}`
          : rowIndex !== undefined && rowIndex !== null
            ? ` after query row index ${rowIndex}`
            : "";
    return `resume${marker}.${reason}`;
  }
  return `${plan.status}.${reason}`;
}

async function readResponseText(res: Response): Promise<string> {
  const body = await res.text();
  return body.trim();
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function OrchestratorSection() {
  const { token } = useAppSelector((state) => state.user);
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

  const [aiApproverEnabled, setAiApproverEnabled] = useState(true);
  const [semanticScorerEnabled, setSemanticScorerEnabled] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [isStartingTest, setIsStartingTest] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);
  const [alertModal, setAlertModal] = useState<AlertModalState>(DEFAULT_ALERT);

  const [activeRun, setActiveRun] = useState<(OrchestratorRun & { steps: OrchestratorStep[] }) | null>(null);
  const [pastRuns, setPastRuns] = useState<OrchestratorRun[]>([]);
  const [isLoadingRuns, setIsLoadingRuns] = useState(false);
  const [continuationModal, setContinuationModal] =
    useState<ContinuationModalState>(DEFAULT_CONTINUATION_MODAL);

  const authHeaders = useMemo(
    () => ({
      Authorization: `Bearer ${token ?? ""}`,
      "Content-Type": "application/json",
    }),
    [token],
  );
  // ── Fetch helpers ────────────────────────────────────────────────────────────

  const fetchActiveRun = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`${apiBase}/automations/orchestrator/active-run`, {
        headers: authHeaders,
      });
      if (!res.ok) return;
      const data = (await res.json()) as { runId: number | null };
      if (data.runId === null) {
        setActiveRun(null);
        return;
      }
      const runRes = await fetch(`${apiBase}/automations/orchestrator/runs/${data.runId}`, {
        headers: authHeaders,
      });
      if (!runRes.ok) return;
      const runData = (await runRes.json()) as { run: OrchestratorRun; steps: OrchestratorStep[] };
      setActiveRun({ ...runData.run, steps: runData.steps });
    } catch {
      // silent — polling is best-effort
    }
  }, [apiBase, authHeaders]);

  const fetchPastRuns = useCallback(async (): Promise<void> => {
    setIsLoadingRuns(true);
    try {
      const res = await fetch(`${apiBase}/automations/orchestrator/runs?limit=10`, {
        headers: authHeaders,
      });
      if (!res.ok) return;
      const data = (await res.json()) as { runs: OrchestratorRun[] };
      setPastRuns(data.runs.filter((r) => r.status !== "running"));
    } catch {
      // silent
    } finally {
      setIsLoadingRuns(false);
    }
  }, [apiBase, authHeaders]);

  const fetchContinuationAssessment = useCallback(
    async (run: OrchestratorRun): Promise<void> => {
      setContinuationModal((state) => ({
        ...state,
        isLoadingAssessment: true,
        assessment: null,
        errorMessage: null,
        successRunId: null,
      }));

      try {
        const res = await fetch(
          `${apiBase}/automations/orchestrator/runs/${run.id}/continuation-assessment`,
          { headers: authHeaders },
        );
        const body = await readResponseText(res);
        if (!res.ok) {
          const statusMessage =
            res.status === 404
              ? `Source run #${run.id} was not found.`
              : parseApiError(body);
          setContinuationModal((state) => ({
            ...state,
            errorMessage: statusMessage,
            isLoadingAssessment: false,
          }));
          return;
        }

        const assessment = JSON.parse(body) as ContinuationAssessment;
        setContinuationModal((state) => ({
          ...state,
          assessment,
          errorMessage: null,
          isLoadingAssessment: false,
        }));
      } catch (err) {
        setContinuationModal((state) => ({
          ...state,
          errorMessage: err instanceof Error ? err.message : "Unknown error.",
          isLoadingAssessment: false,
        }));
      }
    },
    [apiBase, authHeaders],
  );

  // ── Initial load + polling ────────────────────────────────────────────────────

  useEffect(() => {
    void fetchActiveRun();
    void fetchPastRuns();
  }, [fetchActiveRun, fetchPastRuns]);

  useEffect(() => {
    if (!activeRun || activeRun.status !== "running") return;
    const timer = setInterval(() => {
      void fetchActiveRun();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [activeRun, fetchActiveRun]);

  // When active run finishes, refresh past runs list
  useEffect(() => {
    if (activeRun && activeRun.status !== "running") {
      void fetchPastRuns();
    }
  }, [activeRun, fetchPastRuns]);

  // ── Actions ────────────────────────────────────────────────────────────────────

  const handleStart = async (mode: "weekly" | "abbreviated_test" = "weekly") => {
    if (mode === "abbreviated_test") {
      setIsStartingTest(true);
    } else {
      setIsStarting(true);
    }

    try {
      const requestBody =
        mode === "abbreviated_test"
          ? {
              mode,
              aiApproverEnabled,
              semanticScorerEnabled,
              testConfig: {
                deleteTrimCount: 100,
                targetArticlesAddedCount: 10,
                downstreamArticleCount: 10,
              },
            }
          : { aiApproverEnabled, semanticScorerEnabled };

      const res = await fetch(`${apiBase}/automations/orchestrator/start`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(requestBody),
      });

      if (!res.ok) {
        const body = await res.text();
        const message = parseApiError(body);
        if (res.status === 409) {
          setAlertModal({ show: true, title: "Already Running", message, variant: "warning" });
        } else if (res.status === 423) {
          setAlertModal({ show: true, title: "Locked", message, variant: "warning" });
        } else {
          setAlertModal({ show: true, title: "Start Failed", message, variant: "error" });
        }
        return;
      }

      await fetchActiveRun();
      await fetchPastRuns();
    } catch (err) {
      setAlertModal({
        show: true,
        title: "Start Failed",
        message: err instanceof Error ? err.message : "Unknown error.",
        variant: "error",
      });
    } finally {
      if (mode === "abbreviated_test") {
        setIsStartingTest(false);
      } else {
        setIsStarting(false);
      }
    }
  };

  const handleCancel = async () => {
    if (!activeRun) return;
    setIsCanceling(true);
    try {
      const res = await fetch(
        `${apiBase}/automations/orchestrator/runs/${activeRun.id}/cancel`,
        { method: "POST", headers: authHeaders, body: "{}" }
      );
      if (!res.ok) {
        const body = await res.text();
        setAlertModal({ show: true, title: "Cancel Failed", message: parseApiError(body), variant: "error" });
        return;
      }
      setAlertModal({ show: true, title: "Cancel Requested", message: "The cancel signal has been sent. The run will stop shortly.", variant: "info" });
    } catch (err) {
      setAlertModal({
        show: true,
        title: "Cancel Failed",
        message: err instanceof Error ? err.message : "Unknown error.",
        variant: "error",
      });
    } finally {
      setIsCanceling(false);
    }
  };

  const handleOpenContinuation = (run: OrchestratorRun) => {
    setContinuationModal({
      ...DEFAULT_CONTINUATION_MODAL,
      run,
      isOpen: true,
      isLoadingAssessment: true,
    });
    void fetchContinuationAssessment(run);
  };

  const handleCloseContinuation = () => {
    if (continuationModal.isConfirming) return;
    setContinuationModal(DEFAULT_CONTINUATION_MODAL);
  };

  const handleRetryContinuationAssessment = () => {
    if (!continuationModal.run) return;
    void fetchContinuationAssessment(continuationModal.run);
  };

  const handleConfirmContinuation = async () => {
    const sourceRun = continuationModal.run;
    if (!sourceRun || !continuationModal.assessment?.eligible) return;

    setContinuationModal((state) => ({
      ...state,
      isConfirming: true,
      errorMessage: null,
      successRunId: null,
    }));

    try {
      const res = await fetch(
        `${apiBase}/automations/orchestrator/runs/${sourceRun.id}/continue`,
        { method: "POST", headers: authHeaders, body: "{}" },
      );
      const body = await readResponseText(res);

      if (res.status === 202) {
        const data = body ? (JSON.parse(body) as ContinuePostSuccess) : {};
        const continuationRunId = data.runId ?? null;
        setContinuationModal((state) => ({
          ...state,
          isConfirming: false,
          successRunId: continuationRunId,
          errorMessage: null,
        }));
        await fetchActiveRun();
        await fetchPastRuns();
        return;
      }

      const message =
        res.status === 404
          ? `Source run #${sourceRun.id} was not found.`
          : res.status === 409
            ? `Continuation could not start because another run is active or the source is no longer eligible. ${parseApiError(body)}`
            : res.status === 422
              ? `Continuation is not supported for this run shape. ${parseApiError(body)}`
              : parseApiError(body);

      setContinuationModal((state) => ({
        ...state,
        isConfirming: false,
        errorMessage: message.trim(),
      }));

      if (res.status === 409) {
        await fetchActiveRun();
        await fetchPastRuns();
      }
    } catch (err) {
      setContinuationModal((state) => ({
        ...state,
        isConfirming: false,
        errorMessage: err instanceof Error ? err.message : "Unknown error.",
      }));
    }
  };

  // ── Step configuration table ──────────────────────────────────────────────────

  const stepRows: { name: OrchestratorStepName; label: string; checked: boolean; disabled: boolean; onToggle?: () => void }[] = [
    { name: "delete_articles", label: STEP_LABELS.delete_articles, checked: true, disabled: true },
    { name: "google_rss", label: STEP_LABELS.google_rss, checked: true, disabled: true },
    { name: "state_assigner", label: STEP_LABELS.state_assigner, checked: true, disabled: true },
    { name: "ai_approver", label: STEP_LABELS.ai_approver, checked: aiApproverEnabled, disabled: false, onToggle: () => setAiApproverEnabled((v) => !v) },
    { name: "semantic_scorer", label: STEP_LABELS.semantic_scorer, checked: semanticScorerEnabled, disabled: false, onToggle: () => setSemanticScorerEnabled((v) => !v) },
    { name: "report", label: STEP_LABELS.report, checked: true, disabled: true },
  ];

  const isRunActive = activeRun?.status === "running";

  return (
    <>
      <CollapsibleAutomationSection title="Weekly Orchestrator" defaultOpen={false}>
        <div className="space-y-6">

          {/* Step configuration */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
              Steps
            </h3>
            <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="w-full text-sm">
                <tbody>
                  {stepRows.map((row) => (
                    <tr key={row.name} className="border-b border-gray-100 last:border-0 dark:border-gray-800">
                      <td className="px-4 py-3">
                        <label className={`flex items-center gap-3 ${row.disabled ? "cursor-default" : "cursor-pointer"}`}>
                          <input
                            type="checkbox"
                            checked={row.checked}
                            disabled={row.disabled}
                            onChange={row.onToggle}
                            className="h-4 w-4 rounded border-gray-300 text-brand-500 disabled:cursor-not-allowed disabled:opacity-60"
                          />
                          <span className={`font-medium ${row.disabled ? "text-gray-500 dark:text-gray-400" : "text-gray-700 dark:text-gray-200"}`}>
                            {row.label}
                          </span>
                          {MANDATORY_STEPS.includes(row.name) && (
                            <span className="text-xs text-gray-400 dark:text-gray-500">(required)</span>
                          )}
                        </label>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void handleStart("weekly")}
              disabled={isStarting || isStartingTest || isRunActive}
              className="rounded-lg bg-brand-500 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-brand-600 dark:hover:bg-brand-700"
            >
              {isStarting ? "Starting…" : "Start Orchestrator"}
            </button>

            <button
              type="button"
              onClick={() => void handleStart("abbreviated_test")}
              disabled={isStarting || isStartingTest || isRunActive}
              className="rounded-lg border border-brand-300 px-6 py-2 text-sm font-medium text-brand-600 transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-brand-700 dark:text-brand-400 dark:hover:bg-brand-900/20"
            >
              {isStartingTest ? "Starting…" : "Start Test Run"}
            </button>

            {isRunActive && (
              <button
                type="button"
                onClick={() => void handleCancel()}
                disabled={isCanceling}
                className="rounded-lg border border-error-300 px-6 py-2 text-sm font-medium text-error-600 transition-colors hover:bg-error-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-error-700 dark:text-error-400 dark:hover:bg-error-900/20"
              >
                {isCanceling ? "Canceling…" : "Cancel Run"}
              </button>
            )}
          </div>

          {/* Active run status */}
          {activeRun && (
            <ActiveRunPanel run={activeRun} steps={activeRun.steps} apiBase={apiBase} token={token ?? ""} />
          )}

          {/* Past runs */}
          <PastRunsTable
            runs={pastRuns}
            isLoading={isLoadingRuns}
            apiBase={apiBase}
            token={token ?? ""}
            isRunActive={isRunActive}
            onContinue={handleOpenContinuation}
          />
        </div>
      </CollapsibleAutomationSection>

      <Modal isOpen={alertModal.show} onClose={() => setAlertModal(DEFAULT_ALERT)}>
        <ModalInformationOk
          title={alertModal.title}
          message={alertModal.message}
          variant={alertModal.variant}
          onClose={() => setAlertModal(DEFAULT_ALERT)}
        />
      </Modal>

      <Modal isOpen={continuationModal.isOpen} onClose={handleCloseContinuation}>
        <ContinuationConfirmationModal
          state={continuationModal}
          onClose={handleCloseContinuation}
          onConfirm={() => void handleConfirmContinuation()}
          onRetry={handleRetryContinuationAssessment}
        />
      </Modal>
    </>
  );
}

// ─── ActiveRunPanel ────────────────────────────────────────────────────────────

type ActiveRunPanelProps = {
  run: OrchestratorRun;
  steps: OrchestratorStep[];
  apiBase: string;
  token: string;
};

function ActiveRunPanel({ run, steps }: ActiveRunPanelProps) {
  const isRunning = run.status === "running";
  const currentStep = steps.find((s) => s.status === "running");

  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-white/[0.02]">
      <div className="mb-3 flex items-center gap-3">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-white/90">
          {isRunning ? "Run In Progress" : "Last Run"} — #{run.id}
        </h3>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${getRunStatusClasses(run.status)}`}>
          {run.status}
        </span>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
        <div>Started: {formatDate(run.startedAt)}</div>
        <div>Ended: {formatDate(run.endedAt)}</div>
        {run.articleIdMinExclusive !== null && (
          <div className="col-span-2">
            Articles: #{run.articleIdMinExclusive + 1} – #{run.articleIdMaxInclusive ?? "…"}
          </div>
        )}
        {run.failureReason && (
          <div className="col-span-2 text-error-600 dark:text-error-400">
            Reason: {run.failureReason}
          </div>
        )}
      </div>

      {isRunning && currentStep && (
        <div className="mb-3 rounded-lg border border-blue-light-200 bg-blue-light-50 p-3 text-xs dark:border-blue-light-800 dark:bg-blue-light-900/20">
          <span className="font-medium text-blue-light-700 dark:text-blue-light-400">
            Running step:
          </span>{" "}
          <span className="text-blue-light-600 dark:text-blue-light-300">
            {STEP_LABELS[currentStep.stepName]}
          </span>
          {currentStep.childJobId && (
            <span className="ml-2 font-mono text-blue-light-500">
              (job {currentStep.childJobId})
            </span>
          )}
          <span className="ml-2">
            Elapsed: {formatDuration(currentStep.startedAt, new Date().toISOString())}
          </span>
        </div>
      )}

      <div className="overflow-hidden rounded border border-gray-200 dark:border-gray-700">
        <table className="w-full text-xs">
          <thead className="bg-gray-100 dark:bg-gray-800">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Step</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Status</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Duration</th>
            </tr>
          </thead>
          <tbody>
            {steps.filter((s) => s.stepName !== "report").map((s) => (
              <tr key={s.id} className="border-t border-gray-100 dark:border-gray-800">
                <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{STEP_LABELS[s.stepName]}</td>
                <td className={`px-3 py-2 font-medium ${getStepStatusClasses(s.status)}`}>
                  {s.status}
                  {s.endingMessage && (
                    <span className="ml-1 font-normal text-gray-400">— {s.endingMessage}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">
                  {formatDuration(s.startedAt, s.endedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── PastRunsTable ─────────────────────────────────────────────────────────────

type PastRunsTableProps = {
  runs: OrchestratorRun[];
  isLoading: boolean;
  apiBase: string;
  token: string;
  isRunActive: boolean;
  onContinue: (run: OrchestratorRun) => void;
};

function PastRunsTable({
  runs,
  isLoading,
  apiBase,
  token,
  isRunActive,
  onContinue,
}: PastRunsTableProps) {
  if (isLoading) {
    return (
      <div className="text-sm text-gray-500 dark:text-gray-400">Loading past runs…</div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="text-sm text-gray-500 dark:text-gray-400">No completed runs yet.</div>
    );
  }

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">Past Runs</h3>
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="w-full text-xs">
          <thead className="bg-gray-100 dark:bg-gray-800">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Run</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Status</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Started</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Duration</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Report</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Action</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const canContinue = run.canRequestContinuationAssessment === true;
              return (
                <tr key={run.id} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300">#{run.id}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${getRunStatusClasses(run.status)}`}>
                      {run.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{formatDate(run.startedAt)}</td>
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-400">
                    {formatDuration(run.startedAt, run.endedAt)}
                  </td>
                  <td className="px-3 py-2">
                    {run.reportFilePath ? (
                      <a
                        href={`${apiBase}/automations/orchestrator/runs/${run.id}/report`}
                        download
                        onClick={(e) => {
                          e.preventDefault();
                          const a = document.createElement("a");
                          a.href = `${apiBase}/automations/orchestrator/runs/${run.id}/report`;
                          a.download = `orchestration-report-${run.id}.xlsx`;
                          const headers = new Headers({ Authorization: `Bearer ${token}` });
                          void fetch(a.href, { headers }).then(async (res) => {
                            const blob = await res.blob();
                            const url = URL.createObjectURL(blob);
                            a.href = url;
                            a.click();
                            URL.revokeObjectURL(url);
                          });
                        }}
                        className="text-brand-500 underline hover:text-brand-600 dark:text-brand-400"
                      >
                        Download
                      </a>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {canContinue ? (
                      <div className="flex flex-col items-start gap-0.5">
                        <button
                          type="button"
                          onClick={() => onContinue(run)}
                          disabled={isRunActive}
                          title="continue from where left off"
                          className="rounded-md border border-brand-300 px-3 py-1 text-xs font-medium text-brand-600 transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-brand-700 dark:text-brand-400 dark:hover:bg-brand-900/20"
                        >
                          continue
                        </button>
                        <span className="text-[11px] leading-4 text-gray-400 dark:text-gray-500">
                          from where left off
                        </span>
                      </div>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type ContinuationConfirmationModalProps = {
  state: ContinuationModalState;
  onClose: () => void;
  onConfirm: () => void;
  onRetry: () => void;
};

function ContinuationConfirmationModal({
  state,
  onClose,
  onConfirm,
  onRetry,
}: ContinuationConfirmationModalProps) {
  const assessment = state.assessment;
  const sourceRunId = assessment?.sourceRunId ?? state.run?.id ?? null;
  const canConfirm =
    assessment?.eligible === true &&
    !state.isConfirming &&
    !state.isLoadingAssessment &&
    state.successRunId === null;
  const blockingReasons = assessment?.blockingReasons ?? [];
  const warnings = [
    ...(state.run?.continuationSignalWarnings ?? []),
    ...(assessment?.warnings ?? []),
  ];

  return (
    <div className="p-6 sm:p-8">
      <div className="mb-5 pr-10">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
          Continue orchestration run
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Continue from where left off after server revalidation.
        </p>
      </div>

      {state.isLoadingAssessment && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-300">
          Loading continuation assessment…
        </div>
      )}

      {!state.isLoadingAssessment && state.errorMessage && (
        <div className="mb-4 rounded-lg border border-error-200 bg-error-50 p-4 text-sm text-error-700 dark:border-error-900/60 dark:bg-error-900/20 dark:text-error-300">
          {state.errorMessage}
        </div>
      )}

      {state.successRunId !== null && (
        <div className="mb-4 rounded-lg border border-success-200 bg-success-50 p-4 text-sm text-success-700 dark:border-success-900/60 dark:bg-success-900/20 dark:text-success-300">
          Continuation run #{state.successRunId} was accepted.
        </div>
      )}

      {assessment && (
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ContinuationDetail label="source run id" value={sourceRunId === null ? "unknown" : `#${sourceRunId}`} />
            <ContinuationDetail label="new run type" value="continuation" />
            <ContinuationDetail
              label="article lower bound"
              value={formatArticleBound(assessment.articleIdMinExclusive)}
            />
            <ContinuationDetail
              label="planned article upper bound"
              value={formatPlannedUpperBound(assessment.plannedArticleIdMaxInclusive)}
            />
          </div>

          <ContinuationStepList title="Inherited steps" steps={assessment.inheritedSteps} emptyText="none" />
          <ContinuationStepList title="Runnable steps" steps={assessment.runnableSteps} emptyText="none" />

          <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
            <div className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
              Google RSS resume behavior
            </div>
            <div className="mt-1 text-gray-700 dark:text-gray-200">
              {formatGoogleRssResume(assessment.googleRssResumePlan)}
            </div>
          </div>

          {!assessment.eligible && blockingReasons.length > 0 && (
            <ContinuationMessageList
              title="Blocking reasons"
              items={blockingReasons.map(blockingReasonText)}
              tone="error"
            />
          )}

          {warnings.length > 0 && (
            <ContinuationMessageList title="Warnings" items={warnings} tone="warning" />
          )}
        </div>
      )}

      {!state.isLoadingAssessment && !assessment && state.run?.continuationSignalWarnings?.length ? (
        <ContinuationMessageList
          title="Warnings"
          items={state.run.continuationSignalWarnings}
          tone="warning"
        />
      ) : null}

      <div className="mt-6 flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          disabled={state.isConfirming}
          className="rounded-lg bg-gray-100 px-5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          {state.successRunId === null ? "Cancel" : "Close"}
        </button>
        {state.errorMessage && state.successRunId === null && (
          <button
            type="button"
            onClick={onRetry}
            disabled={state.isLoadingAssessment || state.isConfirming}
            className="rounded-lg border border-brand-300 px-5 py-2 text-sm font-medium text-brand-600 transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-brand-700 dark:text-brand-400 dark:hover:bg-brand-900/20"
          >
            Retry
          </button>
        )}
        {state.successRunId === null && (
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm}
            className="rounded-lg bg-brand-500 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-brand-600 dark:hover:bg-brand-700"
          >
            {state.isConfirming ? "Continuing…" : "continue"}
          </button>
        )}
      </div>
    </div>
  );
}

type ContinuationDetailProps = {
  label: string;
  value: string;
};

function ContinuationDetail({ label, value }: ContinuationDetailProps) {
  return (
    <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
      <div className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">{label}</div>
      <div className="mt-1 text-gray-800 dark:text-gray-100">{value}</div>
    </div>
  );
}

type ContinuationStepListProps = {
  title: string;
  steps: ContinuationAssessmentStep[];
  emptyText: string;
};

function ContinuationStepList({ title, steps, emptyText }: ContinuationStepListProps) {
  return (
    <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
      <div className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">{title}</div>
      {steps.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {steps.map((step) => (
            <li key={`${step.stepName}-${step.sourceStepId ?? step.stepOrder}`} className="text-gray-700 dark:text-gray-200">
              {formatStepName(step.stepName)}
              {step.sourceStatus ? (
                <span className="text-gray-500 dark:text-gray-400"> ({step.sourceStatus})</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-1 text-gray-500 dark:text-gray-400">{emptyText}</div>
      )}
    </div>
  );
}

type ContinuationMessageListProps = {
  title: string;
  items: string[];
  tone: "error" | "warning";
};

function ContinuationMessageList({ title, items, tone }: ContinuationMessageListProps) {
  const classes =
    tone === "error"
      ? "border-error-200 bg-error-50 text-error-700 dark:border-error-900/60 dark:bg-error-900/20 dark:text-error-300"
      : "border-warning-200 bg-warning-50 text-warning-700 dark:border-warning-900/60 dark:bg-warning-900/20 dark:text-warning-300";

  return (
    <div className={`rounded-lg border p-3 text-sm ${classes}`}>
      <div className="text-xs font-semibold uppercase">{title}</div>
      <ul className="mt-2 space-y-1">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
