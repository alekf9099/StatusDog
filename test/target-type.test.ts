import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ConfigError, resolveConfig } from '../src/config/index.js';

const { normalizeExpect, expectFor, API_DEFAULT_EXPECT } = (await import(
  pathToFileURL(path.resolve('public/assets/target-type.js')).href
)) as {
  normalizeExpect: (value: unknown) => string | null;
  expectFor: (monitor: unknown) => string | undefined;
  API_DEFAULT_EXPECT: string;
};

test('healthy status codes are tidied, and nonsense is refused', () => {
  assert.equal(normalizeExpect(' 2XX , 401 '), '2xx,401');
  assert.equal(normalizeExpect('200-299'), '200-299');
  assert.equal(normalizeExpect(''), API_DEFAULT_EXPECT, 'blank means the default');
  assert.equal(normalizeExpect('ok'), null);
  assert.equal(normalizeExpect('200,abc'), null);
  assert.equal(normalizeExpect('99'), null);
  assert.equal(normalizeExpect('6xx'), null);
});

test('an API is checked against its own codes; a website against the site default', () => {
  assert.equal(expectFor({ type: 'api', expect: '2xx,401' }), '2xx,401');
  assert.equal(expectFor({ type: 'api' }), API_DEFAULT_EXPECT);
  assert.equal(expectFor({ type: 'web' }), undefined);
  assert.equal(expectFor({}), undefined, 'monitors stored before types existed are websites');
});

test('a roster target is a website unless it says it is an app API', () => {
  const config = resolveConfig({
    targets: [
      { url: 'https://example.com/' },
      { url: 'https://api.example.com/health', type: 'api' },
    ],
  });
  assert.deepEqual(config.targets.map((target) => target.type), ['web', 'api']);
});

test('a roster type must be one of the two, and an API cannot discover menu pages', () => {
  assert.throws(() => resolveConfig({ targets: [{ url: 'https://example.com/', type: 'app' as never }] }), ConfigError);
  assert.throws(
    () => resolveConfig({ targets: [{ url: 'https://api.example.com/', type: 'api', discover: true }] }),
    ConfigError,
  );
});
