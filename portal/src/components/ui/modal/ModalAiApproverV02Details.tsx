"use client";

import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { useAppSelector } from "@/store/hooks";
import type {
  AiApproverPredictionV02,
  AiApproverPromptVersionV02,
} from "@/types/article";

type Props = {
  articleId: number;
  onClose: () => void;
  onPredictionUpdated?: (articleId: number) => void;
};

function promptName(
  prediction: AiApproverPredictionV02,
  prompts: AiApproverPromptVersionV02[],
): string {
  const prompt = prompts.find((row) => row.id === prediction.promptVersionId);
  return prompt?.title?.trim() || `Prompt_id_${prediction.promptVersionId}`;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message || "The request failed.";
  } catch {
    return "The request failed.";
  }
}

export default function ModalAiApproverV02Details({
  articleId,
  onClose,
  onPredictionUpdated,
}: Props) {
  const { token } = useAppSelector((state) => state.user);
  const [prediction, setPrediction] = useState<AiApproverPredictionV02 | null>(
    null,
  );
  const [prompts, setPrompts] = useState<AiApproverPromptVersionV02[]>([]);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [predictionResponse, promptResponse] = await Promise.all([
        fetch(
          `${process.env.NEXT_PUBLIC_API_BASE_URL}/analysis/ai-approver-v02/predictions/article/${articleId}`,
          { headers },
        ),
        fetch(
          `${process.env.NEXT_PUBLIC_API_BASE_URL}/analysis/ai-approver-v02/prompts`,
          { headers },
        ),
      ]);
      if (!predictionResponse.ok) {
        throw new Error(await errorMessage(predictionResponse));
      }
      const predictionBody = (await predictionResponse.json()) as {
        prediction: AiApproverPredictionV02;
      };
      const promptBody = promptResponse.ok
        ? ((await promptResponse.json()) as {
            prompts: AiApproverPromptVersionV02[];
          })
        : { prompts: [] };
      setPrediction(predictionBody.prediction);
      setComment(predictionBody.prediction.humanComment ?? "");
      setPrompts(promptBody.prompts);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Load failed.");
    }
  }, [articleId, token]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- modal opens with an authenticated API load
    void load();
  }, [load]);

  const save = async (updates: {
    humanComment?: string | null;
    humanValidation?: boolean | null;
  }) => {
    if (!prediction) return;
    setIsSaving(true);
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/analysis/ai-approver-v02/predictions/${prediction.id}/review`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(updates),
        },
      );
      if (!response.ok) throw new Error(await errorMessage(response));
      const body = (await response.json()) as {
        prediction: AiApproverPredictionV02;
      };
      setPrediction(body.prediction);
      setComment(body.prediction.humanComment ?? "");
      setError(null);
      onPredictionUpdated?.(articleId);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Save failed.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose}>
      <div className="w-full max-w-2xl rounded-2xl bg-white p-6 dark:bg-gray-900">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-xl font-semibold">AI Approver V02 Details</h2>
          <button type="button" onClick={onClose} className="text-sm">
            Close
          </button>
        </div>
        {error ? <p className="mt-4 text-sm text-error-600">{error}</p> : null}
        {prediction ? (
          <div className="mt-5 space-y-5">
            <dl className="grid gap-3 text-sm md:grid-cols-2">
              <div><dt className="text-gray-500">Prediction</dt><dd>{prediction.resultStatus === "completed" ? prediction.prediction : "N/A"}</dd></div>
              <div><dt className="text-gray-500">Prompt</dt><dd>{promptName(prediction, prompts)}</dd></div>
              <div><dt className="text-gray-500">Model</dt><dd>{prediction.modelName}</dd></div>
              <div><dt className="text-gray-500">Pipeline</dt><dd>{prediction.pipelineVersion}</dd></div>
              <div><dt className="text-gray-500">Attempt</dt><dd>{prediction.attemptCount}</dd></div>
              <div><dt className="text-gray-500">Updated</dt><dd>{new Date(prediction.updatedAt).toLocaleString()}</dd></div>
            </dl>
            <div>
              <h3 className="text-sm font-medium">Reasoning</h3>
              <p className="mt-1 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-800">
                {prediction.reasoning || "No reasoning was produced."}
              </p>
            </div>
            <div>
              <h3 className="text-sm font-medium">
                Was AI Approver V02 correct?
              </h3>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => void save({ humanValidation: true })}
                  className="rounded-lg border px-4 py-2 text-sm"
                >
                  Yes
                </button>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => void save({ humanValidation: false })}
                  className="rounded-lg border px-4 py-2 text-sm"
                >
                  No
                </button>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => void save({ humanValidation: null })}
                  className="rounded-lg border px-4 py-2 text-sm"
                >
                  Clear validation
                </button>
                <span className="self-center text-sm text-gray-500">
                  Current:{" "}
                  {prediction.humanValidation === null
                    ? "Not reviewed"
                    : prediction.humanValidation
                      ? "Yes"
                      : "No"}
                </span>
              </div>
            </div>
            <label className="block text-sm">
              Operator comment
              <textarea
                rows={4}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                className="mt-1 block w-full rounded-lg border p-3 dark:bg-gray-800"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={isSaving}
                onClick={() => void save({ humanComment: comment })}
                className="rounded-lg bg-brand-500 px-4 py-2 text-sm text-white"
              >
                Save comment
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={() => void save({ humanComment: null })}
                className="rounded-lg border px-4 py-2 text-sm"
              >
                Clear comment
              </button>
            </div>
          </div>
        ) : !error ? (
          <p className="mt-4 text-sm text-gray-500">Loading prediction...</p>
        ) : null}
      </div>
    </Modal>
  );
}
