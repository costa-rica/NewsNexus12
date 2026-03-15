"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useAppSelector } from "@/store/hooks";

export function WebBrowserExtensionsSection() {
  const { token } = useAppSelector((state) => state.user);
  const [webBrowserExtensionsArray, setWebBrowserExtensionsArray] = useState<
    string[]
  >([]);

  const fetchWebBrowserExtensionsList = useCallback(async () => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/downloads/utilities/web-browser-extensions`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server Error: ${errorText}`);
      }

      const result = await response.json();

      if (
        result.webBrowserExtensionsArray &&
        Array.isArray(result.webBrowserExtensionsArray)
      ) {
        setWebBrowserExtensionsArray(result.webBrowserExtensionsArray);
        return;
      }

      setWebBrowserExtensionsArray([]);
    } catch (error) {
      console.error("Error fetching browser extensions:", error);
      setWebBrowserExtensionsArray([]);
    }
  }, [token]);

  useEffect(() => {
    fetchWebBrowserExtensionsList();
  }, [fetchWebBrowserExtensionsList]);

  const downloadWebBrowserExtension = async (extension: string) => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/downloads/utilities/web-browser-extension/${extension}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server Error: ${errorText}`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = extension;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Error downloading extension:", error);
      alert("Error downloading extension. Please try again.");
    }
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
      <h2 className="mb-4 text-title-lg font-semibold text-gray-800 dark:text-white/90">
        Web Browser Extensions
      </h2>

      <div className="mb-6 rounded-2xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-white/[0.02]">
        {webBrowserExtensionsArray.length > 0 ? (
          <ul className="divide-y divide-gray-200 dark:divide-gray-800">
            {webBrowserExtensionsArray.map((extension) => (
              <li
                key={extension}
                className="p-4 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800/50"
              >
                <button
                  onClick={() => downloadWebBrowserExtension(extension)}
                  className="text-sm text-brand-500 transition-colors hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300"
                >
                  {extension}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No browser extensions available
          </div>
        )}
      </div>

      <div className="space-y-6">
        <div>
          <h3 className="mb-3 text-base font-semibold text-gray-800 dark:text-white/90">
            Guide installing Firefox
          </h3>
          <ol className="ml-6 list-decimal space-y-2 text-sm text-gray-600 dark:text-gray-400">
            <li>Download the file</li>
            <li>Unzip the file and save somewhere it can stay</li>
            <li>
              In Firefox put{" "}
              <code className="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-800 dark:bg-gray-700 dark:text-gray-200">
                about:debugging#/runtime/this-firefox
              </code>{" "}
              in the address bar
            </li>
            <li>
              Click on the load temporary button - this will let you add the
              extension
            </li>
            <li>Find the unzipped folder and select the manifest.json file</li>
            <li>The extension should now be installed</li>
          </ol>
        </div>

        <div>
          <h3 className="mb-3 text-base font-semibold text-gray-800 dark:text-white/90">
            Guide installing Chrome
          </h3>
          <ol className="ml-6 list-decimal space-y-2 text-sm text-gray-600 dark:text-gray-400">
            <li>Download the file</li>
            <li>Unzip the file and save somewhere it can stay</li>
            <li>
              In Chrome put{" "}
              <code className="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-800 dark:bg-gray-700 dark:text-gray-200">
                chrome://extensions/
              </code>{" "}
              in the address bar
            </li>
            <li>
              Click on the <strong>load unpacked</strong> button (maybe: top
              left of screen) - this will let you add the extension
            </li>
            <li>Find the unzipped folder and select the folder</li>
            <li>The extension should now be installed</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
