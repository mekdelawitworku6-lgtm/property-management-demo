-- CreateEnum
CREATE TYPE "LateFeeType" AS ENUM ('PERCENT', 'FLAT');
-- CreateEnum
CREATE TYPE "LateFeeFrequency" AS ENUM ('ONCE', 'PER_WEEK', 'PER_MONTH');
-- AlterTable
ALTER TABLE "agreements" ADD COLUMN     "renewalReminder30SentAt" TIMESTAMP(3),
ADD COLUMN     "renewalReminder60SentAt" TIMESTAMP(3);
-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "penaltyCycle" INTEGER,
ADD COLUMN     "penaltyForInvoiceId" UUID,
ADD COLUMN     "penaltyRuleId" UUID;
-- CreateTable
CREATE TABLE "late_fee_rules" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "agreementId" UUID,
    "label" VARCHAR(120) NOT NULL,
    "type" "LateFeeType" NOT NULL DEFAULT 'PERCENT',
    "value" DECIMAL(12,2) NOT NULL,
    "gracePeriodDays" INTEGER NOT NULL DEFAULT 5,
    "frequency" "LateFeeFrequency" NOT NULL DEFAULT 'ONCE',
    "maxPercentOfBalance" DECIMAL(6,2),
    "appliesTo" "InvoiceType"[] DEFAULT ARRAY['RENT']::"InvoiceType"[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "late_fee_rules_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "late_fee_rules_ownerId_isActive_idx" ON "late_fee_rules"("ownerId", "isActive");
-- CreateIndex
CREATE INDEX "late_fee_rules_agreementId_idx" ON "late_fee_rules"("agreementId");
-- CreateIndex
CREATE UNIQUE INDEX "invoices_penaltyForInvoiceId_penaltyCycle_key" ON "invoices"("penaltyForInvoiceId", "penaltyCycle");
-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_penaltyForInvoiceId_fkey" FOREIGN KEY ("penaltyForInvoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "late_fee_rules" ADD CONSTRAINT "late_fee_rules_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "late_fee_rules" ADD CONSTRAINT "late_fee_rules_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "agreements"("id") ON DELETE CASCADE ON UPDATE CASCADE;