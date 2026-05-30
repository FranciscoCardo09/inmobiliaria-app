-- AlterTable
ALTER TABLE "contracts" ADD COLUMN "renewed_at" TIMESTAMP(3);
ALTER TABLE "contracts" ADD COLUMN "renewed_from_contract_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "contracts_renewed_from_contract_id_key" ON "contracts"("renewed_from_contract_id");

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_renewed_from_contract_id_fkey" FOREIGN KEY ("renewed_from_contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
