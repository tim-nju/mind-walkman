CREATE TABLE IF NOT EXISTS mw_owner (
  id integer PRIMARY KEY CHECK (id=1),
  source_id uuid NOT NULL,
  track_key_secret text NOT NULL CHECK (track_key_secret ~ '^[a-f0-9]{64}$'),
  seq bigint NOT NULL DEFAULT 0 CHECK (seq>=0 AND seq<=9007199254740991)
);
CREATE TABLE IF NOT EXISTS mw_credentials (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  owner_id integer NOT NULL REFERENCES mw_owner(id),
  id uuid NOT NULL UNIQUE,
  purpose text NOT NULL CHECK (purpose IN ('device','backup')),
  authorized_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz,
  label text,
  pair_code_hash text UNIQUE,
  last_read_at timestamptz,
  last_saved_at timestamptz,
  last_checksum text
);
CREATE TABLE IF NOT EXISTS mw_activation (
  secret_hash text PRIMARY KEY,
  owner_id integer NOT NULL REFERENCES mw_owner(id),
  expires_at timestamptz NOT NULL,
  token_hash text
);
-- Consumed hashes are immutable history; device credentials may rotate.
ALTER TABLE mw_activation DROP CONSTRAINT IF EXISTS mw_activation_token_hash_fkey;
CREATE TABLE IF NOT EXISTS mw_operations (
  owner_id integer NOT NULL REFERENCES mw_owner(id),
  op_id uuid NOT NULL,
  body text NOT NULL,
  PRIMARY KEY (owner_id,op_id)
);
CREATE TABLE IF NOT EXISTS mw_versions (
  owner_id integer NOT NULL REFERENCES mw_owner(id),
  seq bigint NOT NULL CHECK (seq>0 AND seq<=9007199254740991),
  key text NOT NULL,
  record jsonb NOT NULL,
  PRIMARY KEY (owner_id,seq)
);
CREATE INDEX IF NOT EXISTS mw_versions_key ON mw_versions(owner_id,key,seq DESC);
