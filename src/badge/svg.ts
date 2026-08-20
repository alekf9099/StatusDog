/**
 * A status badge, drawn by hand.
 *
 * The point of a badge is that it lives somewhere else — a README, a wiki, someone
 * else's dashboard — so it has to be a single self-contained SVG with no script, no
 * external font and no second request. That rules out a library and leaves string
 * building, which for a two-box badge is about forty lines.
 *
 * Text width is the only hard part: without a font engine the boxes have to be
 * sized from a per-character estimate. The table below is measured from the 11px
 * sans-serif stack browsers actually use, and it errs wide — a badge with a little
 * too much padding looks intentional, one with clipped text looks broken.
 */

/** Rough advance width in pixels at 11px, by character class. */
const WIDE = new Set('MWmw@%'.split(''));
const NARROW = new Set("iljI!.,:;'|`()[]{}/\\ ".split(''));

export function textWidth(text: string): number {
  let width = 0;
  for (const char of String(text ?? '')) {
    if (NARROW.has(char)) width += 3.2;
    else if (WIDE.has(char)) width += 9.5;
    else if (char >= '0' && char <= '9') width += 6.2;
    // Hangul and other full-width characters take about twice a Latin letter.
    else if (char.charCodeAt(0) > 0x2e7f) width += 11;
    else width += 6.6;
  }
  return Math.ceil(width);
}

/** Badge colours, matched to the site's own state palette. */
export const COLORS = {
  up: '#2da44e',
  fair: '#bf8700',
  down: '#cf222e',
  unknown: '#6e7781',
  label: '#41474d',
} as const;

export type BadgeTone = keyof Omit<typeof COLORS, 'label'>;

/**
 * Which colour an uptime percentage earns.
 *
 * The thresholds match the status page, so a badge and the page it links to never
 * disagree about whether a month was good.
 */
export function toneForUptime(pct: number | null | undefined): BadgeTone {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return 'unknown';
  if (pct >= 99.5) return 'up';
  if (pct >= 97) return 'fair';
  return 'down';
}

export function toneForState(state: string | null | undefined): BadgeTone {
  if (state === 'up') return 'up';
  if (state === 'down') return 'down';
  return 'unknown';
}

const HEIGHT = 20;
const PAD = 9;

function escapeXml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface BadgeOptions {
  label: string;
  value: string;
  tone: BadgeTone;
}

/**
 * A two-box badge: grey label on the left, coloured value on the right.
 *
 * `role="img"` with a title, because a badge is read aloud as one phrase — a screen
 * reader announcing two loose words is worse than announcing nothing.
 */
export function badgeSvg(options: BadgeOptions): string {
  const label = String(options.label ?? '').slice(0, 40);
  const value = String(options.value ?? '').slice(0, 40);
  const fill = COLORS[options.tone] ?? COLORS.unknown;

  const labelWidth = textWidth(label) + PAD * 2;
  const valueWidth = textWidth(value) + PAD * 2;
  const total = labelWidth + valueWidth;
  const alt = `${label}: ${value}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${HEIGHT}" viewBox="0 0 ${total} ${HEIGHT}" role="img" aria-label="${escapeXml(alt)}">
  <title>${escapeXml(alt)}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#fff" stop-opacity=".7"/>
    <stop offset=".1" stop-color="#aaa" stop-opacity=".1"/>
    <stop offset=".9" stop-color="#000" stop-opacity=".3"/>
    <stop offset="1" stop-color="#000" stop-opacity=".5"/>
  </linearGradient>
  <clipPath id="r"><rect width="${total}" height="${HEIGHT}" rx="3"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="${HEIGHT}" fill="${COLORS.label}"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="${HEIGHT}" fill="${fill}"/>
    <rect width="${total}" height="${HEIGHT}" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif" font-size="11">
    <text x="${labelWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${escapeXml(label)}</text>
    <text x="${labelWidth / 2}" y="14">${escapeXml(label)}</text>
    <text x="${labelWidth + valueWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${escapeXml(value)}</text>
    <text x="${labelWidth + valueWidth / 2}" y="14">${escapeXml(value)}</text>
  </g>
</svg>`;
}
