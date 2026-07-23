import express from "express";
import type { Request, Response } from "express";
import { Op } from "sequelize";

import { authenticateToken } from "../../modules/userAuthentication";
import logger from "../../modules/logger";

const {
  AiApproverArticlePredictionV02,
  AiApproverPromptVersionV02,
  sequelize,
} = require("@newsnexus/db-models");

const router = express.Router();

function parsePositiveId(value: string | string[]): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeTitle(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "SequelizeUniqueConstraintError" ||
      error.name === "UniqueConstraintError")
  );
}

function internalError(
  res: Response,
  message: string,
  error: unknown,
): Response {
  logger.error(message, error);
  return res.status(500).json({ result: false, message });
}

router.get("/prompts", authenticateToken, async (_req: Request, res: Response) => {
  try {
    const prompts = await AiApproverPromptVersionV02.findAll({
      order: [
        ["isActive", "DESC"],
        ["id", "DESC"],
      ],
    });
    return res.status(200).json({
      result: true,
      count: prompts.length,
      prompts,
    });
  } catch (error: unknown) {
    return internalError(res, "Failed to fetch V02 prompts", error);
  }
});

router.post("/prompts", authenticateToken, async (req: Request, res: Response) => {
  const promptInMarkdown =
    typeof req.body?.promptInMarkdown === "string"
      ? req.body.promptInMarkdown.trim()
      : "";
  if (!promptInMarkdown) {
    return res.status(400).json({
      result: false,
      message: "promptInMarkdown is required",
    });
  }

  try {
    const prompt = await AiApproverPromptVersionV02.create({
      title: normalizeTitle(req.body?.title),
      promptInMarkdown,
      isActive: false,
    });
    return res.status(201).json({ result: true, prompt });
  } catch (error: unknown) {
    if (isUniqueConstraintError(error)) {
      return res.status(409).json({
        result: false,
        message: "A V02 prompt with that title already exists",
      });
    }
    return internalError(res, "Failed to create V02 prompt", error);
  }
});

router.patch(
  "/prompts/:promptId",
  authenticateToken,
  async (req: Request, res: Response) => {
    const promptId = parsePositiveId(req.params.promptId);
    if (promptId === null) {
      return res.status(400).json({ result: false, message: "Invalid promptId" });
    }
    const promptInMarkdown =
      typeof req.body?.promptInMarkdown === "string"
        ? req.body.promptInMarkdown.trim()
        : "";
    if (!promptInMarkdown) {
      return res.status(400).json({
        result: false,
        message: "promptInMarkdown is required",
      });
    }

    try {
      const prompt = await AiApproverPromptVersionV02.findByPk(promptId);
      if (!prompt) {
        return res.status(404).json({
          result: false,
          message: "V02 prompt not found",
        });
      }
      if (prompt.firstUsedAt) {
        return res.status(409).json({
          result: false,
          message: "A used V02 prompt cannot be edited",
        });
      }
      await prompt.update({
        title: normalizeTitle(req.body?.title),
        promptInMarkdown,
      });
      return res.status(200).json({ result: true, prompt });
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        return res.status(409).json({
          result: false,
          message: "A V02 prompt with that title already exists",
        });
      }
      return internalError(res, "Failed to edit V02 prompt", error);
    }
  },
);

router.post(
  "/prompts/:promptId/activate",
  authenticateToken,
  async (req: Request, res: Response) => {
    const promptId = parsePositiveId(req.params.promptId);
    if (promptId === null) {
      return res.status(400).json({ result: false, message: "Invalid promptId" });
    }

    try {
      const prompt = await sequelize.transaction(async (transaction: any) => {
        const target = await AiApproverPromptVersionV02.findByPk(promptId, {
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        if (!target) {
          return null;
        }
        await AiApproverPromptVersionV02.update(
          { isActive: false },
          { where: { isActive: true }, transaction },
        );
        await target.update({ isActive: true }, { transaction });
        return target;
      });
      if (!prompt) {
        return res.status(404).json({
          result: false,
          message: "V02 prompt not found",
        });
      }
      return res.status(200).json({ result: true, prompt });
    } catch (error: unknown) {
      return internalError(res, "Failed to activate V02 prompt", error);
    }
  },
);

router.post(
  "/prompts/:promptId/deactivate",
  authenticateToken,
  async (req: Request, res: Response) => {
    const promptId = parsePositiveId(req.params.promptId);
    if (promptId === null) {
      return res.status(400).json({ result: false, message: "Invalid promptId" });
    }
    try {
      const prompt = await AiApproverPromptVersionV02.findByPk(promptId);
      if (!prompt) {
        return res.status(404).json({
          result: false,
          message: "V02 prompt not found",
        });
      }
      await prompt.update({ isActive: false });
      return res.status(200).json({ result: true, prompt });
    } catch (error: unknown) {
      return internalError(res, "Failed to deactivate V02 prompt", error);
    }
  },
);

router.post(
  "/predictions/batch",
  authenticateToken,
  async (req: Request, res: Response) => {
    const articleIds = req.body?.articleIds;
    if (
      !Array.isArray(articleIds) ||
      !articleIds.every(
        (value) => Number.isSafeInteger(value) && Number(value) > 0,
      )
    ) {
      return res.status(400).json({
        result: false,
        message: "articleIds must be an array of positive integers",
      });
    }
    const uniqueArticleIds = [...new Set(articleIds as number[])];
    try {
      const predictions = await AiApproverArticlePredictionV02.findAll({
        where: { articleId: { [Op.in]: uniqueArticleIds } },
        order: [["articleId", "DESC"]],
      });
      return res.status(200).json({
        result: true,
        count: predictions.length,
        predictions,
      });
    } catch (error: unknown) {
      return internalError(res, "Failed to fetch V02 predictions", error);
    }
  },
);

router.get(
  "/predictions/article/:articleId",
  authenticateToken,
  async (req: Request, res: Response) => {
    const articleId = parsePositiveId(req.params.articleId);
    if (articleId === null) {
      return res.status(400).json({ result: false, message: "Invalid articleId" });
    }
    try {
      const prediction = await AiApproverArticlePredictionV02.findOne({
        where: { articleId },
      });
      if (!prediction) {
        return res.status(404).json({
          result: false,
          message: "V02 prediction not found",
        });
      }
      return res.status(200).json({ result: true, prediction });
    } catch (error: unknown) {
      return internalError(res, "Failed to fetch V02 prediction", error);
    }
  },
);

router.patch(
  "/predictions/:predictionId/review",
  authenticateToken,
  async (req: Request, res: Response) => {
    const predictionId = parsePositiveId(req.params.predictionId);
    if (predictionId === null) {
      return res.status(400).json({
        result: false,
        message: "Invalid predictionId",
      });
    }
    const hasValidation = Object.prototype.hasOwnProperty.call(
      req.body ?? {},
      "humanValidation",
    );
    const hasComment = Object.prototype.hasOwnProperty.call(
      req.body ?? {},
      "humanComment",
    );
    if (!hasValidation && !hasComment) {
      return res.status(400).json({
        result: false,
        message: "Provide humanValidation or humanComment",
      });
    }
    const humanValidation = req.body?.humanValidation;
    if (
      hasValidation &&
      humanValidation !== null &&
      typeof humanValidation !== "boolean"
    ) {
      return res.status(400).json({
        result: false,
        message: "humanValidation must be true, false, or null",
      });
    }
    const humanComment = req.body?.humanComment;
    if (
      hasComment &&
      humanComment !== null &&
      typeof humanComment !== "string"
    ) {
      return res.status(400).json({
        result: false,
        message: "humanComment must be a string or null",
      });
    }

    try {
      const prediction = await AiApproverArticlePredictionV02.findByPk(
        predictionId,
      );
      if (!prediction) {
        return res.status(404).json({
          result: false,
          message: "V02 prediction not found",
        });
      }
      const updates: {
        humanValidation?: boolean | null;
        humanComment?: string | null;
      } = {};
      if (hasValidation) {
        updates.humanValidation = humanValidation;
      }
      if (hasComment) {
        updates.humanComment =
          humanComment === null || humanComment.trim() === ""
            ? null
            : humanComment.trim();
      }
      await prediction.update(updates);
      return res.status(200).json({ result: true, prediction });
    } catch (error: unknown) {
      return internalError(res, "Failed to update V02 prediction review", error);
    }
  },
);

export = router;
