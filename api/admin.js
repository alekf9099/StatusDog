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
 *   note        — the cause and remedy of an incident
 *   test-alert  — send a test message to every configured destination
 *   security    — read the security tab; a POST like the rest, so it sits behind
 *                 the same four gates rather than a weaker read-only path
 */
import { authorize, sameOriginWrite } from '../dist/auth/session.js';
import { findNote, publicNote, readNotes, upsertNote, writeNotes } from '../dist/store/notes.js';
import { resolveRoster } from '../dist/store/roster.js';
import { kvEnvNames, kvFromEnv } from '../dist/store/kv.js';
import { readAll } from '../dist/store/uptime.js';
import { dispatchAlerts, notifiersFromEnv } from '../dist/notify/dispatch.js';
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

/** Long enough to stop a double-click becoming two messages in the channel. */
const TEST_COOLDOWN_MS = 30_000;
const TEST_COOLDOWN_KEY = 'statusdog:v1:admin:last-test-alert';

/**
 * Send one clearly-labelled test message to every configured destination.
 *
 * The alert path only ever fires on a confirmed outage, so without this a webhook
 * that was mistyped, revoked or pointed at a deleted channel stays silently broken
 * until the day it is needed. This is the check that can be done on a quiet day.
 *
 * The response names each destination by its origin only — the path of a Slack,
 * Google Chat or Discord webhook is its credential — and delivery errors are
 * redacted the same way before they leave the server.
 */
async function testAlert(req, res, email) {
  const notifiers = notifiersFromEnv();
  if (notifiers.length === 0) {
    res.status(200).json({ notifiers: 0, attempted: 0, delivered: 0, failed: 0, outcomes: [] });
    return;
  }

  // A shared cooldown rather than a per-browser one, so two open tabs cannot
  // double-post either. Without a store there is simply no cooldown.
  const kv = kvFromEnv();
  if (kv) {
    try {
      const last = Number(await kv.get(TEST_COOLDOWN_KEY));
      const waitMs = Number.isFinite(last) ? last + TEST_COOLDOWN_MS - Date.now() : 0;
      if (waitMs > 0) {
        res.status(429).json({ error: 'cooldown', retryAfterSeconds: Math.ceil(waitMs / 1000) });
        return;
      }
      await kv.set(TEST_COOLDOWN_KEY, String(Date.now()));
    } catch {
      // A store hiccup must not block the one check meant to catch broken alerting.
    }
  }

  const at = new Date().toISOString();
  const summary =
    '🐕 StatusDog 테스트 알림 / test alert — '
    + '이 메시지가 보이면 장애 알림이 이 채널로 정상 도착합니다. '
    + 'If you can read this, outage alerts reach this channel.';

  const result = await dispatchAlerts(notifiers, [{
    kind: 'test',
    severity: 'info',
    summary,
    target: null,
    at,
    data: { origin: originOf(req, process.env) },
  }]);

  res.status(200).json({
    notifiers: notifiers.length,
    attempted: result.attempted,
    delivered: result.delivered,
    failed: result.failed,
    outcomes: result.outcomes.map((outcome) => ({
      notifier: outcome.notifier,
      delivered: outcome.delivered,
      error: outcome.error ?? null,
    })),
    at,
  });
}

/**
 * What the security tab shows.
 *
 * Behind the owner gate even though every fact in it is public: anyone can read a
 * site's headers, but a curated list of what is missing is a to-do list for an
 * attacker, and it does not belong on a page anyone can open.
 */
async function security(req, res) {
  let targets;
  try {
    targets = resolveRoster(ROSTER);
  } catch (err) {
    res.status(500).json({ error: `Invalid monitors.json: ${err.message}` });
    return;
  }
  const kv = kvFromEnv();
  if (!kv) {
    res.status(503).json({
      error: 'No key-value store is configured, so nothing has been observed yet.',
      hint: `Set one of these credential pairs: ${kvEnvNames().join(', ')}`,
    });
    return;
  }
  try {
    const entries = await readAll(kv, targets);
    res.status(200).json({
      generatedAt: new Date().toISOString(),
      targets: entries.map((entry) => {
        const security = entry.security;
        // seenIds is bookkeeping for the next lookup, and the bulk of the value.
        const ct = security?.ct ? { ...security.ct, seenIds: undefined, seen: security.ct.seenIds?.length ?? 0 } : null;
        return {
          id: entry.id,
          name: entry.name,
          url: entry.url,
          state: entry.state,
          security: security ? { ...security, ct } : null,
        };
      }),
    });
  } catch (err) {
    res.status(502).json({ error: `Could not read the store: ${err.message}` });
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
    case 'test-alert':
      return testAlert(req, res, auth.email);
    case 'security':
      return security(req, res);
    default:
      res.status(404).json({ error: 'Unknown admin action.' });
  }
}
