import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isBlockedHost, normalizeCheckUrl, UnsafeUrlError } from '../src/monitor/target-url.js';

test('bare hosts get https:// prepended', () => {
  assert.equal(normalizeCheckUrl('example.com'), 'https://example.com/');
  assert.equal(normalizeCheckUrl('  example.com/health  '), 'https://example.com/health');
});

test('full URLs are preserved', () => {
  assert.equal(normalizeCheckUrl('http://example.com/a?b=1'), 'http://example.com/a?b=1');
  assert.equal(normalizeCheckUrl('https://example.com:8443/x'), 'https://example.com:8443/x');
});

test('non-http schemes are rejected', () => {
  assert.throws(() => normalizeCheckUrl('ftp://example.com'), UnsafeUrlError);
  assert.throws(() => normalizeCheckUrl('file:///etc/passwd'), UnsafeUrlError);
  assert.throws(() => normalizeCheckUrl('javascript:alert(1)'), UnsafeUrlError);
});

test('empty and malformed input is rejected', () => {
  assert.throws(() => normalizeCheckUrl(''), UnsafeUrlError);
  assert.throws(() => normalizeCheckUrl(null), UnsafeUrlError);
  assert.throws(() => normalizeCheckUrl('http://'), UnsafeUrlError);
});

test('embedded credentials are rejected', () => {
  assert.throws(() => normalizeCheckUrl('https://user:pass@example.com'), UnsafeUrlError);
});

test('private and loopback space is blocked', () => {
  for (const host of [
    'localhost',
    'app.localhost',
    'foo.internal',
    'printer.local',
    'metadata.google.internal',
    '127.0.0.1',
    '127.1.2.3',
    '0.0.0.0',
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.1',
    '169.254.169.254',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    'fd00::1',
    'fe80::1',
  ]) {
    assert.equal(isBlockedHost(host), true, `${host} should be blocked`);
    assert.throws(() => normalizeCheckUrl(`http://${host}`), UnsafeUrlError, `${host} should throw`);
  }
});

test('public hosts are allowed', () => {
  for (const host of [
    'example.com',
    '1.1.1.1',
    '8.8.8.8',
    '172.15.0.1',
    '172.32.0.1',
    '192.169.0.1',
    '11.0.0.1',
  ]) {
    assert.equal(isBlockedHost(host), false, `${host} should be allowed`);
  }
});

test('octets above 255 are treated as unsafe rather than parsed loosely', () => {
  assert.equal(isBlockedHost('999.1.1.1'), true);
});
