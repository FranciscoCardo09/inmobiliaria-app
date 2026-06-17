-- AlterTable: campos de cuota para servicios en cuotas (numeración por contrato)
ALTER TABLE "monthly_services" ADD COLUMN "cuota_number" INTEGER;
ALTER TABLE "monthly_services" ADD COLUMN "cuota_total" INTEGER;
