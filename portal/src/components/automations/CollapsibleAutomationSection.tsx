"use client";

import React, { useState } from "react";
import { ChevronDownIcon } from "@/icons";

type CollapsibleAutomationSectionProps = {
  children: React.ReactNode;
  defaultOpen?: boolean;
  title: string;
};

export function CollapsibleAutomationSection({
  children,
  defaultOpen = true,
  title,
}: CollapsibleAutomationSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <section className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-4 p-6 text-left"
      >
        <h2 className="text-title-lg font-semibold text-gray-800 dark:text-white/90">
          {title}
        </h2>
        <ChevronDownIcon
          className={`h-5 w-5 shrink-0 text-gray-500 transition-transform dark:text-gray-400 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen ? <div className="px-6 pb-6">{children}</div> : null}
    </section>
  );
}
