/**
 * `POST /api/admin/note` — write the cause and remedy for an incident.
 *
 * The first write endpoint this project has ever had, and the reason the admin
 * surface exists: `src/store/incident.ts` records in detail what was observed and
 * deliberately refuses to guess why. This is where a person supplies the why.
 *
 * Body: `{ "target": "<roster id>", "incident": "<ISO timestamp>",
 *          "cause": "...", "action": "..." }`
 *
 * Clearing both fields deletes the note.
 *
 * Four gates before anything is stored: the method, the CSRF check, the session,
 * and the owner allowlist. The allowlist is re-read on every request, so removing
 * an address from the environment revokes it immediately.
 */
import { authorize, sameOriginWrite } from '../../dist/auth/session.js';
import { readNotes, upsertNote, writeNotes, findNote, publicNote } from '../../dist/store/notes.js';
import { resolveRoster } from '../../dist/store/roster.js';
import { kvEnvNames, kvFromEnv } from '../../dist/store/kv.js';
import { originOf } from '../../dist/util/origin.js';
import { ROSTER } from '../../dist/roster.data.js';

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

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');

  if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
    res.status(405).json({ error: 'Use POST.' });
    return;
  }

  // Before the session is even looked at: a cross-site page must not be able to
  // make the browser spend its cookie here.
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
        : 'Sign in as an owner to write notes.',
    });
    return;
  }

  const body = await readBody(req);
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'A JSON body is required.' });
    return;
  }

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
      author: auth.email,
      at: new Date().toISOString(),
    });
    await writeNotes(kv, next);

    const saved = findNote(next, incidentId);
    res.status(200).json({
      saved: saved !== null,
      // Echo back what a reader would see, so the UI never shows the author.
      note: saved ? publicNote(saved) : null,
    });
  } catch (err) {
    res.status(502).json({ error: `Could not save the note: ${err.message}` });
  }
}
