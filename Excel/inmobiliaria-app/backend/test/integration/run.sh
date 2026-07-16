#!/usr/bin/env bash
# Starts the disposable test Postgres, runs integration tests against it, tears it down.
# DATABASE_URL is forced here (not read from .env) so these tests can NEVER touch a real DB.
set -euo pipefail
cd "$(dirname "$0")/../.."

TEST_DATABASE_URL="postgresql://test:test@localhost:55433/inmotest"

node test/integration/docker-test-db.js up

if [ "$#" -eq 0 ]; then
  set -- test/integration/*.test.js
fi

set +e
DATABASE_URL="$TEST_DATABASE_URL" node --test "$@"
STATUS=$?
set -e

if [ -z "${KEEP_TEST_DB:-}" ]; then
  node test/integration/docker-test-db.js down
fi

exit $STATUS
