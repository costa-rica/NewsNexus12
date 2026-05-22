"use client";
import React, { useState, useEffect, useCallback } from "react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { updateRequestsAnalysisTableBodyParams } from "@/store/features/user/userSlice";
import TableArticleRequests from "@/components/tables/TableArticleRequests";
import { ArticleRequest } from "@/types/article";

export default function ArticleRequestsAnalysis() {
  const dispatch = useAppDispatch();
  const { token, requestsAnalysisTableBodyParams } = useAppSelector(
    (state) => state.user
  );
  const [requestsArray, setRequestsArray] = useState<ArticleRequest[]>([]);
  const [approvedArticleStats, setApprovedArticleStats] = useState({
    countOfApprovedArticles: 0,
    countOfManuallyApprovedArticles: 0,
  });
  const [dateModified, setDateModified] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchApprovedArticles = useCallback(async (dateRequestsLimit?: string) => {
    setLoading(true);
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/articles/table-approved-by-request`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          method: "POST",
          body: JSON.stringify({
            dateRequestsLimit:
              dateRequestsLimit ?? requestsAnalysisTableBodyParams?.dateRequestsLimit,
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server Error: ${errorText}`);
      }

      const result = await response.json();

      if (result.requestsArray && Array.isArray(result.requestsArray)) {
        setRequestsArray(result.requestsArray);
        setApprovedArticleStats({
          countOfApprovedArticles: result.countOfApprovedArticles,
          countOfManuallyApprovedArticles:
            result.countOfManuallyApprovedArticles,
        });
        setDateModified(false);
      } else {
        setRequestsArray([]);
      }
    } catch (error) {
      console.error("Error fetching data:", error);
      setRequestsArray([]);
    } finally {
      setLoading(false);
    }
  }, [token, requestsAnalysisTableBodyParams]);

  useEffect(() => {
    fetchApprovedArticles();
  }, [fetchApprovedArticles]);

  const downloadTableSpreadsheet = async () => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/downloads/utilities/download-excel-file/table-approved-by-request.xlsx`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          method: "POST",
          body: JSON.stringify({
            arrayToExport: requestsArray,
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server Error: ${errorText}`);
      }

      const contentDisposition = response.headers.get("Content-Disposition");
      let fileName = "table-approved-by-request.xlsx";

      if (contentDisposition && contentDisposition.includes("filename=")) {
        const match = contentDisposition.match(/filename="(.+)"/);
        if (match && match[1]) {
          fileName = match[1];
        }
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Error downloading spreadsheet:", error);
      alert("Error downloading spreadsheet. Please try again.");
    }
  };

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <h1 className="text-title-xl text-gray-700 dark:text-gray-300">
        Article Requests Analysis
      </h1>

      {/* Summary Section */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90 mb-4">
              Summary of Approved Articles
            </h2>

            {/* Date Input */}
            <div className="flex flex-col gap-2 mb-4">
              <label
                htmlFor="dateLimit"
                className="text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Show articles approved since:
              </label>
              <div className="flex items-center gap-3">
                <input
                  id="dateLimit"
                  type="date"
                  value={
                    requestsAnalysisTableBodyParams?.dateRequestsLimit || ""
                  }
                  onChange={(e) => {
                    const nextDateRequestsLimit = e.target.value;
                    setDateModified(true);
                    dispatch(
                      updateRequestsAnalysisTableBodyParams({
                        dateRequestsLimit: nextDateRequestsLimit,
                      })
                    );
                    void fetchApprovedArticles(nextDateRequestsLimit);
                  }}
                  className={`px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white ${
                    dateModified
                      ? "border-yellow-500 dark:border-yellow-500"
                      : "border-gray-300"
                  }`}
                />
                {dateModified && (
                  <button
                    onClick={() => void fetchApprovedArticles()}
                    className="px-4 py-2 bg-brand-500 text-white text-sm font-medium rounded-lg hover:bg-brand-600 transition-colors dark:bg-brand-600 dark:hover:bg-brand-700"
                  >
                    Refresh
                  </button>
                )}
              </div>
              {dateModified && (
                <span className="text-xs text-yellow-600 dark:text-yellow-500">
                  * Click &quot;Refresh&quot; for changes to take effect
                </span>
              )}
            </div>

            {/* Statistics */}
            <div className="flex flex-col gap-2 text-sm text-gray-700 dark:text-gray-300">
              <div className="flex items-center gap-2">
                <span className="font-medium">
                  Count of All Approved Articles:
                </span>
                <span className="text-lg font-semibold text-brand-500 dark:text-brand-400">
                  {approvedArticleStats.countOfApprovedArticles}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-medium">Manually Approved Articles:</span>
                <span className="text-lg font-semibold text-brand-500 dark:text-brand-400">
                  {approvedArticleStats.countOfManuallyApprovedArticles}
                </span>
              </div>
            </div>
          </div>

          {/* Download Button */}
          <div className="flex items-center justify-end">
            <button
              onClick={downloadTableSpreadsheet}
              disabled={requestsArray.length === 0}
              className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Download Table Spreadsheet
            </button>
          </div>
        </div>
      </div>

      {/* Table Section */}
      <div className="flex flex-col gap-4">
        <h2 className="text-title-md font-semibold text-gray-800 dark:text-white/90">
          Requests ({requestsArray.length})
        </h2>
        <TableArticleRequests data={requestsArray} loading={loading} />
      </div>
    </div>
  );
}
