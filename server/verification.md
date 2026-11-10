# Local verification receipt

2026-11-09. This receipt records local execution, not a deployment or a production backup authorization.

Runtime: Node v26.10.0 on macOS arm64; disposable Docker `postgres:17-alpine`, bound only to `127.0.0.1:64908`. Credentials were generated solely for that disposable instance. The container was stopped after verification; the test itself dropped both randomly named PostgreSQL schemas and removed its temporary snapshot directory.

Commands executed:

```sh
npm install --ignore-scripts --no-audit --no-fund
node --check server/server.mjs
node --check server/service.mjs
node --check server/db.mjs
node --check server/admin.mjs
node --check server/restore.mjs
node --check scripts/sync-server-check.mjs
node scripts/sync-model-check.mjs
SYNC_TEST_DATABASE_URL=<isolated-local-postgres-url> node scripts/sync-server-check.mjs
```

Installation completed with exit code 0, adding pg and its transitive dependencies. All six Node syntax checks and the shared model checks completed with exit code 0. The PostgreSQL integration command completed with exit code 0 and this result:

```json
{"passed":true,"checks":102,"postgres":true,"authenticatedHTTP":true,"concurrentWrites":true,"restartPersistence":true,"backupKitRoundtrip":true,"isolatedRestore":true}
```

The executable suite covers activation and same-hash recovery, consumed/expired activation, missing credentials and cookies, exact Origin policy, malformed JSON and oversized bodies, unknown record fields, batch size, server-issued actors, source mismatch, future/invalid/duplicate cursors, atomic operation rollback, same-content replay, changed-content conflict, concurrent devices and duplicate operations, immutable fixed-watermark pull/export, purpose isolation, explicit backup grant approval/revocation, a fresh `node server/server.mjs` process loading persisted state, the existing backup-kit's actual snapshot runner and envelope validator, checksum/payload rejection, empty-database restore, retained HMAC identity, new source identity, fresh authorization, device disconnect, rate limits, and the real operator CLI listing without token/hash disclosure.

The service does not depend on the sibling backup-kit at runtime. Verification intentionally imports that installed source component to test its actual envelope protocol. TypeScript language-server diagnostics were unavailable and are not claimed. Browser/player tests, LaunchAgent installation, production deployment, and production backup authorization belong to the parent acceptance work and were not performed here.

## Credential rotation follow-up

2026-11-09: the parent integration identified that simply reusing a revoked token could not safely reauthorize pending operations. Fresh activation plus proof of the previous device token now rotates the bearer while preserving its actor. The PostgreSQL suite was rerun for these changed inputs and passed 133 checks with exit 0, including actorPreservingRotation, old-token rejection, consumed/expired-secret rejection, wrong-purpose rejection and migration from the previous schema. The worker removed its disposable container and test schemas. The earlier 102-check receipt remains historical, not the final count.
