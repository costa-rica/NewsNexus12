"use client";
import React from "react";
import { ApprovedArticlesDuplicateAnalysisSection } from "@/components/automations/ApprovedArticlesDuplicateAnalysisSection";
import { AiApproverSection } from "@/components/automations/AiApproverSection";
import { ArticleRequestSpreadsheetsSection } from "@/components/automations/ArticleRequestSpreadsheetsSection";
import { GoogleRssSection } from "@/components/automations/GoogleRssSection";
import { LocationScorerSection } from "@/components/automations/LocationScorerSection";
import { ScrapeArticleContentSection } from "@/components/automations/ScrapeArticleContentSection";
import { SemanticScorerSection } from "@/components/automations/SemanticScorerSection";
import { StateAssignerSection } from "@/components/automations/StateAssignerSection";

export default function ManageAutomation() {
  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <h1 className="text-title-xl text-gray-700 dark:text-gray-300">
        Manage Automations
      </h1>

      <GoogleRssSection />
      <ScrapeArticleContentSection />
      <StateAssignerSection />
      <AiApproverSection />
      <SemanticScorerSection />
      <LocationScorerSection />
      <ApprovedArticlesDuplicateAnalysisSection />
      <ArticleRequestSpreadsheetsSection />
    </div>
  );
}
