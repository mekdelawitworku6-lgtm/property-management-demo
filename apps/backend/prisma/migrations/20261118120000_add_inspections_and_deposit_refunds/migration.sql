CREATE TYPE "InspectionType" AS ENUM ('MOVE_IN', 'MOVE_OUT');
CREATE TYPE "InspectionStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');
CREATE TYPE "DepositRefundStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID', 'REJECTED');

CREATE TABLE "inspections" (
    "id" UUID NOT NULL,
    "referenceNo" VARCHAR(40) NOT NULL,
    "agreementId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "type" "InspectionType" NOT NULL,
    "status" "InspectionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "conductedById" UUID,
    "items" JSONB,
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "clientRef" VARCHAR(100),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "inspections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inspections_referenceNo_key" UNIQUE ("referenceNo"),
    CONSTRAINT "inspections_clientRef_key" UNIQUE ("clientRef")
);

CREATE TABLE "deposit_refunds" (
    "id" UUID NOT NULL,
    "referenceNo" VARCHAR(40) NOT NULL,
    "agreementId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "inspectionId" UUID,
    "depositAmount" DECIMAL(12,2) NOT NULL,
    "deductions" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "refundAmount" DECIMAL(12,2) NOT NULL,
    "status" "DepositRefundStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "providerReference" VARCHAR(100),
    "createdById" UUID NOT NULL,
    "approvedById" UUID,
    "paidAt" TIMESTAMP(3),
    "clientRef" VARCHAR(100),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "deposit_refunds_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "deposit_refunds_referenceNo_key" UNIQUE ("referenceNo"),
    CONSTRAINT "deposit_refunds_agreementId_key" UNIQUE ("agreementId"),
    CONSTRAINT "deposit_refunds_clientRef_key" UNIQUE ("clientRef")
);

CREATE INDEX "inspections_ownerId_status_idx" ON "inspections"("ownerId", "status");
CREATE INDEX "inspections_agreementId_type_idx" ON "inspections"("agreementId", "type");
CREATE INDEX "deposit_refunds_ownerId_status_idx" ON "deposit_refunds"("ownerId", "status");
CREATE INDEX "deposit_refunds_tenantId_idx" ON "deposit_refunds"("tenantId");

ALTER TABLE "inspections" ADD CONSTRAINT "inspections_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "agreements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_conductedById_fkey" FOREIGN KEY ("conductedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "deposit_refunds" ADD CONSTRAINT "deposit_refunds_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "agreements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deposit_refunds" ADD CONSTRAINT "deposit_refunds_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deposit_refunds" ADD CONSTRAINT "deposit_refunds_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deposit_refunds" ADD CONSTRAINT "deposit_refunds_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "deposit_refunds" ADD CONSTRAINT "deposit_refunds_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deposit_refunds" ADD CONSTRAINT "deposit_refunds_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
