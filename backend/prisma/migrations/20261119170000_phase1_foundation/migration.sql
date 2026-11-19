CREATE TYPE "SessionPermissionType" AS ENUM (
  'SUPPORT_SESSION',
  'SCREEN_SHARING'
);

CREATE TABLE "User" (
  "id" UUID NOT NULL,
  "email" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

INSERT INTO "User" ("id")
SELECT DISTINCT "operatorId"::uuid
FROM "RemoteSession"
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "RemoteSession"
  ALTER COLUMN "operatorId" TYPE UUID USING "operatorId"::uuid;

CREATE TABLE "Client" (
  "id" UUID NOT NULL,
  "operatorId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Device" (
  "id" UUID NOT NULL,
  "clientId" UUID,
  "model" TEXT,
  "androidVersion" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "RemoteSession"
  ADD COLUMN "clientId" UUID,
  ADD COLUMN "deviceId" UUID,
  ADD COLUMN "publicCode" TEXT;

UPDATE "RemoteSession"
SET "publicCode" = 'HC-' || upper(replace("id"::text, '-', ''));

ALTER TABLE "RemoteSession"
  ALTER COLUMN "publicCode" SET NOT NULL;

CREATE TABLE "SessionPermission" (
  "id" UUID NOT NULL,
  "sessionId" UUID NOT NULL,
  "permission" "SessionPermissionType" NOT NULL,
  "granted" BOOLEAN NOT NULL,
  "grantedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SessionPermission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SessionLog" (
  "id" UUID NOT NULL,
  "sessionId" UUID NOT NULL,
  "event" TEXT NOT NULL,
  "actorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SessionLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RemoteSession_publicCode_key" ON "RemoteSession"("publicCode");
CREATE INDEX "Client_operatorId_isActive_name_idx" ON "Client"("operatorId", "isActive", "name");
CREATE INDEX "Device_clientId_createdAt_idx" ON "Device"("clientId", "createdAt");
CREATE INDEX "RemoteSession_clientId_createdAt_idx" ON "RemoteSession"("clientId", "createdAt");
CREATE INDEX "SessionPermission_sessionId_createdAt_idx" ON "SessionPermission"("sessionId", "createdAt");
CREATE INDEX "SessionLog_sessionId_createdAt_idx" ON "SessionLog"("sessionId", "createdAt");

ALTER TABLE "Client"
  ADD CONSTRAINT "Client_operatorId_fkey"
  FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Device"
  ADD CONSTRAINT "Device_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RemoteSession"
  ADD CONSTRAINT "RemoteSession_operatorId_fkey"
  FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "RemoteSession_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "RemoteSession_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SessionPermission"
  ADD CONSTRAINT "SessionPermission_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "RemoteSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SessionLog"
  ADD CONSTRAINT "SessionLog_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "RemoteSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
