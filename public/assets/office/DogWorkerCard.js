/**
 * DogWorkerCard — one colleague in the roster under the room.
 *
 * The room on the canvas is for looking at; this card is the same colleague as a
 * real button, with the facts written out, so a keyboard or a screen reader gets
 * everything the picture shows. Renders to an HTML string: the roster is rebuilt
 * on each poll, and swapping innerHTML once is simpler than diffing it.
 */
import { escapeHtml, formatMs } from '../statusdog.js';
import { t, getLanguage } from '../i18n.js';
import { resolveDog } from './dogs.js';
import { avatarUrl } from './pixel/sprites.js';

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

/** The colleague's pixel portrait. Its name is written beside it, so it is decorative. */
function avatarHtml(dog, className) {
  return `<img class="${className}" src="${avatarUrl(dog)}" alt="" width="32" height="34" draggable="false">`;
}

/**
 * Everything written on the card: who this is, what they watch, how it is going.
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
 * A colleague's card, as a button: clicking it opens the report, as clicking them
 * in the room does, and it is reachable by keyboard for free.
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
            aria-label="${escapeHtml(label)}">
      ${avatarHtml(dog, 'desk-avatar')}
      ${plate(worker)}
    </button>`;
}

/** The same portrait, for the report header. */
export function renderDogChip(worker) {
  return `<div class="dog-chip" data-mood="${escapeHtml(worker.mood.mood)}" aria-hidden="true">${avatarHtml(worker.dog, 'chip-face')}</div>`;
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
