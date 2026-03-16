"use client";
import React from "react";
import { ApprovedArticlesDuplicateAnalysisSection } from "@/components/automations/ApprovedArticlesDuplicateAnalysisSection";
import { ArticleRequestSpreadsheetsSection } from "@/components/automations/ArticleRequestSpreadsheetsSection";
import { GoogleRssSection } from "@/components/automations/GoogleRssSection";
import { StateAssignerSection } from "@/components/automations/StateAssignerSection";

export default function ManageAutomation() {
  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <h1 className="text-title-xl text-gray-700 dark:text-gray-300">
        Manage Automations
      </h1>

      <GoogleRssSection />
      <StateAssignerSection />
      <ApprovedArticlesDuplicateAnalysisSection />
      <ArticleRequestSpreadsheetsSection />
    </div>
  );
}
