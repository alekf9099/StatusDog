/**
 * `/api/admin/:action` — everything an owner can write.
 *
 * One function rather than one per action, for two reasons. Vercel's Hobby plan
 * allows twelve serverless functions per deployment, so a file per action would
 * spend the budget on routing; and every owner write needs exactly the same four
 * gates, which belong in one place rather than copied into each new endpoint.
 *
 * The gates, in order:
 *
 *   1. POST — nothing here is safe to trigger by navigation
 *   2. same-origin with the custom header — checked *before* the session is read,
 *      so a cross-site page cannot make the browser spend its cookie here
 *   3. a valid session
 *   4. that address is on the owner allowlist, re-read from the environment on
 *      every request so removing it revokes access immediately
 *
 * Actions:
 *   note — the cause and remedy of an incident
 */
import { authorize, sameOriginWrite } from '../dist/auth/session.js';
import { findNote, publicNote, readNotes, upsertNote, writeNotes } from '../dist/store/notes.js';
import { resolveRoster } from '../dist/store/roster.js';
import { kvEnvNames, kvFromEnv } from '../dist/store/kv.js';
import { originOf } from '../dist/util/origin.js';
import { ROSTER } from '../dist/roster.data.js';

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body !== '') {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (chunks.length === 0) return null;
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Write the cause and remedy for an incident.
 *
 * The reason the admin surface exists: `src/store/incident.ts` records in detail
 * what was observed and deliberately refuses to guess why. This is the why.
 *
 * Clearing both fields deletes the note.
 */
async function note(req, res, body, email) {
  let target;
  try {
    target = resolveRoster(ROSTER).find((entry) => entry.id === body.target) ?? null;
  } catch (err) {
    res.status(500).json({ error: `Invalid monitors.json: ${err.message}` });
    return;
  }
  if (!target) {
    res.status(404).json({ error: `Unknown target "${body.target ?? ''}".` });
    return;
  }

  // The id is an incident's confirmed-down timestamp. Requiring it to parse keeps
  // arbitrary strings from accumulating as orphaned notes.
  const incidentId = String(body.incident ?? '');
  if (!Number.isFinite(Date.parse(incidentId))) {
    res.status(400).json({ error: 'incident must be the incident timestamp.' });
    return;
  }

  const kv = kvFromEnv();
  if (!kv) {
    res.status(503).json({
      error: 'No key-value store is configured, so notes cannot be saved.',
      hint: `Set one of these credential pairs: ${kvEnvNames().join(', ')}`,
    });
    return;
  }

  try {
    const log = await readNotes(kv, target.id);
    const next = upsertNote(log, {
      incidentId,
      cause: body.cause,
      action: body.action,
      author: email,
      at: new Date().toISOString(),
    });
    await writeNotes(kv, next);

    const saved = findNote(next, incidentId);
    res.status(200).json({
      saved: saved !== null,
      // Echo back what a reader would see, so the UI never handles the author.
      note: saved ? publicNote(saved) : null,
    });
  } catch (err) {
    res.status(502).json({ error: `Could not save the note: ${err.message}` });
  }
}

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');

  if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
    res.status(405).json({ error: 'Use POST.' });
    return;
  }

  if (!sameOriginWrite(req.headers ?? {}, originOf(req, process.env))) {
    res.status(403).json({ error: 'Cross-site writes are refused.' });
    return;
  }

  const auth = authorize(req.headers?.cookie, process.env);
  if (!auth.ok) {
    // 503 when there is no admin surface at all, 401 when there is and you are not
    // in it. Both stay quiet about which address would have worked.
    res.status(auth.reason === 'not-configured' ? 503 : 401).json({
      error: auth.reason === 'not-configured'
        ? 'The admin surface is not configured.'
        : 'Sign in as an owner to make changes.',
    });
    return;
  }

  const body = await readBody(req);
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'A JSON body is required.' });
    return;
  }

  const url = new URL(req.url ?? '/', 'http://localhost');
  const action = url.searchParams.get('action') ?? url.pathname.split('/').filter(Boolean).pop();

  switch (action) {
    case 'note':
      return note(req, res, body, auth.email);
    default:
      res.status(404).json({ error: 'Unknown admin action.' });
  }
}
