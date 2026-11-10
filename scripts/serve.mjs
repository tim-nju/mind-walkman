import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, realpath } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = await realpath(process.cwd());
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.mp3':'audio/mpeg', '.m4a':'audio/mp4' };
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const decoded = decodeURIComponent(url.pathname);
    if (decoded.split('/').some(segment => segment === '..' || segment === '.' || segment.startsWith('.'))) { res.writeHead(403).end(); return; }
    if (!/^\/(?:(?:index|listen)\.html|app\.js|sync-(?:model|client|store|transport|player|ui)\.js|sync\.css|sealed-media\.js|private-delivery\.js|tracks\.js|course-data\.js|controls\.js|importer\.js|storage\.js|sw\.js|styles\.css|manifest\.json|public\/(?:audio|icons|sealed)\/[^?]+)?$/.test(decoded)) { res.writeHead(403).end(); return; }
    const path = await realpath(resolve(root, `.${(decoded === '/' ? '/index.html' : decoded)}`));
    if (!path.startsWith(`${root}${sep}`) || (decoded.startsWith('/public/') && !path.startsWith(resolve(root, 'public', decoded.split('/')[2]) + sep))) { res.writeHead(403).end(); return; }
    const info = await stat(path);
    if (!info.isFile() || !['GET','HEAD'].includes(req.method)) { res.writeHead(404).end(); return; }
    const headers = { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Accept-Ranges':'bytes', 'Cache-Control':'no-cache' };
    let start = 0;
    let end = info.size - 1;
    let status = 200;
    if (req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!match || (!match[1] && !match[2])) { res.writeHead(416, { 'Content-Range':`bytes */${info.size}` }).end(); return; }
      start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
      if (start > end || start >= info.size || (!match[1] && Number(match[2]) === 0)) { res.writeHead(416, { 'Content-Range':`bytes */${info.size}` }).end(); return; }
      headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
      status = 206;
    }
    headers['Content-Length'] = String(end - start + 1);
    res.writeHead(status, headers);
    if (req.method === 'HEAD') res.end(); else createReadStream(path, { start, end }).pipe(res);
  } catch (error) { if (error instanceof Error) res.writeHead(404).end('Not found'); else throw error; }
}).listen(Number(process.env.PORT || 8767), '127.0.0.1', () => console.log(`Serving ${root} on ${process.env.PORT || 8767}`));
