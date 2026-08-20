import assert from 'node:assert/strict';
import { test } from 'node:test';
import { badgeSvg, COLORS, textWidth, toneForState, toneForUptime } from '../src/badge/svg.js';

/* ---------------- sizing ---------------- */

test('wider text produces a wider badge', () => {
  const narrow = badgeSvg({ label: 'up', value: '1%', tone: 'up' });
  const wide = badgeSvg({ label: 'uptime', value: '99.94%', tone: 'up' });
  const widthOf = (svg: string) => Number(/width="(\d+)"/.exec(svg)![1]);
  assert.ok(widthOf(wide) > widthOf(narrow));
});

test('every box carries padding, so text cannot sit against the edge', () => {
  // Without a font engine the width is an estimate, so the slack is what protects
  // against clipping. Each box must be comfortably wider than its text.
  const svg = badgeSvg({ label: 'uptime', value: '99.94%', tone: 'up' });
  const rects = boxesOf(svg);
  assert.ok(rects[0]!.width >= textWidth('uptime') + 16, `label ${rects[0]!.width}`);
  assert.ok(rects[1]!.width >= textWidth('99.94%') + 16, `value ${rects[1]!.width}`);
  assert.equal(textWidth(''), 0);
});

test('full-width characters are counted as full width', () => {
  // A Korean label sized as if it were Latin would overflow its box.
  assert.ok(textWidth('가동률') > textWidth('abc') * 1.5);
});

/** The two visible boxes, skipping the clip-path rectangle that precedes them. */
function boxesOf(svg: string): { x: number; width: number }[] {
  const group = svg.slice(svg.indexOf('<g clip-path'));
  return [...group.matchAll(/<rect (?:x="(\d+)" )?width="(\d+)"/g)]
    .map((match) => ({ x: Number(match[1] ?? 0), width: Number(match[2]) }));
}

test('the two boxes tile the whole badge exactly', () => {
  const svg = badgeSvg({ label: 'uptime', value: '99.9%', tone: 'up' });
  const total = Number(/^<svg[^>]*width="(\d+)"/.exec(svg)![1]);
  const rects = boxesOf(svg);

  const label = rects[0]!;
  const value = rects[1]!;
  assert.equal(label.x, 0);
  assert.equal(value.x, label.width, 'the value box starts where the label box ends');
  assert.equal(label.width + value.width, total, 'and together they fill the badge');
});

/* ---------------- colour ---------------- */

test('uptime thresholds match the status page', () => {
  assert.equal(toneForUptime(100), 'up');
  assert.equal(toneForUptime(99.5), 'up');
  assert.equal(toneForUptime(99.49), 'fair');
  assert.equal(toneForUptime(97), 'fair');
  assert.equal(toneForUptime(96.9), 'down');
  assert.equal(toneForUptime(0), 'down');
});

test('no data is grey, not red', () => {
  // Zero percent is a claim; no data is not, and the badge must not confuse them.
  assert.equal(toneForUptime(null), 'unknown');
  assert.equal(toneForUptime(undefined), 'unknown');
  assert.equal(toneForUptime(Number.NaN), 'unknown');
  assert.equal(toneForState('unknown'), 'unknown');
  assert.equal(toneForState(null), 'unknown');
});

test('state maps to the same palette as the site', () => {
  assert.equal(toneForState('up'), 'up');
  assert.equal(toneForState('down'), 'down');
  assert.ok(badgeSvg({ label: 'status', value: 'down', tone: 'down' }).includes(COLORS.down));
});

/* ---------------- output shape ---------------- */

test('the badge is one self-contained SVG with no script or external reference', () => {
  const svg = badgeSvg({ label: 'uptime', value: '99.9%', tone: 'up' });
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(svg.trimEnd().endsWith('</svg>'));
  assert.ok(!/<script/i.test(svg));
  assert.ok(!/https?:\/\/(?!www\.w3\.org)/i.test(svg), 'no external hosts');
  // Internal `url(#gradient)` references are fine; a fetched one is not.
  assert.ok(!/@import|url\(\s*['"]?(?:https?:|\/\/|data:)/i.test(svg), 'no fetched font or image');
});

test('it is announced as one phrase rather than two loose words', () => {
  const svg = badgeSvg({ label: 'uptime', value: '99.9%', tone: 'up' });
  assert.ok(svg.includes('role="img"'));
  assert.ok(svg.includes('aria-label="uptime: 99.9%"'));
  assert.ok(svg.includes('<title>uptime: 99.9%</title>'));
});

test('markup in a label cannot escape into the SVG', () => {
  const svg = badgeSvg({ label: '<script>x</script>', value: '"&\'<>', tone: 'up' });
  assert.ok(!svg.includes('<script>'));
  assert.ok(svg.includes('&lt;script&gt;'));
  assert.ok(svg.includes('&quot;&amp;&apos;&lt;&gt;'));
});

test('an absurdly long label is truncated rather than drawn off-badge', () => {
  const svg = badgeSvg({ label: 'x'.repeat(500), value: 'y'.repeat(500), tone: 'up' });
  const total = Number(/^<svg[^>]*width="(\d+)"/.exec(svg)![1]);
  assert.ok(total < 700, `got ${total}`);
});

test('an unknown tone falls back to grey rather than producing invalid markup', () => {
  const svg = badgeSvg({ label: 'a', value: 'b', tone: 'nonsense' as 'up' });
  assert.ok(svg.includes(COLORS.unknown));
});
