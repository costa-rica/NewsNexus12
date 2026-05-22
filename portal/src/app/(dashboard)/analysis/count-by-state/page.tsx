"use client";
import React, { useState, useEffect, useCallback } from "react";
import { useAppSelector } from "@/store/hooks";
import TableAdaptiveColumnsWithSearch from "@/components/tables/TableAdaptiveColumnsWithSearch";
import { StateCountData, UnassignedArticle } from "@/types/article";
import Link from "next/link";

export default function CountByStateAnalysis() {
  const { token } = useAppSelector((state) => state.user);
  const [articleCountByStateArray, setArticleCountByStateArray] = useState<
    StateCountData[]
  >([]);
  const [unassignedArticlesArray, setUnassignedArticlesArray] = useState<
    UnassignedArticle[]
  >([]);
  const [loading, setLoading] = useState(false);

  const fetchApprovedArticleStateCounts = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/analysis/approved-articles/by-state`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          method: "GET",
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server Error: ${errorText}`);
      }

      const result = await response.json();

      if (
        result.articleCountByStateArray &&
        Array.isArray(result.articleCountByStateArray)
      ) {
        setArticleCountByStateArray(result.articleCountByStateArray);
      } else {
        setArticleCountByStateArray([]);
      }

      if (
        result.unassignedArticlesArray &&
        Array.isArray(result.unassignedArticlesArray)
      ) {
        setUnassignedArticlesArray(result.unassignedArticlesArray);
      } else {
        setUnassignedArticlesArray([]);
      }
    } catch (error) {
      console.error("Error fetching data:", error);
      setArticleCountByStateArray([]);
      setUnassignedArticlesArray([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchApprovedArticleStateCounts();
  }, [fetchApprovedArticleStateCounts]);

  const downloadTableSpreadsheet = async () => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/downloads/utilities/download-excel-file/table-approved-by-state.xlsx`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          method: "POST",
          body: JSON.stringify({
            arrayToExport: articleCountByStateArray,
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server Error: ${errorText}`);
      }

      const contentDisposition = response.headers.get("Content-Disposition");
      let fileName = "table-approved-by-state.xlsx";

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
        Count by State Analysis
      </h1>

      {/* Unassigned Articles Warning */}
      {unassignedArticlesArray.length > 0 && (
        <div className="rounded-2xl border border-yellow-300 bg-yellow-50 p-6 dark:border-yellow-700 dark:bg-yellow-900/20">
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 mt-0.5">
                <svg
                  className="w-5 h-5 text-yellow-600 dark:text-yellow-500"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-yellow-800 dark:text-yellow-300 mb-2">
                  Unassigned Articles ({unassignedArticlesArray.length})
                </h3>
                <p className="text-xs text-yellow-700 dark:text-yellow-400 mb-3">
                  The following articles have not been assigned to any state:
                </p>
                <ul className="space-y-2">
                  {unassignedArticlesArray.map((article) => (
                    <li
                      key={article.id}
                      className="text-xs text-yellow-800 dark:text-yellow-300"
                    >
                      <span className="font-medium">ID: {article.id}</span> -{" "}
                      <Link
                        href={article.url}
                        target="_blank"
                        className="text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 underline"
                      >
                        {article.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Download Section */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">
              Export Data
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Download the state count analysis as an Excel spreadsheet
            </p>
          </div>
          <button
            onClick={downloadTableSpreadsheet}
            disabled={articleCountByStateArray.length === 0}
            className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Download Table Spreadsheet
          </button>
        </div>
      </div>

      {/* Table Section */}
      <div className="flex flex-col gap-4">
        <h2 className="text-title-md font-semibold text-gray-800 dark:text-white/90">
          Article Counts by State
        </h2>
        <TableAdaptiveColumnsWithSearch
          data={articleCountByStateArray}
          loading={loading}
          displayAll={true}
        />
      </div>
    </div>
  );
}
