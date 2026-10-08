import type {FeedInfo, TrustLevel} from './types';

/** An operator feed older than this is no longer "live". */
export const LIVE_MAX_AGE_MS = 5 * 60 * 1000;
/** Anything older than this is flagged as stale in the UI. */
export const STALE_AFTER_MS = 30 * 60 * 1000;

/**
 * The only place that decides whether data may be called LIVE.
 * - Fresh operator/CMS feed  -> live
 * - A person confirmed it    -> user
 * - Third-party/aggregated, or an operator feed that went quiet -> estimated
 * - No source                -> unknown
 */
export function dataTrust(feed: FeedInfo, now: number): TrustLevel {
  if (feed.updatedAt === null || feed.source === 'none') {
    return 'unknown';
  }
  const age = now - feed.updatedAt;
  if (feed.source === 'operator_feed' && age <= LIVE_MAX_AGE_MS) {
    return 'live';
  }
  if (feed.source === 'user_report') {
    return 'user';
  }
  return 'estimated';
}

export function isStale(feed: FeedInfo, now: number): boolean {
  return feed.updatedAt === null || now - feed.updatedAt > STALE_AFTER_MS;
}

/** "just now", "38 sec ago", "12 min ago", "3 h ago", "2 d ago". */
export function timeAgo(at: number | null, now: number): string {
  if (at === null) {
    return 'never updated';
  }
  const sec = Math.max(0, Math.round((now - at) / 1000));
  if (sec < 10) {
    return 'just now';
  }
  if (sec < 60) {
    return `${sec} sec ago`;
  }
  const min = Math.round(sec / 60);
  if (min < 60) {
    return `${min} min ago`;
  }
  const h = Math.round(min / 60);
  if (h < 24) {
    return `${h} h ago`;
  }
  return `${Math.round(h / 24)} d ago`;
}

/**
 * How old a price is and who vouches for it, e.g. "Price updated 3 min ago" or
 * "Price (estimated), updated 46 min ago". Only a fresh operator feed is
 * stated plainly; every other source says what it is.
 */
export function priceAgeLabel(feed: FeedInfo, now: number): string {
  const trust = dataTrust(feed, now);
  const label =
    trust === 'live'
      ? 'Price updated'
      : trust === 'unknown'
      ? 'Price'
      : `Price (${trust === 'user' ? 'user-confirmed' : 'estimated'}), updated`;
  return `${label} ${timeAgo(feed.updatedAt, now)}`;
}

export const TRUST_LABEL: Record<TrustLevel, string> = {
  live: 'LIVE',
  estimated: 'Estimated',
  user: 'User-confirmed',
  unknown: 'Unknown',
};
