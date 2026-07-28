ALTER TYPE "VideoStatus" ADD VALUE IF NOT EXISTS 'REVIEW_REQUIRED';

ALTER TABLE "cloned_voices"
  ADD COLUMN "consentVersion" TEXT NOT NULL DEFAULT 'voice-consent-v1',
  ADD COLUMN "consentedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "subjectName" TEXT,
  ADD COLUMN "authorizationBasis" TEXT NOT NULL DEFAULT 'self',
  ADD COLUMN "trainingAllowed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "revokedAt" TIMESTAMP(3),
  ADD COLUMN "providerDeletedAt" TIMESTAMP(3);
CREATE INDEX "cloned_voices_userId_revokedAt_idx" ON "cloned_voices"("userId", "revokedAt");

CREATE TABLE "learning_consents" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "granted" BOOLEAN NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'settings',
  "evidence" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "learning_consents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "learning_consents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "learning_consents_userId_purpose_createdAt_idx" ON "learning_consents"("userId", "purpose", "createdAt");

CREATE TABLE "generation_evaluations" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "videoId" TEXT NOT NULL,
  "candidateGroupId" TEXT,
  "provider" TEXT NOT NULL,
  "model" TEXT,
  "modelVersion" TEXT,
  "promptVersion" TEXT NOT NULL DEFAULT 'v1',
  "storyboardVersion" TEXT NOT NULL DEFAULT 'v1',
  "vertical" TEXT,
  "language" TEXT,
  "platform" TEXT,
  "latencyMs" INTEGER,
  "estimatedCostUsd" DECIMAL(65,30),
  "qualityScore" INTEGER,
  "qualityPassed" BOOLEAN,
  "factualPassed" BOOLEAN,
  "customerRating" INTEGER,
  "customerAccepted" BOOLEAN,
  "selectedCandidate" BOOLEAN NOT NULL DEFAULT false,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "failureReason" TEXT,
  "editSummary" TEXT,
  "metrics" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "generation_evaluations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "generation_evaluations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "generation_evaluations_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "generation_evaluations_videoId_key" ON "generation_evaluations"("videoId");
CREATE INDEX "generation_evaluations_candidateGroupId_idx" ON "generation_evaluations"("candidateGroupId");
CREATE INDEX "generation_evaluations_provider_model_vertical_language_idx" ON "generation_evaluations"("provider", "model", "vertical", "language");
CREATE INDEX "generation_evaluations_userId_createdAt_idx" ON "generation_evaluations"("userId", "createdAt");

CREATE TABLE "provider_observations" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "videoId" TEXT,
  "provider" TEXT NOT NULL,
  "model" TEXT,
  "operation" TEXT NOT NULL,
  "vertical" TEXT,
  "language" TEXT,
  "latencyMs" INTEGER NOT NULL,
  "costUsd" DECIMAL(65,30),
  "qualityScore" INTEGER,
  "succeeded" BOOLEAN NOT NULL,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_observations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_observations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "provider_observations_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "provider_observations_provider_model_operation_createdAt_idx" ON "provider_observations"("provider", "model", "operation", "createdAt");
CREATE INDEX "provider_observations_vertical_language_idx" ON "provider_observations"("vertical", "language");
CREATE INDEX "provider_observations_userId_createdAt_idx" ON "provider_observations"("userId", "createdAt");

CREATE TABLE "localization_profiles" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "defaultLocale" TEXT NOT NULL DEFAULT 'en-US',
  "regionalPreference" TEXT,
  "tone" TEXT NOT NULL DEFAULT 'professional',
  "formality" TEXT NOT NULL DEFAULT 'neutral',
  "glossary" JSONB NOT NULL DEFAULT '{}',
  "pronunciations" JSONB NOT NULL DEFAULT '[]',
  "requireHumanReview" BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "localization_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "localization_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "localization_profiles_userId_key" ON "localization_profiles"("userId");

CREATE TABLE "translation_memory" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sourceLanguage" TEXT NOT NULL,
  "targetLanguage" TEXT NOT NULL,
  "sourceTextHash" TEXT NOT NULL,
  "sourceText" TEXT NOT NULL,
  "approvedText" TEXT NOT NULL,
  "approvedByUserId" TEXT NOT NULL,
  "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "translation_memory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "translation_memory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "translation_memory_userId_sourceLanguage_targetLanguage_sourceTextHash_key"
  ON "translation_memory"("userId", "sourceLanguage", "targetLanguage", "sourceTextHash");
CREATE INDEX "translation_memory_userId_targetLanguage_idx" ON "translation_memory"("userId", "targetLanguage");

CREATE TABLE "optimization_artifacts" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "config" JSONB NOT NULL,
  "baselineId" TEXT,
  "canaryPercent" INTEGER NOT NULL DEFAULT 0,
  "offlineScore" DOUBLE PRECISION,
  "approvedByUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "activatedAt" TIMESTAMP(3),
  "rolledBackAt" TIMESTAMP(3),
  "rollbackReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "optimization_artifacts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "optimization_artifacts_kind_key_version_key" ON "optimization_artifacts"("kind", "key", "version");
CREATE INDEX "optimization_artifacts_kind_key_status_idx" ON "optimization_artifacts"("kind", "key", "status");

CREATE TABLE "optimization_assignments" (
  "id" TEXT NOT NULL,
  "artifactId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "bucket" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "optimization_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "optimization_assignments_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "optimization_artifacts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "optimization_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "optimization_assignments_artifactId_userId_key" ON "optimization_assignments"("artifactId", "userId");
CREATE INDEX "optimization_assignments_userId_idx" ON "optimization_assignments"("userId");
