/*
 * Ephemeral, disposable Postgres for integration tests (concurrency/atomicity).
 * Separate from the sim-harness "simdb" (which mirrors a prod copy) — this one
 * starts empty and only exists for the duration of a test run, so it's safe to
 * truncate/reset between tests without touching real data.
 *
 * Usage (see run.sh):
 *   node test/integration/docker-test-db.js up     # start container + push schema
 *   node test/integration/docker-test-db.js down   # stop + remove container
 */
const { execSync } = require('child_process');
const path = require('path');

const CONTAINER = 'inmobiliaria_test_pg';
const PORT = 55433;
const DB = 'inmotest';
const USER = 'test';
const PASSWORD = 'test';
const TEST_DATABASE_URL = `postgresql://${USER}:${PASSWORD}@localhost:${PORT}/${DB}`;

function sh(cmd, opts = {}) {
  return execSync(cmd, { stdio: 'pipe', encoding: 'utf8', ...opts });
}

function containerExists() {
  try {
    const out = sh(`docker ps -a --filter "name=^/${CONTAINER}$" --format '{{.Names}}'`);
    return out.trim() === CONTAINER;
  } catch {
    return false;
  }
}

function containerRunning() {
  try {
    const out = sh(`docker ps --filter "name=^/${CONTAINER}$" --format '{{.Names}}'`);
    return out.trim() === CONTAINER;
  } catch {
    return false;
  }
}

async function waitForReady(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      sh(`docker exec ${CONTAINER} pg_isready -U ${USER} -d ${DB}`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error(`Postgres de test (${CONTAINER}) no quedó listo después de ${timeoutMs}ms`);
}

async function up() {
  if (!containerExists()) {
    sh(
      `docker run -d --name ${CONTAINER} ` +
      `-e POSTGRES_USER=${USER} -e POSTGRES_PASSWORD=${PASSWORD} -e POSTGRES_DB=${DB} ` +
      `-p ${PORT}:5432 postgres:16-alpine`
    );
  } else if (!containerRunning()) {
    sh(`docker start ${CONTAINER}`);
  }
  await waitForReady();

  // Push the current schema (no migrations history needed for disposable test DB).
  const backendDir = path.join(__dirname, '..', '..');
  sh(`npx prisma db push --skip-generate --accept-data-loss`, {
    cwd: backendDir,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}

function down() {
  if (containerExists()) {
    sh(`docker rm -f ${CONTAINER}`);
  }
}

module.exports = { up, down, TEST_DATABASE_URL, CONTAINER };

if (require.main === module) {
  const cmd = process.argv[2];
  (async () => {
    if (cmd === 'up') await up();
    else if (cmd === 'down') down();
    else {
      console.error('Uso: node docker-test-db.js <up|down>');
      process.exit(1);
    }
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
