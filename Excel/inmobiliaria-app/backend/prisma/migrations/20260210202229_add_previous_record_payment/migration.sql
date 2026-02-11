-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_debts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "group_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "monthly_record_id" TEXT NOT NULL,
    "period_label" TEXT NOT NULL,
    "period_month" INTEGER NOT NULL,
    "period_year" INTEGER NOT NULL,
    "original_amount" REAL NOT NULL,
    "unpaid_rent_amount" REAL NOT NULL,
    "previous_record_payment" REAL NOT NULL DEFAULT 0,
    "accumulated_punitory" REAL NOT NULL DEFAULT 0,
    "current_total" REAL NOT NULL,
    "amount_paid" REAL NOT NULL DEFAULT 0,
    "punitory_percent" REAL NOT NULL,
    "punitory_start_date" DATETIME NOT NULL,
    "last_payment_date" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "debts_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "debts_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "debts_monthly_record_id_fkey" FOREIGN KEY ("monthly_record_id") REFERENCES "monthly_records" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_debts" ("accumulated_punitory", "amount_paid", "closed_at", "contract_id", "created_at", "current_total", "group_id", "id", "last_payment_date", "monthly_record_id", "original_amount", "period_label", "period_month", "period_year", "punitory_percent", "punitory_start_date", "status", "unpaid_rent_amount", "updated_at") SELECT "accumulated_punitory", "amount_paid", "closed_at", "contract_id", "created_at", "current_total", "group_id", "id", "last_payment_date", "monthly_record_id", "original_amount", "period_label", "period_month", "period_year", "punitory_percent", "punitory_start_date", "status", "unpaid_rent_amount", "updated_at" FROM "debts";
DROP TABLE "debts";
ALTER TABLE "new_debts" RENAME TO "debts";
CREATE UNIQUE INDEX "debts_monthly_record_id_key" ON "debts"("monthly_record_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
