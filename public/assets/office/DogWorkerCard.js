/**
 * DogWorkerCard — one dog at one desk.
 *
 * Renders to an HTML string rather than nodes: the office re-renders a whole
 * floor on each poll, and swapping innerHTML once is both simpler and less
 * janky than diffing five desks. The mood lives in a `data-mood` attribute so
 * every animation decision belongs to CSS, not to JavaScript.
 *
 * The dog itself is inline SVG — no images, nothing to fetch, and its coat comes
 * from CSS custom properties so a target keeps its colours in both themes.
 */
import { escapeHtml, formatMs } from '../statusdog.js';
import { t, getLanguage } from '../i18n.js';
import { resolveDog } from './dogs.js';

/**
 * How long since this dog last had a bad day.
 *
 * A percentage is the honest measure and a poor motivator; a run of clean days is
 * something a reader notices breaking. Shown only when there is a record to show —
 * an intern with no server history, or a dog that is down right now, says nothing
 * rather than claiming a streak it has not got.
 */
function streakLine(tenure) {
  if (!tenure || tenure.streak === null || tenure.streak <= 0) return '';
  const text = tenure.record
    ? t('office.streak.record', { n: tenure.streak })
    : t('office.streak.days', { n: tenure.streak });
  return `<div class="desk-streak${tenure.record ? ' record' : ''}">${escapeHtml(text)}</div>`;
}

/**
 * The dog, drawn once and reused. Sits behind the desk, so the lower body being
 * clipped is intentional.
 */
function dogSvg(dog) {
  // Geometry note: the head sits high in the viewBox on purpose. The desk and
  // monitor are drawn over the lower third, so anything below y≈70 is hidden —
  // which is what makes the dog read as sitting *behind* a desk rather than
  // floating in front of one.
  return `
    <svg class="desk-dog dog" viewBox="0 0 100 120" aria-hidden="true"
         style="--coat:${dog.coat.body};--coat-ear:${dog.coat.ear};--coat-patch:${dog.coat.patch};--beat:${dog.beatOffsetMs}ms">
      <!-- tail, behind everything, sticking out to one side -->
      <g class="dog-tail">
        <path d="M74 92 q18 -4 20 -20 q1 -9 -6 -9 q-6 0 -4 8 q2 10 -12 14 z" fill="var(--coat-ear)"/>
      </g>

      <!-- shoulders and body -->
      <ellipse class="dog-body" cx="50" cy="100" rx="30" ry="24"/>

      <!-- floppy ears, hung from the sides of the head and drawn behind it -->
      <g class="dog-ears">
        <path class="dog-ear" d="M26 30 q-13 2 -14 20 q-1 16 9 20 q7 3 8 -8 q1 -14 3 -24 z"/>
        <path class="dog-ear" d="M74 30 q13 2 14 20 q1 16 -9 20 q-7 3 -8 -8 q-1 -14 -3 -24 z"/>
      </g>

      <!-- head -->
      <ellipse class="dog-head" cx="50" cy="42" rx="26" ry="24"/>

      <!-- brow patch, to give the coat some structure -->
      <ellipse class="dog-snout" cx="50" cy="26" rx="15" ry="7" opacity=".55"/>

      <!-- muzzle, well clear of the monitor -->
      <ellipse class="dog-snout" cx="50" cy="54" rx="15" ry="11"/>
      <ellipse class="dog-nose" cx="50" cy="49" rx="4.6" ry="3.4"/>
      <path class="dog-mouth" d="M50 53 v4 M50 57 q-5 4 -8 0 M50 57 q5 4 8 0"
            fill="none" stroke="#2b2f36" stroke-width="1.6" stroke-linecap="round"/>
      <path class="dog-tongue" d="M46 60 q4 7 8 0 z"/>

      <!-- eyes, with lids that blink -->
      <circle class="dog-eye" cx="39" cy="38" r="3.6"/>
      <circle class="dog-eye" cx="61" cy="38" r="3.6"/>
      <circle class="dog-glint" cx="40.4" cy="36.6" r="1.2" fill="#ffffff" opacity=".85"/>
      <circle class="dog-glint" cx="62.4" cy="36.6" r="1.2" fill="#ffffff" opacity=".85"/>
      <rect class="dog-eyelid" x="35.4" y="34.4" width="7.2" height="7.2" rx="3.6"/>
      <rect class="dog-eyelid" x="57.4" y="34.4" width="7.2" height="7.2" rx="3.6"/>

      <!-- brows: the cheapest way to carry an expression -->
      <g class="dog-brows">
        <path d="M33 28 q6 -4 11 -1" fill="none" stroke="var(--coat-ear)" stroke-width="2" stroke-linecap="round"/>
        <path d="M67 28 q-6 -4 -11 -1" fill="none" stroke="var(--coat-ear)" stroke-width="2" stroke-linecap="round"/>
      </g>

      ${accessorySvg(dog.accessory)}
    </svg>`;
}

/** Paws resting on the desktop. Drawn outside the SVG so the desk cannot clip them. */
function pawsHtml() {
  return '<span class="desk-paws" aria-hidden="true"><i></i><i></i></span>';
}

function accessorySvg(accessory) {
  switch (accessory) {
    case 'collar':
      return '<rect class="dog-collar" x="34" y="70" width="32" height="6" rx="3"/>';
    case 'scarf':
      return '<path class="dog-collar" d="M32 68 q18 9 36 0 l3 9 q-21 10 -42 0 z"/>';
    case 'cap':
      return '<path class="dog-collar" d="M28 22 q22 -17 44 0 q-22 -6 -44 0 z"/>';
    default:
      return '';
  }
}

/**
 * Everything shown under the desk: who this is, what they watch, how it is going.
 */
function plate(worker) {
  const { monitor, mood, dog } = worker;
  const name = dog.names[getLanguage()] ?? dog.names.en;
  const intern = monitor.kind === 'intern'
    ? `<span class="desk-badge-intern">${escapeHtml(t('office.intern'))}</span>`
    : '';
  const latency = mood.lastMs === null
    ? ''
    : `<div class="desk-latency">${formatMs(mood.lastMs)}${
        mood.mood === 'strained' && mood.baselineMs
          ? ` <span aria-hidden="true">↑</span> ${formatMs(mood.baselineMs)}`
          : ''
      }</div>`;

  return `
    <div class="desk-plate">
      <div class="desk-dogname">${escapeHtml(name)}${intern}</div>
      <div class="desk-site" title="${escapeHtml(monitor.url)}">${escapeHtml(monitor.name)}</div>
      <div class="desk-status">
        <span class="dot"></span>${escapeHtml(t(`office.mood.${mood.mood}.short`))}
      </div>
      ${latency}
      ${streakLine(monitor.tenure)}
    </div>`;
}

/**
 * A worker's desk, as a button: clicking it opens the report, and it is reachable
 * by keyboard for free.
 */
export function renderDogWorkerCard(worker) {
  const { monitor, mood, dog } = worker;
  const label = t('office.desk.label', {
    dog: dog.names[getLanguage()] ?? dog.names.en,
    site: monitor.name,
    status: t(`office.mood.${mood.mood}.short`),
  });

  return `
    <button type="button" class="desk" data-mood="${escapeHtml(mood.mood)}"
            data-worker-id="${escapeHtml(monitor.uid)}"
            ${worker.arriving ? 'data-arriving="true"' : ''}
            style="--coat:${dog.coat.body}"
            aria-label="${escapeHtml(label)}">
      <div class="desk-scene">
        ${dogSvg(dog)}
        ${pawsHtml()}
        <span class="dog-prop prop-mug" aria-hidden="true"><i></i></span>
        <span class="dog-prop prop-sweat" aria-hidden="true"></span>
        <span class="dog-prop prop-question" aria-hidden="true">❓</span>
        <span class="dog-prop prop-alarm" aria-hidden="true">🚨</span>
        <span class="dog-prop prop-zzz" aria-hidden="true">💤</span>
        <div class="desk-monitor" aria-hidden="true"></div>
        <div class="desk-monitor-stand" aria-hidden="true"></div>
        <div class="desk-furniture" aria-hidden="true"></div>
      </div>
      ${plate(worker)}
    </button>`;
}

/** The same dog, small, for the report header. */
export function renderDogChip(worker) {
  return `<div class="dog-chip" data-mood="${escapeHtml(worker.mood.mood)}">${dogSvg(worker.dog)}</div>`;
}

/**
 * Attach a dog to any monitor-shaped object.
 *
 * `override` is whatever has been stored for this worker — a rename, a re-rolled
 * look, or nothing at all, in which case the dog falls out of the id hash.
 */
export function makeWorker(monitor, mood, override = null, extras = {}) {
  return { monitor, mood, dog: resolveDog(monitor.id, override), override, ...extras };
}
