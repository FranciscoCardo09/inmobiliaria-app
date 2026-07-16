/*
 * Bloque 1 does NOT touch A-14 (recalculateMonthlyRecord marks records dirty and
 * schedules processDirtyRecords via setImmediate — fire-and-forget, not awaited by
 * the caller). Integration tests still need a settled state before snapshotting or
 * asserting, and before $disconnect() (otherwise the pending setImmediate worker can
 * fire against an already-closed connection).
 *
 * IMPORTANT: do NOT call processDirtyRecords() directly here — the production code
 * already scheduled it via setImmediate, and invoking it a second time concurrently
 * caused a real Postgres deadlock (two workers racing the same contract's advisory
 * lock) when this was tried. Poll for the dirty flag to clear instead, so we wait for
 * the SAME worker instead of racing a second one.
 */
async function flushRecalculation(prisma, groupId, { timeoutMs = 5000, pollMs = 20 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const pending = await prisma.monthlyRecord.count({ where: { groupId, needsRecalculation: true } });
    if (pending === 0) return;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`Quedaron MonthlyRecord con needsRecalculation=true después de ${timeoutMs}ms (grupo ${groupId})`);
}

module.exports = { flushRecalculation };
