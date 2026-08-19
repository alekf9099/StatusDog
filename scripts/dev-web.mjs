#!/usr/bin/env node
/**
 * Local preview of the Vercel site — serves `public/` statically and routes the
 * `api/` functions the same way `vercel.json` does.
 *
 * Vercel's own dev server needs the CLI and an account; this needs neither, so
 * the site can be checked before every deploy. Run `npm run build` first.
 *
 *   node scripts/dev-web.mjs [--port 3000]
 */
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');

const portFlag = process.argv.indexOf('--port');
const port = portFlag === -1 ? 3000 : Number(process.argv[portFlag + 1]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
};

/** Mirrors the `rewrites` block in vercel.json. */
function rewrite(pathname) {
  if (pathname === '/healthz') return { module: 'healthz.js', query: '' };
  if (pathname === '/preview') return { module: 'preview.js', query: '' };

  // Mirrors the /status/:target rewrite in vercel.json. That rewrite points at
  // /status rather than /status.html on purpose: with cleanUrls on, Vercel
  // 308-redirects the .html form, so naming it there made the route 404.
  const status = /^\/status\/([^/]+)$/.exec(pathname);
  if (status) return { staticFile: 'status.html', query: `target=${status[1]}` };

  const preview = /^\/preview\/([^/]+)$/.exec(pathname);
  if (preview) return { module: 'preview.js', query: `template=${preview[1]}` };
  const api = /^\/api\/([\w/-]+)$/.exec(pathname);
  if (api && existsSync(path.join(root, 'api', `${api[1]}.js`))) {
    return { module: `${api[1]}.js`, query: '' };
  }
  return null;
}

/** Minimal stand-in for the response helpers Vercel adds. */
function decorate(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    const body = JSON.stringify(payload, null, 2);
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(body);
  };
  res.send = (body) => res.end(body);
  return res;
}

function serveStatic(pathname, res) {
  // cleanUrls: `/docs` resolves to `public/docs.html`.
  const candidates = pathname === '/'
    ? ['index.html']
    : [pathname.slice(1), `${pathname.slice(1)}.html`, path.join(pathname.slice(1), 'index.html')];

  for (const candidate of candidates) {
    const file = path.join(publicDir, candidate);
    if (!file.startsWith(publicDir)) break;
    if (existsSync(file) && statSync(file).isFile()) {
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      createReadStream(file).pipe(res);
      return true;
    }
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname.replace(/\/+$/, '') || '/';

  const route = rewrite(pathname);

  if (route?.staticFile) {
    // The query is only for the browser; serving the file is all this side does.
    if (serveStatic(`/${route.staticFile}`, res)) return;
    res.writeHead(404).end('Not found');
    return;
  }

  if (route) {
    const query = route.query ? `${route.query}&${url.searchParams}` : url.searchParams.toString();
    req.url = `${pathname}${query ? `?${query}` : ''}`;
    try {
      const { default: handler } = await import(
        `${new URL(`../api/${route.module}`, import.meta.url).href}`
      );
      await handler(req, decorate(res));
    } catch (err) {
      decorate(res).status(500).json({ error: err.message, stack: err.stack });
    }
    return;
  }

  if (serveStatic(pathname, res)) return;

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`StatusDog site on http://127.0.0.1:${port}`);
});
