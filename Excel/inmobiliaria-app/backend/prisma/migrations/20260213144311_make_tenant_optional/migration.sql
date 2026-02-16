-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_contracts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "group_id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "property_id" TEXT NOT NULL,
    "start_date" DATETIME NOT NULL,
    "start_month" INTEGER NOT NULL DEFAULT 1,
    "duration_months" INTEGER NOT NULL,
    "current_month" INTEGER NOT NULL DEFAULT 1,
    "base_rent" REAL NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "adjustment_index_id" TEXT,
    "next_adjustment_month" INTEGER,
    "punitory_start_day" INTEGER NOT NULL DEFAULT 4,
    "punitory_grace_day" INTEGER NOT NULL DEFAULT 10,
    "punitory_percent" REAL NOT NULL DEFAULT 0.02,
    "observations" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "contracts_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "contracts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "contracts_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "contracts_adjustment_index_id_fkey" FOREIGN KEY ("adjustment_index_id") REFERENCES "adjustment_indices" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_contracts" ("active", "adjustment_index_id", "base_rent", "created_at", "current_month", "duration_months", "group_id", "id", "next_adjustment_month", "observations", "property_id", "punitory_grace_day", "punitory_percent", "punitory_start_day", "start_date", "start_month", "tenant_id", "updated_at") SELECT "active", "adjustment_index_id", "base_rent", "created_at", "current_month", "duration_months", "group_id", "id", "next_adjustment_month", "observations", "property_id", "punitory_grace_day", "punitory_percent", "punitory_start_day", "start_date", "start_month", "tenant_id", "updated_at" FROM "contracts";
DROP TABLE "contracts";
ALTER TABLE "new_contracts" RENAME TO "contracts";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
