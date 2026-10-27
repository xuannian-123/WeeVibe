import { gcj02Schema, venueSearchSchema, venueNearbySchema, venueWalkSchema,
  type Gcj02, type Venue, type VenueCategory, type VenueList, type VenueWalkResult,
} from '../../../../../packages/contracts/src/venues';
import { ServiceError } from '../http';

const TEXT = 'https://restapi.amap.com/v5/place/text' as const;
const AROUND = 'https://restapi.amap.com/v5/place/around' as const;
const WALK = 'https://restapi.amap.com/v3/direction/walking' as const;
type Endpoint = typeof TEXT | typeof AROUND | typeof WALK;
export type AmapFailure = 'NOT_CONFIGURED' | 'INVALID_INPUT' | 'RATE_LIMITED' | 'QUOTA_EXHAUSTED'
  | 'PERMISSION_DENIED' | 'UPSTREAM_FAILED' | 'INVALID_RESPONSE' | 'TIMEOUT';
export class AmapError extends ServiceError {
  constructor(readonly reason: AmapFailure) {
    const messages: Record<AmapFailure, string> = {
      NOT_CONFIGURED: '尚未配置服务端地点查询', INVALID_INPUT: '地点查询参数不正确',
      RATE_LIMITED: '地点查询过于频繁，请稍后再试', QUOTA_EXHAUSTED: '地点查询额度暂不可用，请使用手动填写',
      PERMISSION_DENIED: '地点服务配置或权限不可用', UPSTREAM_FAILED: '地点服务暂时不可用',
      INVALID_RESPONSE: '地点服务响应无法验证', TIMEOUT: '地点查询超时，请稍后再试',
    };
    super(reason === 'INVALID_INPUT' ? 'INVALID_INPUT' : reason === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'UPSTREAM_UNAVAILABLE',
      reason === 'INVALID_INPUT' ? 400 : reason === 'RATE_LIMITED' ? 429 : reason === 'INVALID_RESPONSE' ? 502 : 503, messages[reason]);
  }
}

// Process-local, bounded memory; no shared/multi-replica quota guarantee.
export function createVenueLimiter(options: { limit?: number; windowMs?: number; maxUsers?: number; now?: () => number } = {}) {
  const limit = options.limit ?? 10, windowMs = options.windowMs ?? 60_000, maxUsers = options.maxUsers ?? 10_000;
  const now = options.now ?? Date.now;
  const buckets = new Map<string, { count: number; expires: number }>();
  return (userId: string) => {
    if (!userId.trim()) throw new AmapError('INVALID_INPUT');
    const time = now();
    for (const [key, value] of buckets) if (value.expires <= time) buckets.delete(key);
    const bucket = buckets.get(userId);
    if (!bucket && buckets.size >= maxUsers || bucket && bucket.count >= limit) throw new AmapError('RATE_LIMITED');
    if (bucket) bucket.count++;
    else buckets.set(userId, { count: 1, expires: time + windowMs });
  };
}
type ProviderOptions = {
  fetch?: typeof fetch; getKey?: () => string | undefined; now?: () => Date;
  timeoutMs?: number; consume?: (userId: string) => void;
};
type RecordValue = Record<string, unknown>;
const object = (v: unknown): RecordValue | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as RecordValue : null;
const number = (v: unknown): number | null => (typeof v === 'number' || typeof v === 'string' && v.trim() !== '') && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null;
const encode = (v: Gcj02) => `${v.longitude},${v.latitude}`;
const typeMap: Partial<Record<VenueCategory, string>> = { sport: '080000', restaurant: '050000' };
// Unverified category mappings intentionally use explicit keyword search instead
// of invented category codes. Only badminton + dining have live test evidence.
const defaultKeyword: Partial<Record<VenueCategory, string>> = { karaoke: 'KTV', drinks: '酒吧', board_game: '桌游' };

export function createAmapProvider(options: ProviderOptions = {}) {
  const transport = options.fetch ?? globalThis.fetch;
  const getKey = options.getKey ?? (() => process.env.AMAP_WEB_SERVICE_KEY);
  const now = options.now ?? (() => new Date());
  const consume = options.consume ?? createVenueLimiter();
  const timeoutMs = Math.min(15_000, Math.max(1, options.timeoutMs ?? 8_000));
  async function request(userId: string, endpoint: Endpoint, params: Record<string, string>) {
    const key = getKey()?.trim();
    if (!key) throw new AmapError('NOT_CONFIGURED');
    consume(userId);
    const source = { provider: 'amap' as const, source_api: endpoint, checked_at: now().toISOString() };
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Never forward upstream text/URLs, including an echoed key in selected fields.
    const clean = (v: unknown): string | null => typeof v === 'string' && v.trim() ? v.split(key).join('[REDACTED]').slice(0, 2000) : null;
    const operation = async () => {
      const url = new URL(endpoint);
      url.search = new URLSearchParams({ ...params, key }).toString();
      const response = await transport(url, { cache: 'no-store', redirect: 'error', signal: controller.signal });
      if (!response.ok) throw new AmapError(response.status === 429 ? 'RATE_LIMITED' : 'UPSTREAM_FAILED');
      if (Number(response.headers.get('content-length')) > 262_144) throw new AmapError('INVALID_RESPONSE');
      if (!response.body) throw new AmapError('INVALID_RESPONSE');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 262_144) throw new AmapError('INVALID_RESPONSE');
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      let data: RecordValue | null;
      try { data = object(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { throw new AmapError('INVALID_RESPONSE'); }
      if (!data) throw new AmapError('INVALID_RESPONSE');
      if (String(data.status) !== '1' || String(data.infocode) !== '10000') {
        const code = String(data.infocode);
        if (code === '10003' || code === '10044') throw new AmapError('QUOTA_EXHAUSTED');
        if (code === '10004' || code === '10014') throw new AmapError('RATE_LIMITED');
        if (['10001', '10002', '10005', '10006', '10007', '10009', '10012', '10013'].includes(code)) throw new AmapError('PERMISSION_DENIED');
        throw new AmapError('UPSTREAM_FAILED');
      }
      return data;
    };
    try {
      const data = await Promise.race([operation(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new AmapError('TIMEOUT')); }, timeoutMs);
      })]);
      return { data, source, clean };
    } catch (error) {
      if (error instanceof AmapError) throw error;
      throw new AmapError('UPSTREAM_FAILED');
    } finally { if (timer) clearTimeout(timer); controller.abort(); }
  }
  async function places(userId: string, endpoint: typeof TEXT | typeof AROUND, params: Record<string, string>, category?: VenueCategory, radius?: number): Promise<VenueList> {
    const { data, source, clean } = await request(userId, endpoint, params);
    if (!Array.isArray(data.pois)) throw new AmapError('INVALID_RESPONSE');
    const venues: Venue[] = []; let excluded_count = 0;
    // Bound even an upstream response that ignores page_size.
    for (const raw of data.pois.slice(0, Number(params.page_size))) {
      const poi = object(raw), code = poi && clean(poi.typecode);
      const parts = typeof poi?.location === 'string' ? poi.location.split(',') : [];
      const location = parts.length === 2 && parts.every(p => p.trim() !== '') ? gcj02Schema.safeParse({ longitude: Number(parts[0]), latitude: Number(parts[1]), crs: 'GCJ-02' }) : null;
      const distance = number(poi?.distance);
      if (!poi || !code || !/^\d{6}$/.test(code) || !clean(poi.id) || !clean(poi.name) || !location?.success
        || category === 'sport' && !code.startsWith('08') || category === 'restaurant' && !code.startsWith('05')
        || radius !== undefined && distance !== null && distance > radius) { excluded_count++; continue; }
      const business = object(poi.business) ?? {};
      const photos = (Array.isArray(poi.photos) ? poi.photos : []).slice(0, 3).flatMap(raw => {
        const photo = object(raw), value = photo && clean(photo.url);
        if (!value || value.includes('[REDACTED]')) return [];
        try { const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password || url.searchParams.has('key') || !url.hostname.includes('.') || /^(?:localhost|127\.|10\.|192\.168\.)/.test(url.hostname)) return []; return [{ url: url.toString(), title: clean(photo?.title)?.slice(0, 200) ?? null }]; } catch { return []; }
      });
      const sourced = (v: unknown) => ({ value: clean(v), source, verification: clean(v) ? 'api_returned_not_merchant_confirmed' as const : 'unknown' as const });
      venues.push({ provider: 'amap', provider_id: clean(poi.id)!, name: clean(poi.name)!, address: clean(poi.address),
        category_code: code, category_text: clean(poi.type), location: location.data, source,
        telephone: sourced(business.tel), opening_today: sourced(business.opentime_today), opening_week: sourced(business.opentime_week), rating: sourced(business.rating),
        reference_cost: { ...sourced(business.cost), currency: 'CNY', unit: code.startsWith('05') ? 'person' : null, is_transaction_quote: false },
        search_distance_m: distance, search_distance_kind: 'search_distance_not_walk_route',
        inventory: 'unknown', booking: 'unknown', suitability: 'not_merchant_verified',
        ...(clean(poi.adname) ? { district: clean(poi.adname)!.slice(0, 100) } : {}), ...(photos.length ? { photos } : {}),
      });
    }
    return { source, venues, excluded_count, pagination: false };
  }
  return {
    async search(userId: string, input: unknown): Promise<VenueList> {
      const parsed = venueSearchSchema.safeParse(input);
      if (!parsed.success) throw new AmapError('INVALID_INPUT');
      const v = parsed.data;
      return places(userId, TEXT, { keywords: v.keyword, region: v.region, city_limit: 'true', show_fields: 'business,photos', page_size: String(v.page_size), page_num: '1', ...(v.category && typeMap[v.category] ? { types: typeMap[v.category]! } : {}) }, v.category);
    },
    async nearby(userId: string, input: unknown): Promise<VenueList> {
      const parsed = venueNearbySchema.safeParse(input);
      if (!parsed.success) throw new AmapError('INVALID_INPUT');
      const v = parsed.data;
      return places(userId, AROUND, { location: encode(v.center), radius: String(v.radius_m), sortrule: 'distance', show_fields: 'business,photos', page_size: String(v.page_size), page_num: '1',
        ...(typeMap[v.category] ? { types: typeMap[v.category]! } : {}),
        ...(v.keyword || defaultKeyword[v.category] ? { keywords: v.keyword ?? defaultKeyword[v.category]! } : {}),
      }, v.category, v.radius_m);
    },
    async walk(userId: string, input: unknown): Promise<VenueWalkResult> {
      const parsed = venueWalkSchema.safeParse(input);
      if (!parsed.success) throw new AmapError('INVALID_INPUT');
      const v = parsed.data;
      const { data, source } = await request(userId, WALK, { origin: encode(v.origin), destination: encode(v.destination), output: 'json' });
      const paths = object(data.route)?.paths;
      if (!Array.isArray(paths)) throw new AmapError('INVALID_RESPONSE');
      if (!paths.length) return { source, ...v, route: null };
      const path = object(paths[0]); const distance = number(path?.distance), duration = number(path?.duration);
      if (distance === null || duration === null) throw new AmapError('INVALID_RESPONSE');
      return { source, ...v, route: { distance_m: distance, duration_seconds: duration, basis: 'provider_estimate', includes_indoor_transfer: false, includes_activity_buffer: false, booking: 'unknown' } };
    },
  };
}
// No fetch or configuration reads at import time.
export const amapProvider = createAmapProvider();
