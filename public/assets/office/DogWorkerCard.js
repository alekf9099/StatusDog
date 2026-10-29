/**
 * DogWorkerCard — one dog at one desk.
 *
 * Renders to an HTML string rather than nodes: the office re-renders a whole
 * floor on each poll, and swapping innerHTML once is both simpler and less
 * janky than diffing five desks. The mood lives in a `data-mood` attribute so
 * every animation decision belongs to CSS, not to JavaScript.
 *
 * The animal is a small WebP portrait from Microsoft's Fluent Emoji 3D set (MIT),
 * served from this site; see animals/LICENSE.txt.
 */
import { escapeHtml, formatMs } from '../statusdog.js';
import { t, getLanguage } from '../i18n.js';
import { resolveDog, speciesImage } from './dogs.js';

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
 * The animal, behind the desk.
 *
 * A Fluent Emoji 3D portrait (MIT, Microsoft) in a wrapper that CSS animates per
 * mood. The image is the same for every mood on purpose — it cannot change its
 * face — so how it moves and what appears beside it carry the state instead.
 * Its name is in the desk's own label, so the image itself is decorative.
 */
function animalHtml(dog) {
  return `
    <span class="desk-dog dog" data-species="${escapeHtml(dog.species.key)}" style="--beat:${dog.beatOffsetMs}ms" aria-hidden="true">
      <img src="${speciesImage(dog.species.key)}" alt="" width="160" height="160" decoding="async" draggable="false">
    </span>`;
}

/** One prop per mood; CSS decides which is visible, so a re-render never flickers. */
function propsHtml() {
  return ['mug', 'sweat', 'question', 'alarm', 'zzz']
    .map((name) => `<img class="dog-prop prop-${name}" src="/assets/office/animals/prop-${name}.webp" alt="" width="96" height="96" decoding="async" draggable="false" aria-hidden="true">`)
    .join('');
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
            style="--beat:${dog.beatOffsetMs}ms"
            aria-label="${escapeHtml(label)}">
      <div class="desk-scene">
        ${animalHtml(dog)}
        ${propsHtml()}
        <div class="desk-monitor" aria-hidden="true"></div>
        <div class="desk-monitor-stand" aria-hidden="true"></div>
        <div class="desk-furniture" aria-hidden="true"></div>
      </div>
      ${plate(worker)}
    </button>`;
}

/** The same dog, small, for the report header. */
export function renderDogChip(worker) {
  return `<div class="dog-chip" data-mood="${escapeHtml(worker.mood.mood)}">${animalHtml(worker.dog)}</div>`;
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
