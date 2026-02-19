-- CreateTable
CREATE TABLE "rent_history" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contract_id" TEXT NOT NULL,
    "effective_from_month" INTEGER NOT NULL,
    "rent_amount" REAL NOT NULL,
    "adjustment_percent" REAL,
    "reason" TEXT,
    "applied_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rent_history_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
