/**
 * Minimal in-memory fake Prisma client used by node:test unit tests
 * (paired with proxyquire to inject into services that require '../lib/prisma').
 *
 * Supports: findUnique, findFirst, findMany, create, createMany, update,
 * updateMany, delete, deleteMany; plus $transaction (runs callback with same
 * client — no real isolation, fine for unit tests).
 *
 * Filters: equality, { in: [...] }, { notIn }, { not }, { lt/gt/lte/gte },
 * { contains }, plus AND/OR/NOT composition.
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
    }
    return out;
  });
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
      rows[idx] = { ...rows[idx], ...data, updatedAt: new Date() };
      return { ...rows[idx] };
    },
    updateMany: async ({ where, data }) => {
      let count = 0;
      for (let i = 0; i < rows.length; i++) {
        if (matchWhere(rows[i], where || {})) {
          rows[i] = { ...rows[i], ...data, updatedAt: new Date() };
          count++;
        }
      }
      return { count };
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
  ];

  const client = {};
  for (const m of models) client[m] = makeTable();

  client.$transaction = async (cb) => cb(client);
  client.$disconnect = async () => {};
  return client;
}

module.exports = { makeFakePrisma };
