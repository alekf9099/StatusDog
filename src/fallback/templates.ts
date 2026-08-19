/**
 * Built-in fallback pages.
 *
 * They are inlined as strings (rather than shipped as files) so the fallback
 * server can start with no filesystem access at all — the one moment you least
 * want another moving part.
 *
 * Placeholders: {{title}} {{message}} {{targetName}} {{targetUrl}}
 * {{statusCode}} {{lastChecked}} {{retryAfterSeconds}} {{year}} plus anything
 * under `fallback.vars`.
 */

interface ShellOptions {
  accent: string;
  glyph: string;
  body: string;
  /** Emit a `<meta http-equiv="refresh">` so the page reloads on its own. */
  autoRefresh?: boolean;
}

const shell = ({ accent, glyph, body, autoRefresh = false }: ShellOptions) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
${autoRefresh ? '<meta http-equiv="refresh" content="{{retryAfterSeconds}}">\n' : ''}<title>{{title}}</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f6f7f9;
    --card: #ffffff;
    --fg: #1b1f24;
    --muted: #626b76;
    --border: #e3e6ea;
    --accent: ${accent};
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f1216;
      --card: #171b21;
      --fg: #e9edf2;
      --muted: #98a2ae;
      --border: #262c34;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 24px;
    background: var(--bg);
    color: var(--fg);
    font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .card {
    width: min(560px, 100%);
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 40px 36px;
    text-align: center;
    box-shadow: 0 1px 2px rgba(0,0,0,.04), 0 12px 32px rgba(0,0,0,.06);
  }
  .glyph { font-size: 56px; line-height: 1; margin-bottom: 16px; }
  h1 { margin: 0 0 12px; font-size: 24px; letter-spacing: -.01em; }
  p { margin: 0 0 8px; color: var(--muted); }
  .bar { height: 4px; border-radius: 999px; background: var(--border); overflow: hidden; margin: 28px 0 20px; }
  .bar span { display: block; height: 100%; width: 40%; border-radius: 999px; background: var(--accent); animation: slide 1.8s ease-in-out infinite; }
  @keyframes slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(250%); } }
  @media (prefers-reduced-motion: reduce) { .bar span { animation: none; width: 100%; } }
  .meta { margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border); font-size: 13px; color: var(--muted); }
  .meta code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .brand { margin-top: 18px; font-size: 12px; color: var(--muted); }
</style>
</head>
<body>
  <main class="card" role="main">
    <div class="glyph" aria-hidden="true">${glyph}</div>
${body}
    <div class="meta">
      <div>{{targetName}} &middot; last checked {{lastChecked}}</div>
      <div>HTTP <code>{{statusCode}}</code> &middot; retry in {{retryAfterSeconds}}s</div>
    </div>
    <div class="brand">Served by StatusDog</div>
  </main>
</body>
</html>
`;

export const BUILTIN_TEMPLATES: Record<string, string> = {
  maintenance: shell({
    accent: '#2f81f7',
    glyph: '&#128295;',
    autoRefresh: true,
    body: `    <h1>{{title}}</h1>
    <p>{{message}}</p>
    <div class="bar"><span></span></div>
    <p>You do not need to do anything &mdash; this page refreshes itself.</p>`,
  }),
  error: shell({
    accent: '#e5534b',
    glyph: '&#9888;&#65039;',
    body: `    <h1>{{title}}</h1>
    <p>{{message}}</p>
    <div class="bar"><span></span></div>
    <p>If this keeps happening, please contact support and mention the time above.</p>`,
  }),
  offline: shell({
    accent: '#d29922',
    glyph: '&#128268;',
    autoRefresh: true,
    body: `    <h1>{{title}}</h1>
    <p>{{message}}</p>
    <div class="bar"><span></span></div>
    <p>The service is offline right now. We are working on bringing it back.</p>`,
  }),
};

export const BUILTIN_TEMPLATE_NAMES = Object.keys(BUILTIN_TEMPLATES);

export function isBuiltinTemplate(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(BUILTIN_TEMPLATES, name);
}
