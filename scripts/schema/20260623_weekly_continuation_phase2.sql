-- Idempotent Phase 2 schema upgrade for weekly continuation metadata.
-- Inspect and run manually against the intended database. Do not wire this
-- into API or worker startup.

BEGIN;

ALTER TABLE "OrchestratorRuns"
  ADD COLUMN IF NOT EXISTS "sourceOrchestratorRunId" INTEGER,
  ADD COLUMN IF NOT EXISTS "runMode" VARCHAR(32) NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS "continuationPlan" JSONB;

ALTER TABLE "NewsApiRequests"
  ADD COLUMN IF NOT EXISTS "orchestratorRunId" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'OrchestratorRuns_sourceOrchestratorRunId_fkey'
      AND conrelid = '"OrchestratorRuns"'::regclass
  ) THEN
    ALTER TABLE "OrchestratorRuns"
      ADD CONSTRAINT "OrchestratorRuns_sourceOrchestratorRunId_fkey"
      FOREIGN KEY ("sourceOrchestratorRunId")
      REFERENCES "OrchestratorRuns"("id")
      ON UPDATE CASCADE
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'NewsApiRequests_orchestratorRunId_fkey'
      AND conrelid = '"NewsApiRequests"'::regclass
  ) THEN
    ALTER TABLE "NewsApiRequests"
      ADD CONSTRAINT "NewsApiRequests_orchestratorRunId_fkey"
      FOREIGN KEY ("orchestratorRunId")
      REFERENCES "OrchestratorRuns"("id")
      ON UPDATE CASCADE
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "orchestrator_runs_source_run_id_idx"
  ON "OrchestratorRuns" ("sourceOrchestratorRunId");

CREATE INDEX IF NOT EXISTS "news_api_requests_orchestrator_run_id_idx"
  ON "NewsApiRequests" ("orchestratorRunId");

COMMIT;
