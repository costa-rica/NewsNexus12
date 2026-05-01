"use client";

import React, { useCallback, useEffect, useState } from "react";
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
  status: OrchestratorRunStatus;
  startedAt: string;
  endedAt: string | null;
  articleIdMinExclusive: number | null;
  articleIdMaxInclusive: number | null;
  reportFilePath: string | null;
  failureReason: string | null;
  aiApproverEnabled: boolean;
  semanticScorerEnabled: boolean;
};

type AlertModalState = {
  message: string;
  show: boolean;
  title: string;
  variant: "error" | "info" | "success" | "warning";
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
      message?: string;
      error?: { message?: string };
    };
    if (parsed.orchestratorRunId !== undefined && parsed.message) {
      return parsed.message;
    }
    return parsed.message ?? parsed.error?.message ?? body;
  } catch {
    return body;
  }
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

  const authHeaders = {
    Authorization: `Bearer ${token ?? ""}`,
    "Content-Type": "application/json",
  };
  const canShowTestRun =
    process.env.NEXT_PUBLIC_MODE === "development" ||
    process.env.NEXT_PUBLIC_MODE === "testing";

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
  }, [apiBase, token]);

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
  }, [apiBase, token]);

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
  }, [activeRun?.status]);

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

            {canShowTestRun && (
              <button
                type="button"
                onClick={() => void handleStart("abbreviated_test")}
                disabled={isStarting || isStartingTest || isRunActive}
                className="rounded-lg border border-brand-300 px-6 py-2 text-sm font-medium text-brand-600 transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-brand-700 dark:text-brand-400 dark:hover:bg-brand-900/20"
              >
                {isStartingTest ? "Starting…" : "Start Test Run"}
              </button>
            )}

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
          <PastRunsTable runs={pastRuns} isLoading={isLoadingRuns} apiBase={apiBase} token={token ?? ""} />
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
};

function PastRunsTable({ runs, isLoading, apiBase, token }: PastRunsTableProps) {
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
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
