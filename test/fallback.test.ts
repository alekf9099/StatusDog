import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveConfig } from '../src/config/index.js';
import { renderFallbackPage, renderTemplate } from '../src/fallback/render.js';
import { startFallbackServer } from '../src/fallback/server.js';
import { fetchText } from './helpers.js';

test('renderTemplate substitutes and escapes', () => {
  const html = renderTemplate('<h1>{{title}}</h1><p>{{ message }}</p>', {
    title: '<script>alert(1)</script>',
    message: 'hello',
  });
  assert.equal(html, '<h1>&lt;script&gt;alert(1)&lt;/script&gt;</h1><p>hello</p>');
});

test('renderTemplate drops unknown placeholders', () => {
  assert.equal(renderTemplate('a{{nope}}b', {}), 'ab');
});

test('renderFallbackPage fills in target details', () => {
  const config = resolveConfig({
    targets: [
      {
        id: 'api',
        name: 'Public API',
        url: 'https://example.com/health',
        fallback: { title: 'API down', message: 'Back soon', statusCode: 502 },
      },
    ],
  });
  const page = renderFallbackPage({ target: config.targets[0]!, lastChecked: null });
  assert.equal(page.statusCode, 502);
  assert.match(page.html, /API down/);
  assert.match(page.html, /Back soon/);
  assert.match(page.html, /Public API/);
  assert.doesNotMatch(page.html, /\{\{/, 'no placeholders left behind');
});

test('an unknown template degrades to the built-in page instead of crashing', () => {
  const config = resolveConfig({
    targets: [{ id: 'x', url: 'https://example.com', fallback: { template: './no-such-file.html' } }],
  });
  const page = renderFallbackPage({ target: config.targets[0]! });
  assert.match(page.html, /Served by StatusDog/);
});

test('the fallback server answers every path with the maintenance page', async () => {
  const config = resolveConfig({
    targets: [
      {
        id: 'site',
        name: 'Marketing site',
        url: 'https://example.com',
        fallback: { title: 'Under maintenance', retryAfterSeconds: 45 },
      },
    ],
  });
  const server = await startFallbackServer({
    host: '127.0.0.1',
    port: 0,
    target: config.targets[0]!,
  });
  try {
    const root = await fetchText(`${server.url}/`);
    assert.equal(root.status, 503);
    assert.equal(root.headers.get('retry-after'), '45');
    assert.match(root.body, /Under maintenance/);

    const deep = await fetchText(`${server.url}/some/deep/path?x=1`);
    assert.equal(deep.status, 503);
    assert.match(deep.body, /Under maintenance/);

    const health = await fetchText(`${server.url}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(JSON.parse(health.body), { status: 'fallback', service: 'Marketing site' });
  } finally {
    await server.close();
  }
});
