import { pathToFileURL } from 'node:url';
import { database, initialize, issueActivation, approveBackup, revoke, transaction } from './db.mjs';
import { restore } from './restore.mjs';
export async function main(args = process.argv.slice(2), env = process.env) {
  const [command, flag, variable, ...rest] = args;
  if (flag !== '--database-env' || !/^[A-Z][A-Z0-9_]*$/.test(variable || '') || !env[variable]) throw new Error('explicit_database_env_required');
  const db = database(env[variable]);
  try {
    if (command === 'initialize' && rest.length === 0) return await initialize(db);
    if (command === 'issue-activation' && rest.length === 0) return await issueActivation(db);
    if (command === 'approve-backup' && rest.length === 1) return await approveBackup(db, rest[0]);
    if (command === 'revoke' && rest.length === 1) return await revoke(db, rest[0]);
    if (command === 'restore' && rest.length === 2 && rest[0] === '--isolated') return await restore(db, rest[1]);
    if (command === 'list' && rest.length === 0) return await transaction(db, async t => ({
      credentials: (await t.query('SELECT id,purpose,label,authorized_at,revoked_at,last_read_at,last_saved_at FROM mw_credentials WHERE owner_id=1 ORDER BY id')).rows
    }));
    throw new Error('usage_initialize_issue-activation_approve-backup_revoke_list_restore');
  } finally { await db.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(/^[a-z0-9_-]+$/.test(error.message) ? error.message : 'operator_command_failed');
    process.exitCode = 1;
  });
}
