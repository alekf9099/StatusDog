/**
 * The dashboard is a single self-contained HTML document with no build step and
 * no external requests — it polls `/api/status` and renders from JSON.
 */
export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>StatusDog</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f6f7f9; --card: #fff; --fg: #1b1f24; --muted: #626b76; --border: #e3e6ea;
    --up: #2da44e; --down: #e5534b; --unknown: #8b949e;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0f1216; --card: #171b21; --fg: #e9edf2; --muted: #98a2ae; --border: #262c34; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg);
    font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  header { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap;
    padding: 24px 28px; border-bottom: 1px solid var(--border); background: var(--card); }
  header h1 { margin: 0; font-size: 20px; letter-spacing: -.01em; }
  header .sub { color: var(--muted); font-size: 13px; }
  header .spacer { flex: 1; }
  button { font: inherit; padding: 6px 12px; border-radius: 8px; cursor: pointer;
    border: 1px solid var(--border); background: var(--card); color: var(--fg); }
  button:hover { border-color: var(--muted); }
  main { padding: 24px 28px; display: grid; gap: 16px;
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 18px 20px; }
  .row { display: flex; align-items: center; gap: 10px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; flex: none; background: var(--unknown); }
  .dot.up { background: var(--up); } .dot.down { background: var(--down); }
  .name { font-weight: 600; }
  .state { margin-left: auto; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
  .url { color: var(--muted); font-size: 13px; word-break: break-all; margin: 6px 0 14px; }
  .url a { color: inherit; }
  .spark { display: flex; gap: 2px; align-items: flex-end; height: 34px; margin-bottom: 12px; }
  .spark i { flex: 1 1 0; min-width: 2px; border-radius: 2px; background: var(--up); opacity: .85; }
  .spark i.bad { background: var(--down); }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
    border-top: 1px solid var(--border); padding-top: 12px; }
  .grid div { font-size: 13px; }
  .grid span { display: block; color: var(--muted); font-size: 11px;
    text-transform: uppercase; letter-spacing: .06em; }
  .msg { margin-top: 12px; padding: 8px 10px; border-radius: 8px; font-size: 13px;
    background: color-mix(in srgb, var(--down) 12%, transparent); color: var(--down); }
  .empty, .error { padding: 40px; text-align: center; color: var(--muted); grid-column: 1 / -1; }
  footer { padding: 0 28px 28px; color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
<header>
  <h1>StatusDog</h1>
  <span class="sub" id="summary">loading…</span>
  <span class="spacer"></span>
  <button id="refresh" type="button">Check all now</button>
</header>
<main id="targets"><div class="empty">Loading…</div></main>
<footer>Auto-refreshing every 5s · <a href="/api/status">/api/status</a></footer>
<script>
(function () {
  var targets = document.getElementById('targets');
  var summary = document.getElementById('summary');

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function ms(value) {
    if (value == null) return '–';
    return value < 1000 ? Math.round(value) + 'ms' : (value / 1000).toFixed(2) + 's';
  }

  function ago(iso) {
    if (!iso) return 'never';
    var delta = Date.now() - new Date(iso).getTime();
    if (delta < 5000) return 'just now';
    if (delta < 60000) return Math.round(delta / 1000) + 's ago';
    if (delta < 3600000) return Math.round(delta / 60000) + 'm ago';
    return Math.round(delta / 3600000) + 'h ago';
  }

  function spark(history) {
    var recent = history.slice(-40);
    if (!recent.length) return '';
    var max = Math.max.apply(null, recent.map(function (r) { return r.ms || 0; })) || 1;
    return '<div class="spark">' + recent.map(function (r) {
      var height = Math.max(8, Math.round(((r.ms || 0) / max) * 100));
      return '<i class="' + (r.ok ? '' : 'bad') + '" style="height:' + height + '%" title="' +
        esc(r.t) + ' · ' + (r.ok ? 'ok' : esc(r.reason || 'failed')) + ' · ' + ms(r.ms) + '"></i>';
    }).join('') + '</div>';
  }

  function card(item) {
    var s = item.status;
    var last = s.lastResult;
    var problem = last && !last.ok ? '<div class="msg">' + esc(last.message || 'Check failed') + '</div>' : '';
    return '<section class="card">' +
      '<div class="row"><span class="dot ' + esc(s.state) + '"></span>' +
      '<span class="name">' + esc(s.name) + '</span>' +
      '<span class="state">' + esc(s.state) + '</span></div>' +
      '<div class="url"><a href="' + esc(s.url) + '" target="_blank" rel="noreferrer noopener">' + esc(s.url) + '</a></div>' +
      spark(item.history) +
      '<div class="grid">' +
        '<div><span>Uptime</span>' + (s.stats.uptimePct == null ? '–' : s.stats.uptimePct + '%') + '</div>' +
        '<div><span>Response</span>' + ms(last ? last.responseTimeMs : null) + '</div>' +
        '<div><span>Checked</span>' + ago(s.stats.lastCheckedAt) + '</div>' +
      '</div>' + problem +
    '</section>';
  }

  function render(data) {
    var items = data.targets || [];
    var down = items.filter(function (i) { return i.status.state === 'down'; }).length;
    summary.textContent = items.length + ' target' + (items.length === 1 ? '' : 's') +
      ' · ' + (down ? down + ' down' : 'all healthy');
    targets.innerHTML = items.length
      ? items.map(card).join('')
      : '<div class="empty">No targets configured.</div>';
  }

  function load() {
    fetch('/api/status?history=40', { cache: 'no-store' })
      .then(function (res) { return res.json(); })
      .then(render)
      .catch(function (err) {
        targets.innerHTML = '<div class="error">Could not reach the StatusDog API: ' + esc(err.message) + '</div>';
      });
  }

  document.getElementById('refresh').addEventListener('click', function () {
    this.disabled = true;
    fetch('/api/check', { method: 'POST' })
      .then(load)
      .catch(function () {})
      .then(function () { document.getElementById('refresh').disabled = false; });
  });

  load();
  setInterval(load, 5000);
})();
</script>
</body>
</html>
`;
