/**
 * Public surface of the module: the facade and its public types, nothing else.
 * Other modules import from here; the architecture block in `eslint.config.mjs` forbids deeper paths.
 */
export { AnnouncementsFacade } from './facade/announcements.facade.js';
export type { Announcement, AnnouncementId } from './model/announcements.model.js';
