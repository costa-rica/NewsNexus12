"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAppSelector } from "@/store/hooks";
import { CollapsibleAutomationSection } from "@/components/automations/CollapsibleAutomationSection";
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

export function ArticleRequestSpreadsheetsSection() {
  const { token } = useAppSelector((state) => state.user);
  const [filesArray, setFilesArray] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [alertModal, setAlertModal] = useState<AlertModalState>(
    DEFAULT_ALERT_MODAL_STATE,
  );

  const fetchAutomationFilesList = useCallback(async () => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/automations/excel-files`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      console.log(`Response status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server Error: ${errorText}`);
      }

      const result = await response.json();
      console.log("Fetched Data:", result);

      if (
        result.excelFileNamesArray &&
        Array.isArray(result.excelFileNamesArray)
      ) {
        setFilesArray(result.excelFileNamesArray);
      } else {
        setFilesArray([]);
      }
    } catch (error) {
      console.error("Error fetching data:", error);
      setFilesArray([]);
      setAlertModal({
        message: "Error retrieving spreadsheet list. Please try again.",
        show: true,
        title: "Request Failed",
        variant: "error",
      });
    }
  }, [token]);

  useEffect(() => {
    fetchAutomationFilesList();
  }, [fetchAutomationFilesList]);

  const downloadExcelFile = async (fileName: string) => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/automations/excel-file/${fileName}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      console.log(`Response status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server Error: ${errorText}`);
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
      console.error("Error downloading file:", error);
      setAlertModal({
        message: "Error downloading file. Please try again.",
        show: true,
        title: "Download Failed",
        variant: "error",
      });
    }
  };

  const sendExcelFile = async (file: File) => {
    if (!file) return;

    if (!filesArray.includes(file.name)) {
      setAlertModal({
        message:
          "Filename not recognized. Please select a file with a name from the list.",
        show: true,
        title: "Invalid Filename",
        variant: "warning",
      });
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    const fileName = encodeURIComponent(file.name);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/automations/excel-file/${fileName}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server Error: ${errorText}`);
      }

      await response.json();
      setAlertModal({
        message: "File uploaded successfully!",
        show: true,
        title: "Upload Complete",
        variant: "success",
      });
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (error) {
      console.error("Error uploading file:", error);
      setAlertModal({
        message: "Error uploading file. Please try again.",
        show: true,
        title: "Upload Failed",
        variant: "error",
      });
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleUploadClick = () => {
    if (selectedFile) {
      void sendExcelFile(selectedFile);
    }
  };

  return (
    <>
      <CollapsibleAutomationSection
        title="Article Request Spreadsheets"
        defaultOpen={false}
      >
        <div className="mb-6 rounded-2xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-white/[0.02]">
          {filesArray.length > 0 ? (
            <ul className="divide-y divide-gray-200 dark:divide-gray-800">
              {filesArray.map((file) => (
                <li
                  key={file}
                  className="p-4 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800/50"
                >
                  <button
                    onClick={() => downloadExcelFile(file)}
                    className="text-sm text-brand-500 transition-colors hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300"
                  >
                    {file}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
              No Excel files available
            </div>
          )}
        </div>

        <div className="mb-6 space-y-4">
          <div className="flex flex-col gap-2">
            <label
              htmlFor="excelFileUpload"
              className="text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Upload Excel file:
            </label>
            <input
              id="excelFileUpload"
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              onChange={handleFileChange}
              className="block w-full text-sm text-gray-700 file:mr-4 file:rounded-lg file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100 dark:file:bg-brand-900/20 dark:file:text-brand-400 dark:hover:file:bg-brand-900/30 dark:text-gray-300"
            />
          </div>
          <button
            onClick={handleUploadClick}
            disabled={!selectedFile}
            className="rounded-lg bg-brand-500 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-brand-600 dark:hover:bg-brand-700"
          >
            Upload
          </button>
        </div>

        <div className="space-y-6">
          <div>
            <h3 className="mb-3 text-base font-semibold text-gray-800 dark:text-white/90">
              Guide to modifying the excel files
            </h3>
            <ul className="ml-6 list-disc space-y-2 text-sm text-gray-600 dark:text-gray-400">
              <li>
                <strong>andString column:</strong> will return all articles that
                have all the words in the string
              </li>
              <li>
                <strong>orString column:</strong> will return all articles that
                have any of the words in the string
              </li>
              <li>
                <strong>notString column:</strong> will return all articles that
                do not have any of the words in the string
              </li>
              <li>No commas in these strings; spaces separate the words</li>
              <li>
                Quote the strings for words with spaces or any special
                characters !, ?, $, etc.
              </li>
              <li>
                For News API <strong>includeDomains</strong> and{" "}
                <strong>excludeDomains</strong> columns use commas, there is no
                https:// or www.
              </li>
              <li>
                If domains do not match with what is found in database they will
                be omitted
              </li>
            </ul>
          </div>

          <div>
            <h3 className="mb-3 text-base font-semibold text-gray-800 dark:text-white/90">
              Guide to modifying NewsNexusRequestGoogleRss04 spreadsheet
            </h3>
            <ul className="ml-6 list-disc space-y-2 text-sm text-gray-600 dark:text-gray-400">
              <li>
                <strong>id:</strong> integer identifier for the row (optional,
                used for logging, still runs fine without it)
              </li>
              <li>
                <strong>and_keywords:</strong> comma-separated keywords for AND
                searches
              </li>
              <li>
                <strong>and_exact_phrases:</strong> comma-separated quoted exact
                phrases (spaces optional, double or single quotes accepted) for
                AND searches
              </li>
              <li>
                <strong>or_keywords:</strong> comma-separated keywords for OR
                searches
              </li>
              <li>
                <strong>or_exact_phrases:</strong> comma-separated quoted exact
                phrases (spaces optional, double or single quotes accepted) for OR
                searches
              </li>
              <li>
                <strong>time_range:</strong> string such as 1d. The current state
                only seems to use days. So 1d, 2d, 3d, etc. Or it could be left
                blank. If left blank or invalid, it will default to 180d.
              </li>
            </ul>

            <details className="mt-4 rounded-lg border border-gray-200 dark:border-gray-700">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800/50">
                Examples of exact phrases
              </summary>
              <div className="space-y-3 border-t border-gray-200 px-4 py-3 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-400">
                <p>
                  For <strong>and_exact_phrases</strong> and{" "}
                  <strong>or_exact_phrases</strong> columns, quotes are optional
                  but recommended for clarity. The system automatically adds
                  double quotes to multi-word phrases if not provided.
                </p>

                <div className="space-y-4">
                  <div>
                    <p className="mb-1 font-medium text-gray-700 dark:text-gray-300">
                      Example 1:
                    </p>
                    <p className="mb-1">Input in spreadsheet:</p>
                    <code className="block rounded bg-gray-100 px-3 py-2 text-xs dark:bg-gray-800">
                      climate change, global warming
                    </code>
                    <p className="mt-1">Result in query:</p>
                    <code className="block rounded bg-gray-100 px-3 py-2 text-xs dark:bg-gray-800">
                      &quot;climate change&quot; &quot;global warming&quot;
                    </code>
                  </div>

                  <div>
                    <p className="mb-1 font-medium text-gray-700 dark:text-gray-300">
                      Example 2:
                    </p>
                    <p className="mb-1">Input in spreadsheet:</p>
                    <code className="block rounded bg-gray-100 px-3 py-2 text-xs dark:bg-gray-800">
                      &quot;climate change&quot;, &quot;global warming&quot;
                    </code>
                    <p className="mt-1">Result in query:</p>
                    <code className="block rounded bg-gray-100 px-3 py-2 text-xs dark:bg-gray-800">
                      &quot;climate change&quot; &quot;global warming&quot;
                    </code>
                  </div>

                  <div>
                    <p className="mb-1 font-medium text-gray-700 dark:text-gray-300">
                      Example 3:
                    </p>
                    <p className="mb-1">Input in spreadsheet:</p>
                    <code className="block rounded bg-gray-100 px-3 py-2 text-xs dark:bg-gray-800">
                      &apos;climate change&apos;, &apos;global warming&apos;
                    </code>
                    <p className="mt-1">Result in query:</p>
                    <code className="block rounded bg-gray-100 px-3 py-2 text-xs dark:bg-gray-800">
                      &apos;climate change&apos; &apos;global warming&apos;
                    </code>
                  </div>
                </div>
              </div>
            </details>
          </div>
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
