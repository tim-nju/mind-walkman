import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { database, HttpError } from './db.mjs';
import { createService, MAX_BODY } from './service.mjs';
import { SyncDataError } from '../sync-model.js';
export function configuration(env = process.env) {
  const allowedOrigins = (env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
  if (!allowedOrigins.length || allowedOrigins.some(value => {
    try { const url = new URL(value); return url.origin !== value || !['http:','https:'].includes(url.protocol); } catch { return true; }
  })) throw new Error('exact_allowed_origins_required');
  const port = Number(env.PORT || 8787);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('invalid_port');
  return { allowedOrigins, host: env.HOST || '127.0.0.1', port };
}
export function httpServer({ db, allowedOrigins, rateLimit = 300, activationLimit = 30, now = () => Date.now() }) {
  const service = createService(db), rates = new Map();
  return createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    try {
      const origin = req.headers.origin;
      if (origin) {
        if (!allowedOrigins.includes(origin)) throw new HttpError(403, 'origin_not_allowed');
        res.setHeader('access-control-allow-origin', origin);
        res.setHeader('vary', 'Origin');
      }
      if (req.method === 'OPTIONS') {
        res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
        res.setHeader('access-control-allow-headers', 'Authorization, Content-Type');
        res.writeHead(204); res.end(); return;
      }
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/api/health')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, app: 'mind-walkman-sync' }));
        return;
      }
      const sensitive = ['/api/device/activate','/api/backup/pair'].includes(url.pathname);
      const window = Math.floor(now()/60000);
      for (const [key, value] of rates) if (value.window !== window) rates.delete(key);
      const key = (req.socket.remoteAddress || 'unknown') + (sensitive ? ':pair' : ':api');
      if (!rates.has(key) && rates.size >= 10000) throw new HttpError(429, 'too_many_attempts');
      const rate = rates.get(key) || { window, count: 0 }; rates.set(key, rate);
      if (++rate.count > (sensitive ? activationLimit : rateLimit)) throw new HttpError(429, 'too_many_attempts');
      let body;
      if (req.method === 'POST') {
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || '')) throw new HttpError(400, 'json_required');
        const bytes = await new Promise((resolveBody, reject) => {
          let size = 0; const chunks = [];
          req.on('data', chunk => {
            size += chunk.length;
            if (size > MAX_BODY) {
              chunks.length = 0;
              reject(new HttpError(413, 'request_too_large'));
            } else chunks.push(chunk);
          });
          req.once('end', () => resolveBody(Buffer.concat(chunks)));
          req.once('error', reject);
        });
        try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new HttpError(400, 'invalid_json'); }
      }
      const bearer = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '')?.[1];
      if (req.headers.authorization !== undefined && !bearer) throw new HttpError(401, 'not_authorized');
      const result = await service({ method: req.method, path: url.pathname, body, bearer, query: url.searchParams });
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(result));
    } catch (error) {
      const status = error instanceof SyncDataError ? 400 : error instanceof HttpError ? error.status : 500;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: status === 500 ? 'internal_error' : error.message }));
      if (status === 500) console.error('sync_request_failed');
    }
  });
}
export async function start(env = process.env) {
  const config = configuration(env), db = database(env.DATABASE_URL);
  await db.query('SELECT id FROM mw_owner WHERE id=1').then(result => { if (!result.rowCount) throw new Error('service_not_initialized'); });
  const server = httpServer({ db, ...config });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, resolve); });
  return { server, db };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().then(({ server, db }) => {
    console.log('sync_server_listening');
    for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => server.close(() => db.end()));
  }).catch(() => { console.error('sync_server_start_failed'); process.exitCode = 1; });
}
