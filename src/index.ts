/**
 * StatusDog — lightweight uptime monitoring with automated fallback pages.
 *
 * ```ts
 * import { loadConfig, Monitor, createFallbackMiddleware } from 'statusdog';
 *
 * const config = await loadConfig();
 * const monitor = new Monitor(config);
 * monitor.start();
 * app.use(createFallbackMiddleware(monitor, { targetId: 'api' }));
 * ```
 */
export * from './config/index.js';
export * from './monitor/index.js';
export * from './store/index.js';
export * from './fallback/index.js';
export * from './dashboard/index.js';
export { attachNotifiers, createNotifier, createNotifiers } from './notify/index.js';
export type { Notifier } from './notify/index.js';
export { createLogger, color } from './util/log.js';
export type { Logger } from './util/log.js';
export { formatDuration, formatRelative, formatTimestamp } from './util/time.js';
