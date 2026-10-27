import { cityLookupInputSchema, cityLookupResultSchema } from '@weevibe/contracts';
import { AmapError, createVenueLimiter } from './amap';
const ENDPOINT = 'https://restapi.amap.com/v3/geocode/regeo' as const;
type Options = { fetch?: typeof fetch; getKey?: () => string | undefined; now?: () => Date; consume?: (actor: string) => void; timeoutMs?: number };
const record = (x: unknown): Record<string, unknown> | undefined => x !== null && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : undefined;
/** Returns only administrative regions: no coordinate/address echo or private route. */
export function createCityProvider(options: Options = {}) {
  const fetcher = options.fetch ?? globalThis.fetch;
  const consume = options.consume ?? createVenueLimiter({ limit: 5 });
  return async (actorId: string, input: unknown) => {
    const parsed = cityLookupInputSchema.safeParse(input);
    if (!parsed.success) throw new AmapError('INVALID_INPUT');
    const key = (options.getKey ?? (() => process.env.AMAP_WEB_SERVICE_KEY))()?.trim();
    if (!key) throw new AmapError('NOT_CONFIGURED');
    consume(actorId);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const operation = async () => {
        const url = new URL(ENDPOINT);
        url.search = new URLSearchParams({ key, location: `${parsed.data.location.longitude},${parsed.data.location.latitude}`, extensions: 'base', radius: '100', output: 'JSON' }).toString();
        const response = await fetcher(url, { redirect: 'error', cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new AmapError(response.status === 429 ? 'RATE_LIMITED' : 'UPSTREAM_FAILED');
        if (!response.body || Number(response.headers.get('content-length')) > 65536) throw new AmapError('INVALID_RESPONSE');
        const chunks: Uint8Array[] = []; let size = 0; const reader = response.body.getReader();
        try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 65536) throw new AmapError('INVALID_RESPONSE'); chunks.push(value); } }
        finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        let data: Record<string, unknown> | undefined;
        try { data = record(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { throw new AmapError('INVALID_RESPONSE'); }
        if (!data || String(data.status) !== '1' || String(data.infocode) !== '10000') throw new AmapError('UPSTREAM_FAILED');
        const address = record(record(data.regeocode)?.addressComponent);
        const safe = (v: unknown) => typeof v === 'string' && /^[\u3400-\u9fffA-Za-z ·-]{1,40}$/.test(v) && !v.includes(key) ? v : '';
        const region = safe(address?.province); const city = safe(address?.city) || (['北京市','天津市','上海市','重庆市'].includes(region) ? region : '');
        if (!city) throw new AmapError('INVALID_RESPONSE');
        return cityLookupResultSchema.parse({ city, region, district: safe(address?.district), source: { provider: 'amap', source_api: ENDPOINT, checked_at: (options.now ?? (() => new Date()))().toISOString() } });
      };
      return await Promise.race([operation(), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new AmapError('TIMEOUT')); }, Math.min(15000, Math.max(1, options.timeoutMs ?? 8000))); })]);
    } catch (error) { if (error instanceof AmapError) throw error; throw new AmapError('UPSTREAM_FAILED'); }
    finally { if (timer) clearTimeout(timer); controller.abort(); }
  };
}
export const cityProvider = createCityProvider();
