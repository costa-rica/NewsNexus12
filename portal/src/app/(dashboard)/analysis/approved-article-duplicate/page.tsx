"use client";
import React, { useState, useEffect, useCallback } from "react";
import { useAppSelector } from "@/store/hooks";
import TableReportsWeeklyCpscSelectableRows, {
  Report,
} from "@/components/tables/TableReportsWeeklyCpscSelectableRows";
import TableDuplicateAnalysis, {
  ReportArticleDictionary,
} from "@/components/tables/TableDuplicateAnalysis";
import { Modal } from "@/components/ui/modal";
import { ModalInformationYesOrNo } from "@/components/ui/modal/ModalInformationYesOrNo";
import { ModalInformationOk } from "@/components/ui/modal/ModalInformationOk";

interface JobListStatusResponse {
  jobs: Array<{
    status: string;
    [key: string]: unknown;
  }>;
}

interface ArticleDuplicateAnalysesStatusResponse {
  reportId: number | null;
}

interface ReportGroup {
  crName: string;
  reportsArray: Report[];
}

export default function ApprovedArticleDuplicate() {
  const { token } = useAppSelector((state) => state.user);

  // State management
  const [jobsStatus, setJobsStatus] = useState<string>("no jobs");
  const [
    articleDuplicateAnalysesTableReportId,
    setArticleDuplicateAnalysesTableReportId,
  ] = useState<number | null>(null);
  const [thresholdPercentage, setThresholdPercentage] = useState<string>("70");
  const [reportsArray, setReportsArray] = useState<ReportGroup[]>([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const [selectedReportId, setSelectedReportId] = useState<number | null>(null);
  const [duplicateAnalysisData, setDuplicateAnalysisData] =
    useState<ReportArticleDictionary | null>(null);
  const [loadingDuplicateAnalysis, setLoadingDuplicateAnalysis] =
    useState(false);
  const [isCreatingAnalysis, setIsCreatingAnalysis] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [alertModal, setAlertModal] = useState<{
    show: boolean;
    variant: "success" | "error";
    title: string;
    message: string;
  }>({
    show: false,
    variant: "success",
    title: "",
    message: "",
  });

  // Fetch job list status
  const fetchJobListStatus = useCallback(async () => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/analysis/deduper/job-list-status`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server Error: ${errorText}`);
      }

      const resJson: JobListStatusResponse = await response.json();

      // Queue-backed deduper jobs can be either queued or running while active.
      const hasActiveJob = resJson.jobs?.some(
        (job) => job.status === "running" || job.status === "queued"
      );
      setJobsStatus(hasActiveJob ? "loading" : "no jobs");
    } catch (error) {
      console.error("Error fetching job list status:", error);
      setJobsStatus("no jobs");
    }
  }, [token]);

  // Fetch duplicate analysis table data
  const fetchDuplicateAnalysisTable = useCallback(
    async (reportId: number) => {
      setLoadingDuplicateAnalysis(true);
      try {
        const thresholdDecimal = parseFloat(thresholdPercentage) / 100;

        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_BASE_URL}/analysis/deduper/report-checker-table`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              reportId,
              embeddingThresholdMinimum: thresholdDecimal,
              spacerRow: true,
            }),
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Server Error: ${errorText}`);
        }

        const resJson = await response.json();
        setDuplicateAnalysisData(resJson.reportArticleDictionary || {});
      } catch (error) {
        console.error("Error fetching duplicate analysis table:", error);
        setDuplicateAnalysisData({});
      } finally {
        setLoadingDuplicateAnalysis(false);
      }
    },
    [token, thresholdPercentage]
  );

  // Fetch article duplicate analyses status
  const fetchArticleDuplicateAnalysesStatus = useCallback(async () => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/analysis/deduper/article-duplicate-analyses-status`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server Error: ${errorText}`);
      }

      const resJson: ArticleDuplicateAnalysesStatusResponse =
        await response.json();

      if (resJson.reportId !== null) {
        setArticleDuplicateAnalysesTableReportId(resJson.reportId);
        // Fetch the duplicate analysis table data
        fetchDuplicateAnalysisTable(resJson.reportId);
      }
    } catch (error) {
      console.error("Error fetching article duplicate analyses status:", error);
    }
  }, [token, fetchDuplicateAnalysisTable]);

  // Fetch reports array
  const fetchReportsArray = useCallback(async () => {
    setLoadingReports(true);
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/reports`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server Error: ${errorText}`);
      }

      const resJson = await response.json();

      // Add selected property to each report
      const reportsWithSelection = (resJson.reportsArrayByCrName || []).map(
        (group: ReportGroup) => ({
          ...group,
          reportsArray: group.reportsArray.map((report: Report) => ({
            ...report,
            selected: false,
          })),
        })
      );

      setReportsArray(reportsWithSelection);
    } catch (error) {
      console.error("Error fetching reports:", error);
      setReportsArray([]);
    } finally {
      setLoadingReports(false);
    }
  }, [token]);

  // Initial API calls on mount
  useEffect(() => {
    fetchJobListStatus();
    fetchArticleDuplicateAnalysesStatus();
    fetchReportsArray();
  }, [
    fetchJobListStatus,
    fetchArticleDuplicateAnalysesStatus,
    fetchReportsArray,
  ]);

  // Handle row selection
  const handleRowSelect = (reportId: number) => {
    // Update selected state for all reports
    const updatedReports = reportsArray.map((group) => ({
      ...group,
      reportsArray: group.reportsArray.map((report) => ({
        ...report,
        selected: report.id === reportId,
      })),
    }));

    setReportsArray(updatedReports);
    setSelectedReportId(reportId);
  };

  // Button handlers
  const handleRunDuplicateAnalysis = () => {
    if (selectedReportId === null) return;
    setShowConfirmModal(true);
  };

  const confirmRunDuplicateAnalysis = async () => {
    if (selectedReportId === null) return;

    // Hide table and show loading message
    setIsCreatingAnalysis(true);
    setDuplicateAnalysisData(null);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/analysis/deduper/request-job/${selectedReportId}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server Error: ${errorText}`);
      }

      // Note: The actual analysis creation happens on the backend
      // User will need to refresh or check back later for the table
      setAlertModal({
        show: true,
        variant: "success",
        title: "Analysis Initiated",
        message:
          "Duplicate analysis has been initiated. Refresh the page to see results.",
      });
    } catch (error) {
      console.error("Error running duplicate analysis:", error);
      setAlertModal({
        show: true,
        variant: "error",
        title: "Error",
        message: "Error initiating duplicate analysis. Please try again.",
      });
      setIsCreatingAnalysis(false);
    }
  };

  const handleDownloadReportSpreadsheet = async () => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/downloads/utilities/download-excel-file/deduper_analysis.xlsx`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server Error: ${errorText}`);
      }

      // Get the blob from the response
      const blob = await response.blob();

      // Create a temporary URL for the blob
      const url = window.URL.createObjectURL(blob);

      // Create a temporary link element and trigger download
      const link = document.createElement("a");
      link.href = url;
      link.download = "deduper_analysis.xlsx";
      document.body.appendChild(link);
      link.click();

      // Cleanup
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Error downloading report spreadsheet:", error);
      alert("Error downloading report spreadsheet. Please try again.");
    }
  };

  // Handle threshold input change with validation
  const handleThresholdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;

    // Allow empty string for editing
    if (value === "") {
      setThresholdPercentage("");
      return;
    }

    // Only allow numbers and decimal point
    if (!/^\d*\.?\d*$/.test(value)) {
      return;
    }

    const numValue = parseFloat(value);

    // Validate range 0-100
    if (numValue >= 0 && numValue <= 100) {
      setThresholdPercentage(value);
    } else if (value === "0" || value === "0.") {
      setThresholdPercentage(value);
    }
  };

  // Get status text color based on job status
  const getStatusColor = () => {
    switch (jobsStatus) {
      case "loading":
        return "text-green-400";
      case "no jobs":
      default:
        return "text-gray-500";
    }
  };

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <h1 className="text-title-xl text-gray-700 dark:text-gray-300">
        Approved Article Duplicate Analysis
      </h1>

      {/* Top Row - Status/Controls and Reports Table Side by Side on sm+ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6 sm:items-start">
        {/* Left: Top Section - Status, Buttons, and Input */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 h-fit">
          {/* Status Information */}
          <div className="mb-6 space-y-2">
            <div className="text-base">
              <span className="text-gray-700 dark:text-gray-300">
                Current job status:{" "}
              </span>
              <span className={`font-semibold ${getStatusColor()}`}>
                {jobsStatus}
              </span>
            </div>
            <div className="text-base">
              <span className="text-gray-700 dark:text-gray-300">
                ArticlesDuplicateAnalyses is populated for report ID:
              </span>
              <span className="font-semibold text-gray-900 dark:text-white ml-1">
                {articleDuplicateAnalysesTableReportId !== null
                  ? articleDuplicateAnalysesTableReportId
                  : "N/A"}
              </span>
            </div>
          </div>

          {/* Buttons */}
          <div className="flex flex-col gap-3 mb-6">
            <button
              onClick={handleRunDuplicateAnalysis}
              disabled={selectedReportId === null}
              className="px-4 py-2 bg-brand-500 text-white rounded-lg font-medium hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors dark:bg-brand-600 dark:hover:bg-brand-700"
            >
              Run Duplicate Analysis
            </button>
            <button
              onClick={handleDownloadReportSpreadsheet}
              disabled={articleDuplicateAnalysesTableReportId === null}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors dark:bg-blue-600 dark:hover:bg-blue-700"
            >
              Download report spreadsheet
            </button>
          </div>

          {/* Threshold Input */}
          <div className="flex flex-col gap-2">
            <label
              htmlFor="threshold-input"
              className="text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Duplicate Rating Minimum Threshold
            </label>
            <div className="flex items-center gap-2">
              <input
                id="threshold-input"
                type="text"
                value={thresholdPercentage}
                onChange={handleThresholdChange}
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500 dark:focus:ring-brand-600"
                placeholder="70"
              />
              <span className="text-gray-700 dark:text-gray-300 font-medium">
                %
              </span>
            </div>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Enter a value between 0 and 100
            </span>
          </div>
        </div>

        {/* Right: Middle Section - Weekly CPSC Reports Table */}
        <div className="flex flex-col gap-4 sm:h-full">
          <h2 className="text-title-md font-semibold text-gray-800 dark:text-white/90">
            Weekly CPSC Reports
          </h2>
          <div className="flex-1 sm:min-h-0">
            <TableReportsWeeklyCpscSelectableRows
              data={reportsArray}
              loading={loadingReports}
              onRowSelect={handleRowSelect}
            />
          </div>
        </div>
      </div>

      {/* Bottom Section - Duplicate Analysis Table */}
      {articleDuplicateAnalysesTableReportId !== null &&
        !isCreatingAnalysis && (
          <div className="flex flex-col gap-4">
            <h2 className="text-title-md font-semibold text-gray-800 dark:text-white/90">
              Duplicate Analysis Table
            </h2>
            {duplicateAnalysisData !== null ? (
              <TableDuplicateAnalysis
                data={duplicateAnalysisData}
                loading={loadingDuplicateAnalysis}
              />
            ) : (
              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
                <p className="text-gray-500 dark:text-gray-400">
                  Loading duplicate analysis data...
                </p>
              </div>
            )}
          </div>
        )}

      {/* Creating Analysis Message */}
      {isCreatingAnalysis && (
        <div className="flex flex-col gap-4">
          <h2 className="text-title-md font-semibold text-gray-800 dark:text-white/90">
            Duplicate Analysis Table
          </h2>
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <p className="text-gray-600 dark:text-gray-400">
              Table is being created. Refresh or return later for table
            </p>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      <Modal
        isOpen={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        showCloseButton={true}
      >
        <ModalInformationYesOrNo
          title="Are You Sure?"
          message="This will delete the current duplicate analysis table in the database and create a new one. This process takes approximately 1 hour to complete."
          onYes={confirmRunDuplicateAnalysis}
          onClose={() => setShowConfirmModal(false)}
          yesButtonText="Yes, Run Analysis"
          noButtonText="Cancel"
          yesButtonStyle="danger"
        />
      </Modal>

      {/* Alert Modal */}
      <Modal
        isOpen={alertModal.show}
        onClose={() => setAlertModal({ ...alertModal, show: false })}
        showCloseButton={true}
      >
        <ModalInformationOk
          title={alertModal.title}
          message={alertModal.message}
          variant={alertModal.variant}
          onClose={() => setAlertModal({ ...alertModal, show: false })}
        />
      </Modal>
    </div>
  );
}
