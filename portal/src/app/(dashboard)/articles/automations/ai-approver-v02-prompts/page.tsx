"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAppSelector } from "@/store/hooks";
import type { AiApproverPromptVersionV02 } from "@/types/article";

function displayName(prompt: AiApproverPromptVersionV02): string {
  return prompt.title?.trim() || `Prompt_id_${prompt.id}`;
}

async function responseMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message || "The request failed.";
  } catch {
    return "The request failed.";
  }
}

export default function AiApproverV02PromptsPage() {
  const { token } = useAppSelector((state) => state.user);
  const [prompts, setPrompts] = useState<AiApproverPromptVersionV02[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [promptText, setPromptText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const selected = prompts.find((prompt) => prompt.id === selectedId) ?? null;

  const loadPrompts = useCallback(async () => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/analysis/ai-approver-v02/prompts`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!response.ok) throw new Error(await responseMessage(response));
      const body = (await response.json()) as {
        prompts: AiApproverPromptVersionV02[];
      };
      setPrompts(body.prompts);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Load failed.");
    }
  }, [token]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial authenticated API load
    void loadPrompts();
  }, [loadPrompts]);

  const clearForm = () => {
    setSelectedId(null);
    setTitle("");
    setPromptText("");
    setError(null);
  };

  const selectPrompt = (prompt: AiApproverPromptVersionV02) => {
    setSelectedId(prompt.id);
    setTitle(prompt.title ?? "");
    setPromptText(prompt.promptInMarkdown);
    setError(null);
  };

  const savePrompt = async () => {
    if (!promptText.trim()) {
      setError("Prompt text is required.");
      return;
    }
    setIsSaving(true);
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/analysis/ai-approver-v02/prompts${selected ? `/${selected.id}` : ""}`,
        {
          method: selected ? "PATCH" : "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title,
            promptInMarkdown: promptText,
          }),
        },
      );
      if (!response.ok) throw new Error(await responseMessage(response));
      clearForm();
      await loadPrompts();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Save failed.");
    } finally {
      setIsSaving(false);
    }
  };

  const setActive = async (
    prompt: AiApproverPromptVersionV02,
    activate: boolean,
  ) => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/analysis/ai-approver-v02/prompts/${prompt.id}/${activate ? "activate" : "deactivate"}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!response.ok) throw new Error(await responseMessage(response));
      await loadPrompts();
    } catch (activationError) {
      setError(
        activationError instanceof Error
          ? activationError.message
          : "Activation failed.",
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-title-xl text-gray-700 dark:text-gray-300">
            AI Approver V02 Prompts
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            The worker injects article title, article content, and the response
            schema. Store only the operator&apos;s evaluation instructions here.
          </p>
        </div>
        <Link
          href="/articles/automations"
          className="rounded-lg border px-4 py-2 text-sm dark:border-gray-700"
        >
          Back to automations
        </Link>
      </div>

      {error ? (
        <div className="rounded-lg bg-error-50 p-3 text-sm text-error-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
        <section className="rounded-2xl border bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">Prompt versions</h2>
            <button
              type="button"
              onClick={clearForm}
              className="rounded-lg bg-brand-500 px-3 py-2 text-sm text-white"
            >
              New prompt
            </button>
          </div>
          <div className="space-y-3">
            {prompts.map((prompt) => (
              <div
                key={prompt.id}
                className="rounded-lg border p-3 dark:border-gray-700"
              >
                <button
                  type="button"
                  onClick={() => selectPrompt(prompt)}
                  className="w-full text-left"
                >
                  <span className="font-medium">{displayName(prompt)}</span>
                  <span className="mt-1 block text-xs text-gray-500">
                    {prompt.isActive ? "Active" : "Inactive"} ·{" "}
                    {prompt.firstUsedAt ? "Used and locked" : "Unused"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void setActive(prompt, !prompt.isActive)}
                  className="mt-3 rounded border px-3 py-1 text-xs dark:border-gray-600"
                >
                  {prompt.isActive ? "Deactivate" : "Activate"}
                </button>
              </div>
            ))}
            {prompts.length === 0 ? (
              <p className="text-sm text-gray-500">No V02 prompts yet.</p>
            ) : null}
          </div>
        </section>

        <section className="rounded-2xl border bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
          <h2 className="font-semibold">
            {selected ? `Edit ${displayName(selected)}` : "Create prompt"}
          </h2>
          {selected?.firstUsedAt ? (
            <p className="mt-2 text-sm text-warning-600">
              This prompt has been used and cannot be edited. It may still be
              activated unchanged.
            </p>
          ) : null}
          <label className="mt-4 block text-sm">
            Optional title
            <input
              value={title}
              disabled={Boolean(selected?.firstUsedAt)}
              onChange={(event) => setTitle(event.target.value)}
              className="mt-1 block w-full rounded-lg border p-2 dark:bg-gray-800"
            />
          </label>
          <label className="mt-4 block text-sm">
            Markdown operator prompt
            <textarea
              value={promptText}
              disabled={Boolean(selected?.firstUsedAt)}
              onChange={(event) => setPromptText(event.target.value)}
              rows={16}
              className="mt-1 block w-full rounded-lg border p-3 font-mono text-sm dark:bg-gray-800"
            />
          </label>
          <button
            type="button"
            disabled={isSaving || Boolean(selected?.firstUsedAt)}
            onClick={() => void savePrompt()}
            className="mt-4 rounded-lg bg-brand-500 px-5 py-2 text-sm text-white disabled:opacity-50"
          >
            {isSaving ? "Saving..." : selected ? "Save changes" : "Create prompt"}
          </button>
        </section>
      </div>
    </div>
  );
}
