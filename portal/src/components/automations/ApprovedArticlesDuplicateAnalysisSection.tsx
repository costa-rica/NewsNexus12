"use client";

import React from "react";
import Link from "next/link";
import { CollapsibleAutomationSection } from "@/components/automations/CollapsibleAutomationSection";
import { WorkerPythonJobStatusPanel } from "@/components/automations/WorkerPythonJobStatusPanel";
import { ArrowRightIcon } from "@/icons";

const DEDUPER_ENDPOINT_NAME = "/deduper/start-job";

export function ApprovedArticlesDuplicateAnalysisSection() {
  return (
    <CollapsibleAutomationSection
      title="Approved Articles Duplicate Analysis"
      defaultOpen={false}
    >
      <div className="space-y-6">
        <div className="space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Use the dedicated analysis page to run duplicate analysis for approved
            articles, then monitor the latest deduper job status here.
          </p>

          <Link
            href="/analysis/approved-article-duplicate"
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Go to Approved Article Duplicate Analysis
            <ArrowRightIcon className="h-4 w-4" />
          </Link>
        </div>

        <WorkerPythonJobStatusPanel
          endpointName={DEDUPER_ENDPOINT_NAME}
          title="Last Deduper Job"
        />
      </div>
    </CollapsibleAutomationSection>
  );
}
