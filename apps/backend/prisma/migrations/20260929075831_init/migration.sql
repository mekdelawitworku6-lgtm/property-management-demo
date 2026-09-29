-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'TELECOM', 'OWNER', 'MANAGER', 'TENANT');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('EN', 'AM');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('VERIFY_PHONE', 'RESET_PASSWORD');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('RESIDENTIAL', 'COMMERCIAL', 'MIXED_USE');

-- CreateEnum
CREATE TYPE "UnitType" AS ENUM ('APARTMENT', 'STUDIO', 'VILLA', 'ROOM', 'OFFICE', 'SHOP', 'WAREHOUSE', 'OTHER');

-- CreateEnum
CREATE TYPE "UnitStatus" AS ENUM ('VACANT', 'RESERVED', 'OCCUPIED', 'UNDER_MAINTENANCE');

-- CreateEnum
CREATE TYPE "RentalRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AgreementStatus" AS ENUM ('PENDING_SIGNATURE', 'ACTIVE', 'EXPIRED', 'TERMINATED', 'RENEWED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('RENT', 'DEPOSIT', 'PENALTY', 'OTHER');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('TELEBIRR', 'BANK_TRANSFER', 'CASH');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ConfirmationSource" AS ENUM ('TELEBIRR_WEBHOOK', 'ETHIO_TELECOM', 'OWNER', 'ADMIN');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PAID');

-- CreateEnum
CREATE TYPE "ComplaintCategory" AS ENUM ('MAINTENANCE', 'NOISE', 'SAFETY', 'PAYMENT', 'DISPUTE', 'OTHER');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "ComplaintStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "EscalationStatus" AS ENUM ('NONE', 'ESCALATED', 'ADMIN_RESOLVED');

-- CreateEnum
CREATE TYPE "VendorServiceType" AS ENUM ('PLUMBING', 'ELECTRICAL', 'CARPENTRY', 'PAINTING', 'CLEANING', 'SECURITY', 'GENERAL', 'OTHER');

-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('MAINTENANCE', 'UTILITIES', 'TAX', 'INSURANCE', 'MANAGEMENT', 'OTHER');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "role" "UserRole" NOT NULL,
    "fullName" VARCHAR(150) NOT NULL,
    "phoneNumber" VARCHAR(20) NOT NULL,
    "email" VARCHAR(150),
    "passwordHash" TEXT NOT NULL,
    "language" "Language" NOT NULL DEFAULT 'EN',
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "isSuspended" BOOLEAN NOT NULL DEFAULT false,
    "suspendedReason" TEXT,
    "suspendedAt" TIMESTAMP(3),
    "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
    "telegramChatId" VARCHAR(64),
    "refreshTokenHash" TEXT,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "lastLoginAt" TIMESTAMP(3),
    "employerId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owner_profiles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "companyName" VARCHAR(150),
    "tinNumber" VARCHAR(30),
    "address" TEXT,
    "payoutMethod" "PaymentMethod",
    "bankName" VARCHAR(100),
    "bankAccount" VARCHAR(50),
    "telebirrNumber" VARCHAR(20),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "owner_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_profiles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "idType" VARCHAR(40),
    "idNumberEncrypted" TEXT,
    "faydaId" VARCHAR(40),
    "kycStatus" "KycStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "dateOfBirth" TIMESTAMP(3),
    "occupation" VARCHAR(100),
    "emergencyContactName" VARCHAR(150),
    "emergencyContactPhone" VARCHAR(20),
    "emergencyContactRelation" VARCHAR(50),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_codes" (
    "id" UUID NOT NULL,
    "phoneNumber" VARCHAR(20) NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "properties" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "type" "PropertyType" NOT NULL,
    "description" TEXT,
    "city" VARCHAR(80) NOT NULL,
    "subCity" VARCHAR(80),
    "woreda" VARCHAR(40),
    "address" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "totalArea" DECIMAL(12,2),
    "ownershipType" VARCHAR(60),
    "titleDeedNo" VARCHAR(60),
    "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "unitNumber" VARCHAR(30) NOT NULL,
    "floor" INTEGER,
    "type" "UnitType" NOT NULL,
    "bedrooms" INTEGER,
    "bathrooms" INTEGER,
    "sizeSqm" DECIMAL(10,2),
    "rentAmount" DECIMAL(12,2) NOT NULL,
    "depositAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'ETB',
    "status" "UnitStatus" NOT NULL DEFAULT 'VACANT',
    "isListed" BOOLEAN NOT NULL DEFAULT true,
    "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "terms" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_requests" (
    "id" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "message" TEXT,
    "desiredStartDate" TIMESTAMP(3) NOT NULL,
    "durationMonths" INTEGER NOT NULL,
    "status" "RentalRequestStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rental_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agreements" (
    "id" UUID NOT NULL,
    "referenceNo" VARCHAR(40) NOT NULL,
    "unitId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "rentalRequestId" UUID,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "rentAmount" DECIMAL(12,2) NOT NULL,
    "depositAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'ETB',
    "paymentDueDay" INTEGER NOT NULL DEFAULT 1,
    "specialTerms" TEXT,
    "content" TEXT NOT NULL,
    "contentHash" VARCHAR(64) NOT NULL,
    "status" "AgreementStatus" NOT NULL DEFAULT 'PENDING_SIGNATURE',
    "ownerSignedAt" TIMESTAMP(3),
    "ownerSignature" VARCHAR(150),
    "tenantSignedAt" TIMESTAMP(3),
    "tenantSignature" VARCHAR(150),
    "tenantSignatureIp" VARCHAR(64),
    "signatureHash" VARCHAR(64),
    "documents" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "renewedFromId" UUID,
    "terminatedAt" TIMESTAMP(3),
    "terminationReason" TEXT,
    "expiryReminderSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "invoiceNo" VARCHAR(40) NOT NULL,
    "agreementId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "type" "InvoiceType" NOT NULL DEFAULT 'RENT',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'ETB',
    "status" "InvoiceStatus" NOT NULL DEFAULT 'UNPAID',
    "description" TEXT,
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "lastReminderAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "referenceNo" VARCHAR(40) NOT NULL,
    "invoiceId" UUID,
    "agreementId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'ETB',
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "providerReference" VARCHAR(100),
    "bankName" VARCHAR(100),
    "receiptUrl" TEXT,
    "checkoutUrl" TEXT,
    "notes" TEXT,
    "clientRef" VARCHAR(100),
    "recordedById" UUID,
    "confirmedById" UUID,
    "confirmationSource" "ConfirmationSource",
    "confirmedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "payoutId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" UUID NOT NULL,
    "referenceNo" VARCHAR(40) NOT NULL,
    "ownerId" UUID NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "grossCollected" DECIMAL(12,2) NOT NULL,
    "platformFee" DECIMAL(12,2) NOT NULL,
    "netAmount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'ETB',
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "method" "PaymentMethod",
    "paidReference" VARCHAR(100),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "unitId" UUID,
    "workOrderId" UUID,
    "category" "ExpenseCategory" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "description" TEXT,
    "incurredOn" TIMESTAMP(3) NOT NULL,
    "recordedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaints" (
    "id" UUID NOT NULL,
    "referenceNo" VARCHAR(40) NOT NULL,
    "tenantId" UUID,
    "ownerId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "unitId" UUID,
    "agreementId" UUID,
    "raisedById" UUID NOT NULL,
    "category" "ComplaintCategory" NOT NULL,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ComplaintStatus" NOT NULL DEFAULT 'OPEN',
    "escalationStatus" "EscalationStatus" NOT NULL DEFAULT 'NONE',
    "escalatedAt" TIMESTAMP(3),
    "escalatedById" UUID,
    "escalationReason" TEXT,
    "adminResolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "clientRef" VARCHAR(100),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "complaints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaint_responses" (
    "id" UUID NOT NULL,
    "complaintId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "message" TEXT NOT NULL,
    "attachments" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "complaint_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "serviceType" "VendorServiceType" NOT NULL,
    "phoneNumber" VARCHAR(20) NOT NULL,
    "email" VARCHAR(150),
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_orders" (
    "id" UUID NOT NULL,
    "referenceNo" VARCHAR(40) NOT NULL,
    "ownerId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "unitId" UUID,
    "complaintId" UUID,
    "vendorId" UUID,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'OPEN',
    "estimatedCost" DECIMAL(12,2),
    "actualCost" DECIMAL(12,2),
    "scheduledDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completionNotes" TEXT,
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" UUID NOT NULL,
    "clientRef" VARCHAR(100),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" VARCHAR(60) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "actorRole" VARCHAR(20),
    "action" VARCHAR(80) NOT NULL,
    "entityType" VARCHAR(60) NOT NULL,
    "entityId" VARCHAR(64),
    "metadata" JSONB,
    "ipAddress" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phoneNumber_key" ON "users"("phoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_employerId_idx" ON "users"("employerId");

-- CreateIndex
CREATE UNIQUE INDEX "owner_profiles_userId_key" ON "owner_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_profiles_userId_key" ON "tenant_profiles"("userId");

-- CreateIndex
CREATE INDEX "otp_codes_phoneNumber_purpose_idx" ON "otp_codes"("phoneNumber", "purpose");

-- CreateIndex
CREATE INDEX "properties_ownerId_idx" ON "properties"("ownerId");

-- CreateIndex
CREATE INDEX "properties_city_idx" ON "properties"("city");

-- CreateIndex
CREATE INDEX "units_status_isListed_idx" ON "units"("status", "isListed");

-- CreateIndex
CREATE UNIQUE INDEX "units_propertyId_unitNumber_key" ON "units"("propertyId", "unitNumber");

-- CreateIndex
CREATE INDEX "rental_requests_unitId_status_idx" ON "rental_requests"("unitId", "status");

-- CreateIndex
CREATE INDEX "rental_requests_tenantId_idx" ON "rental_requests"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "agreements_referenceNo_key" ON "agreements"("referenceNo");

-- CreateIndex
CREATE UNIQUE INDEX "agreements_rentalRequestId_key" ON "agreements"("rentalRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "agreements_renewedFromId_key" ON "agreements"("renewedFromId");

-- CreateIndex
CREATE INDEX "agreements_ownerId_status_idx" ON "agreements"("ownerId", "status");

-- CreateIndex
CREATE INDEX "agreements_tenantId_status_idx" ON "agreements"("tenantId", "status");

-- CreateIndex
CREATE INDEX "agreements_unitId_status_idx" ON "agreements"("unitId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoiceNo_key" ON "invoices"("invoiceNo");

-- CreateIndex
CREATE INDEX "invoices_tenantId_status_idx" ON "invoices"("tenantId", "status");

-- CreateIndex
CREATE INDEX "invoices_ownerId_status_idx" ON "invoices"("ownerId", "status");

-- CreateIndex
CREATE INDEX "invoices_dueDate_status_idx" ON "invoices"("dueDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_agreementId_type_periodStart_key" ON "invoices"("agreementId", "type", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "payments_referenceNo_key" ON "payments"("referenceNo");

-- CreateIndex
CREATE UNIQUE INDEX "payments_clientRef_key" ON "payments"("clientRef");

-- CreateIndex
CREATE INDEX "payments_tenantId_status_idx" ON "payments"("tenantId", "status");

-- CreateIndex
CREATE INDEX "payments_ownerId_status_idx" ON "payments"("ownerId", "status");

-- CreateIndex
CREATE INDEX "payments_propertyId_idx" ON "payments"("propertyId");

-- CreateIndex
CREATE INDEX "payments_providerReference_idx" ON "payments"("providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_referenceNo_key" ON "payouts"("referenceNo");

-- CreateIndex
CREATE INDEX "payouts_ownerId_status_idx" ON "payouts"("ownerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_workOrderId_key" ON "expenses"("workOrderId");

-- CreateIndex
CREATE INDEX "expenses_ownerId_incurredOn_idx" ON "expenses"("ownerId", "incurredOn");

-- CreateIndex
CREATE INDEX "expenses_propertyId_idx" ON "expenses"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "complaints_referenceNo_key" ON "complaints"("referenceNo");

-- CreateIndex
CREATE UNIQUE INDEX "complaints_clientRef_key" ON "complaints"("clientRef");

-- CreateIndex
CREATE INDEX "complaints_ownerId_status_idx" ON "complaints"("ownerId", "status");

-- CreateIndex
CREATE INDEX "complaints_tenantId_idx" ON "complaints"("tenantId");

-- CreateIndex
CREATE INDEX "complaints_escalationStatus_idx" ON "complaints"("escalationStatus");

-- CreateIndex
CREATE INDEX "complaint_responses_complaintId_idx" ON "complaint_responses"("complaintId");

-- CreateIndex
CREATE INDEX "vendors_ownerId_idx" ON "vendors"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_referenceNo_key" ON "work_orders"("referenceNo");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_clientRef_key" ON "work_orders"("clientRef");

-- CreateIndex
CREATE INDEX "work_orders_ownerId_status_idx" ON "work_orders"("ownerId", "status");

-- CreateIndex
CREATE INDEX "work_orders_vendorId_idx" ON "work_orders"("vendorId");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_idx" ON "audit_logs"("actorId");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_profiles" ADD CONSTRAINT "owner_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_profiles" ADD CONSTRAINT "tenant_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_requests" ADD CONSTRAINT "rental_requests_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_requests" ADD CONSTRAINT "rental_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_rentalRequestId_fkey" FOREIGN KEY ("rentalRequestId") REFERENCES "rental_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_renewedFromId_fkey" FOREIGN KEY ("renewedFromId") REFERENCES "agreements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "agreements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint_responses" ADD CONSTRAINT "complaint_responses_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "complaints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint_responses" ADD CONSTRAINT "complaint_responses_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "complaints"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
