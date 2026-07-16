/*
 * Re-exports the app's real Prisma singleton (src/lib/prisma.js) for use in
 * integration tests. Relies on DATABASE_URL already pointing at the disposable
 * test DB (set by run.sh) BEFORE this module — and therefore the app's lib/prisma
 * module — is first required anywhere in the process.
 */
module.exports = require('../../src/lib/prisma');
