export interface FeedRequestLike {
  headers?: Record<string, string | string[] | undefined>;
  protocol?: string;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const first = raw?.split(',')[0]?.trim();
  return first || undefined;
}

/** The public origin of this backend: configured, else forwarded by a proxy, else the request itself. */
export function calendarFeedOrigin(configured: string | undefined, req: FeedRequestLike | undefined): string {
  if (configured?.trim()) return configured.trim().replace(/\/+$/, '');
  const headers = req?.headers ?? {};
  const proto = firstValue(headers['x-forwarded-proto']) ?? req?.protocol ?? 'http';
  const host = firstValue(headers['x-forwarded-host']) ?? firstValue(headers['host']);
  return `${proto}://${host}`;
}

export function calendarFeedUrl(origin: string, token: string): string {
  return `${origin}/api/calendar/bookings/${token}.ics`;
}
