# PostgreSQL listening sync

Node 22+ and PostgreSQL are required. Install with `npm ci`. No SQLite or memory persistence is used.

Initialize an explicitly selected database using `node server/admin.mjs initialize --database-env MW_ADMIN_DATABASE_URL`. The named environment variable contains the operator connection string; no connection string is accepted as an argument or printed.

Run `DATABASE_URL=... ALLOWED_ORIGINS=https://your-client.example HOST=127.0.0.1 PORT=8787 node server/server.mjs`. `ALLOWED_ORIGINS` is a comma-separated list of exact serialized origins, without paths or trailing slash. Set `HOST` deliberately when using a reverse proxy. Terminate TLS at that proxy and restrict direct access to the bind address. Cookies are not authentication. Requests without Origin remain authenticated with their purpose-specific Bearer token. Include the service origin in the exact allowlist when backup-kit is used: its POSTs send that origin.

Operator commands all require `--database-env VARIABLE`:

- `issue-activation`: prints the 256-bit activation secret once to the operator. It lasts 15 minutes. A browser submits a pre-persisted token's SHA-256 hash; retry with that same hash recovers an interrupted response. A consumed secret never creates another device. Device revocation invalidates recovery.
- Device reauthorization uses a fresh activation secret, a new token hash, and the previous device Bearer in the activation Authorization header. It rotates the credential while retaining the actor and pending operations. The previous token immediately stops working; expired/consumed secrets and backup credentials cannot rotate a device. Run `initialize` once when upgrading an existing database to remove the old activation-token foreign key.
- `approve-backup CODE`: authorizes the backup-kit's pending 10-character uppercase code within ten minutes.
- `list`: lists only credential IDs, purposes, labels, and operational timestamps.
- `revoke ID`: revokes the selected device or backup grant.
- `restore --isolated SNAPSHOT`: verifies the installed backup-kit v1 envelope, checksum, project, strict payload and records before importing into an empty database. It refuses an initialized database, retains the track key secret and state, generates a new source identity, and imports no credentials. Always use a separately created database.

The owner is a fixed singleton. Every service transaction locks its row, including credential revocation, read watermarks, and pushes. A push merges records and assigns ordered sequence numbers, immutable versions, and operation acknowledgments in one PostgreSQL transaction. Reusing an operation ID with changed content aborts the entire batch. Device actor IDs are server-issued. Immutable versions are retained without compaction so older fixed watermarks remain readable. Plan PostgreSQL backups and disk monitoring for this retained history.

HTTP request bodies are limited to 256 KiB; operation batches to 100. Pull/export pages contain at most 100 entries. Backup export rejects a snapshot above the component's 64 MiB ceiling (including conservative envelope overhead). Query pagination rejects unknown/duplicate fields, future watermarks and mismatched source identities. Exact content shapes are enforced by the shared model. Rate limits apply per direct peer IP: 30 activation/pair attempts and 300 other requests per minute, with a bounded map. A reverse proxy should provide its own perimeter rate limit; forwarded IP headers are deliberately ignored. Local rate counters reset on process restart; credential and activation limits remain persisted.

Run `SYNC_TEST_DATABASE_URL=postgresql://... node scripts/sync-server-check.mjs` against a dedicated throwaway PostgreSQL database whose role can create schemas. The test creates random isolated schemas and drops only those schemas in `finally`, exercises real authenticated HTTP with concurrent database clients and process restart, invokes the actual backup-kit snapshot runner and envelope validator, and restores into another empty schema. The installed source component defaults to `../经典背诵/packages/backup-kit`; set `BACKUP_KIT_DIR` to an explicit directory if moved. The server has no runtime dependency on that sibling project.

This adds only an independent service and operator adapter; the parent task owns client/player changes and the shared architecture and acceptance documents. No deployment, production operation, LaunchAgent installation or real backup pairing is performed by this implementation.
