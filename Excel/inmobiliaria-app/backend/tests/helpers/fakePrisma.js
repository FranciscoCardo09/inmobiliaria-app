/**
 * Minimal in-memory fake Prisma client used by node:test unit tests
 * (paired with proxyquire to inject into services that require '../lib/prisma').
 *
 * Supports: findUnique, findFirst, findMany, create, createMany, update,
 * updateMany, upsert, delete, deleteMany, count; plus $transaction (runs
 * callback with same client — no real isolation, fine for unit tests).
 *
 * Filters: equality, { in: [...] }, { notIn }, { not }, { lt/gt/lte/gte },
 * { contains }, plus AND/OR/NOT composition.
 *
 * Update data supports the numeric-field operators Prisma exposes for atomic
 * increments: { increment }, { decrement }, { set }, { multiply }, { divide }.
 */
const { randomUUID } = require('crypto');

function matchValue(actual, condition) {
  if (condition === undefined) return true;
  if (condition === null) return actual === null || actual === undefined;
  if (condition instanceof Date) {
    return actual instanceof Date && actual.getTime() === condition.getTime();
  }
  if (typeof condition !== 'object') return actual === condition;
  if ('in' in condition) return condition.in.includes(actual);
  if ('notIn' in condition) return !condition.notIn.includes(actual);
  if ('not' in condition) {
    if (condition.not === null) return actual !== null && actual !== undefined;
    return actual !== condition.not;
  }
  if ('lt' in condition) return new Date(actual).getTime() < new Date(condition.lt).getTime();
  if ('gt' in condition) return new Date(actual).getTime() > new Date(condition.gt).getTime();
  if ('lte' in condition) return new Date(actual).getTime() <= new Date(condition.lte).getTime();
  if ('gte' in condition) return new Date(actual).getTime() >= new Date(condition.gte).getTime();
  if ('contains' in condition) return String(actual || '').includes(condition.contains);
  // Nested relation filter (e.g. `where: { contract: { groupId, active: true } }`).
  // Real Prisma joins the relation; the fake has no joins, so tests embed the
  // related object literally on the row (see helpers usage in adjustmentGuards
  // tests) and this recurses into it with the same matching rules as a top-level
  // `where`.
  if (actual && typeof actual === 'object' && !(actual instanceof Date) && !Array.isArray(actual)) {
    return matchWhere(actual, condition);
  }
  return actual === condition;
}

function matchWhere(row, where) {
  if (!where) return true;
  for (const [key, condition] of Object.entries(where)) {
    if (key === 'AND') {
      const arr = Array.isArray(condition) ? condition : [condition];
      if (!arr.every((w) => matchWhere(row, w))) return false;
      continue;
    }
    if (key === 'OR') {
      const arr = Array.isArray(condition) ? condition : [condition];
      if (!arr.some((w) => matchWhere(row, w))) return false;
      continue;
    }
    if (key === 'NOT') {
      if (matchWhere(row, condition)) return false;
      continue;
    }
    if (!matchValue(row[key], condition)) return false;
  }
  return true;
}

function orderRows(rows, ordering) {
  if (!ordering) return rows;
  const orderings = Array.isArray(ordering) ? ordering : [ordering];
  return [...rows].sort((a, b) => {
    for (const o of orderings) {
      for (const [field, dir] of Object.entries(o)) {
        const av = a[field];
        const bv = b[field];
        if (av === bv) continue;
        if (av == null) return dir === 'asc' ? -1 : 1;
        if (bv == null) return dir === 'asc' ? 1 : -1;
        if (av < bv) return dir === 'asc' ? -1 : 1;
        return dir === 'asc' ? 1 : -1;
      }
    }
    return 0;
  });
}

function applySelect(rows, select) {
  if (!select) return rows;
  return rows.map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(select)) {
      if (v === true) out[k] = row[k];
      // nested relation select/include: pass the stored value through as-is
      else if (v && typeof v === 'object') out[k] = row[k];
    }
    return out;
  });
}

// Resolves Prisma's numeric field-update operators ({ increment }, { decrement },
// { set }, { multiply }, { divide }) against the current row so `update`/`upsert`
// behave like the real atomic SQL Prisma would generate.
function resolveUpdateData(row, data) {
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('increment' in value) { out[key] = (row[key] || 0) + value.increment; continue; }
      if ('decrement' in value) { out[key] = (row[key] || 0) - value.decrement; continue; }
      if ('multiply' in value) { out[key] = (row[key] || 0) * value.multiply; continue; }
      if ('divide' in value) { out[key] = (row[key] || 0) / value.divide; continue; }
      if ('set' in value) { out[key] = value.set; continue; }
    }
    out[key] = value;
  }
  return out;
}

function makeTable() {
  const rows = [];

  return {
    _rows: rows,
    findUnique: async ({ where, select } = {}) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (!row) return null;
      return select ? applySelect([row], select)[0] : { ...row };
    },
    findFirst: async ({ where, orderBy, select } = {}) => {
      const filtered = rows.filter((r) => matchWhere(r, where || {}));
      const ordered = orderRows(filtered, orderBy);
      const row = ordered[0];
      if (!row) return null;
      return select ? applySelect([row], select)[0] : { ...row };
    },
    findMany: async ({ where, orderBy, select } = {}) => {
      const filtered = rows.filter((r) => matchWhere(r, where || {}));
      const ordered = orderRows(filtered, orderBy);
      return select ? applySelect(ordered, select) : ordered.map((r) => ({ ...r }));
    },
    create: async ({ data }) => {
      const row = {
        id: data.id || randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      rows.push(row);
      return { ...row };
    },
    createMany: async ({ data }) => {
      const arr = Array.isArray(data) ? data : [data];
      for (const d of arr) {
        rows.push({
          id: d.id || randomUUID(),
          createdAt: new Date(),
          updatedAt: new Date(),
          ...d,
        });
      }
      return { count: arr.length };
    },
    update: async ({ where, data }) => {
      const idx = rows.findIndex((r) => matchWhere(r, where));
      if (idx === -1) throw new Error('Record not found');
      rows[idx] = { ...rows[idx], ...resolveUpdateData(rows[idx], data), updatedAt: new Date() };
      return { ...rows[idx] };
    },
    updateMany: async ({ where, data }) => {
      let count = 0;
      for (let i = 0; i < rows.length; i++) {
        if (matchWhere(rows[i], where || {})) {
          rows[i] = { ...rows[i], ...resolveUpdateData(rows[i], data), updatedAt: new Date() };
          count++;
        }
      }
      return { count };
    },
    upsert: async ({ where, create, update }) => {
      const idx = rows.findIndex((r) => matchWhere(r, where));
      if (idx === -1) {
        const row = { id: create.id || randomUUID(), createdAt: new Date(), updatedAt: new Date(), ...create };
        rows.push(row);
        return { ...row };
      }
      rows[idx] = { ...rows[idx], ...resolveUpdateData(rows[idx], update), updatedAt: new Date() };
      return { ...rows[idx] };
    },
    delete: async ({ where }) => {
      const idx = rows.findIndex((r) => matchWhere(r, where));
      if (idx === -1) throw new Error('Record not found');
      return rows.splice(idx, 1)[0];
    },
    deleteMany: async ({ where }) => {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (matchWhere(rows[i], where || {})) {
          rows.splice(i, 1);
          count++;
        }
      }
      return { count };
    },
    count: async ({ where } = {}) => rows.filter((r) => matchWhere(r, where || {})).length,
  };
}

function makeFakePrisma() {
  const models = [
    'contract',
    'contractTenant',
    'monthlyRecord',
    'monthlyService',
    'rentHistory',
    'payment',
    'paymentTransaction',
    'paymentConcept',
    'transactionConcept',
    'debt',
    'debtPayment',
    'tenant',
    'property',
    'group',
    'adjustmentIndex',
    'holiday',
    'conceptType',
    'receiptSequence',
  ];

  const client = {};
  for (const m of models) client[m] = makeTable();

  client.$transaction = async (cb) => cb(client);
  client.$disconnect = async () => {};
  // No-op stub: production code uses this only for pg_advisory_xact_lock (Postgres-only,
  // meaningless without real concurrency); the in-memory fake has none to guard against.
  client.$executeRawUnsafe = async () => 0;
  return client;
}

module.exports = { makeFakePrisma };
