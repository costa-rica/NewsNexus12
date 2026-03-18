"use client";

import React from "react";

export default function AiApproverPromptsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          AI Approver Prompt Management
        </h1>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Prompt management UI will be implemented in a later phase. This page
          is available now so the AI Approver automation section can route users
          to the intended destination.
        </p>
      </div>
    </div>
  );
}
