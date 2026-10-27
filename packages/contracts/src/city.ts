import { z } from 'zod';
import { gcj02Schema } from './venues';
export const cityLookupInputSchema = z.object({ location: gcj02Schema }).strict();
export const cityLookupResultSchema = z.object({ city: z.string().min(1).max(40), region: z.string().max(40), district: z.string().max(40), source: z.object({ provider: z.literal('amap'), source_api: z.literal('https://restapi.amap.com/v3/geocode/regeo'), checked_at: z.iso.datetime() }).strict() }).strict();
export type CityLookupResult = z.infer<typeof cityLookupResultSchema>;
