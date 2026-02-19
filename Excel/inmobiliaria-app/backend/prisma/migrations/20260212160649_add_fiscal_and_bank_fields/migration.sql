-- AlterTable
ALTER TABLE "groups" ADD COLUMN "bank_account_number" TEXT;
ALTER TABLE "groups" ADD COLUMN "bank_account_type" TEXT;
ALTER TABLE "groups" ADD COLUMN "bank_cbu" TEXT;
ALTER TABLE "groups" ADD COLUMN "bank_cuit" TEXT;
ALTER TABLE "groups" ADD COLUMN "bank_holder" TEXT;
ALTER TABLE "groups" ADD COLUMN "bank_name" TEXT;
ALTER TABLE "groups" ADD COLUMN "fecha_inicio_act" TEXT;
ALTER TABLE "groups" ADD COLUMN "ing_brutos" TEXT;
ALTER TABLE "groups" ADD COLUMN "iva_condicion" TEXT;
ALTER TABLE "groups" ADD COLUMN "subtitulo" TEXT;

-- AlterTable
ALTER TABLE "owners" ADD COLUMN "bank_account_number" TEXT;
ALTER TABLE "owners" ADD COLUMN "bank_account_type" TEXT;
ALTER TABLE "owners" ADD COLUMN "bank_cbu" TEXT;
ALTER TABLE "owners" ADD COLUMN "bank_cuit" TEXT;
ALTER TABLE "owners" ADD COLUMN "bank_holder" TEXT;
ALTER TABLE "owners" ADD COLUMN "bank_name" TEXT;
