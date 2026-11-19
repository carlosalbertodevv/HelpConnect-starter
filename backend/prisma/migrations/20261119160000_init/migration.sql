CREATE TYPE "RemoteSessionStatus" AS ENUM (
  'PENDING',
  'CONSENTED',
  'CONNECTING',
  'ACTIVE',
  'ENDED',
  'EXPIRED',
  'REJECTED'
);

CREATE TABLE "RemoteSession" (
  "id" UUID NOT NULL,
  "operatorId" TEXT NOT NULL,
  "clientName" TEXT,
  "deviceModel" TEXT,
  "androidVersion" TEXT,
  "status" "RemoteSessionStatus" NOT NULL DEFAULT 'PENDING',
  "accessTokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consentedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RemoteSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RemoteSession_accessTokenHash_key" ON "RemoteSession"("accessTokenHash");
CREATE INDEX "RemoteSession_operatorId_createdAt_idx" ON "RemoteSession"("operatorId", "createdAt");
CREATE INDEX "RemoteSession_status_expiresAt_idx" ON "RemoteSession"("status", "expiresAt");
