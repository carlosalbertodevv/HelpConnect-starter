ALTER TABLE "Device"
  ADD COLUMN "publicKey" TEXT,
  ADD COLUMN "pairingCodeHash" TEXT,
  ADD COLUMN "pairingExpiresAt" TIMESTAMP(3),
  ADD COLUMN "pairedAt" TIMESTAMP(3),
  ADD COLUMN "revokedAt" TIMESTAMP(3),
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

DROP INDEX IF EXISTS "Device_clientId_createdAt_idx";
CREATE INDEX "Device_clientId_isActive_createdAt_idx"
  ON "Device"("clientId", "isActive", "createdAt");
CREATE UNIQUE INDEX "Device_publicKey_key" ON "Device"("publicKey");
CREATE UNIQUE INDEX "Device_pairingCodeHash_key" ON "Device"("pairingCodeHash");

ALTER TABLE "RemoteSession"
  ALTER COLUMN "accessTokenHash" DROP NOT NULL;

CREATE UNIQUE INDEX "RemoteSession_one_active_per_client_key"
  ON "RemoteSession"("clientId")
  WHERE "clientId" IS NOT NULL
    AND "status" IN ('CONSENTED', 'CONNECTING', 'ACTIVE');
