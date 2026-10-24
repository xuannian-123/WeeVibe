import { z } from 'zod';

// A broad mainland-area bounding box catches swapped coordinates; it is not
// proof of territorial coverage or a coordinate conversion from WGS84/BD09.
const sixDecimals = (n: number) => Math.abs(n * 1e6 - Math.round(n * 1e6)) < 0.000001;
export const gcj02Schema = z.object({
  longitude: z.number().finite().min(72).max(138).refine(sixDecimals),
  latitude: z.number().finite().min(0).max(56).refine(sixDecimals),
  crs: z.literal('GCJ-02'),
}).strict();
export const venueCategorySchema = z.enum(['sport', 'restaurant', 'karaoke', 'drinks', 'board_game', 'custom']);
export const venueSearchSchema = z.object({
  keyword: z.string().trim().min(1).max(80), region: z.string().trim().min(1).max(40),
  category: venueCategorySchema.optional(), page_size: z.number().int().min(1).max(10).default(5),
}).strict();
export const venueNearbySchema = z.object({
  center: gcj02Schema, category: venueCategorySchema,
  keyword: z.string().trim().min(1).max(80).optional(),
  radius_m: z.number().int().min(1).max(5000), page_size: z.number().int().min(1).max(10).default(5),
}).strict().refine(v => v.category !== 'custom' || Boolean(v.keyword), 'custom requires keyword');
export const venueWalkSchema = z.object({ origin: gcj02Schema, destination: gcj02Schema }).strict();
export const venueSourceSchema = z.object({
  provider: z.literal('amap'), checked_at: z.iso.datetime(),
  source_api: z.enum(['https://restapi.amap.com/v5/place/text', 'https://restapi.amap.com/v5/place/around', 'https://restapi.amap.com/v3/direction/walking']),
});
const sourcedTextSchema = z.object({ value: z.string().nullable(), source: venueSourceSchema,
  verification: z.enum(['api_returned_not_merchant_confirmed', 'unknown']) });
export const venueSchema = z.object({
  provider: z.literal('amap'), provider_id: z.string(), name: z.string(), address: z.string().nullable(),
  category_code: z.string(), category_text: z.string().nullable(), location: gcj02Schema,
  source: venueSourceSchema, telephone: sourcedTextSchema, opening_today: sourcedTextSchema,
  opening_week: sourcedTextSchema, rating: sourcedTextSchema,
  reference_cost: sourcedTextSchema.extend({ currency: z.literal('CNY'), unit: z.enum(['person']).nullable(), is_transaction_quote: z.literal(false) }),
  search_distance_m: z.number().nonnegative().nullable(), search_distance_kind: z.literal('search_distance_not_walk_route'),
  inventory: z.literal('unknown'), booking: z.literal('unknown'),
  suitability: z.literal('not_merchant_verified'),
});
export const venueListSchema = z.object({
  source: venueSourceSchema, venues: z.array(venueSchema), excluded_count: z.number().int().nonnegative(),
  pagination: z.literal(false),
});
export const venueWalkResultSchema = z.object({
  source: venueSourceSchema, origin: gcj02Schema, destination: gcj02Schema,
  route: z.object({ distance_m: z.number().nonnegative(), duration_seconds: z.number().nonnegative(),
    basis: z.literal('provider_estimate'), includes_indoor_transfer: z.literal(false),
    includes_activity_buffer: z.literal(false), booking: z.literal('unknown'),
  }).nullable(),
});
export type Gcj02 = z.infer<typeof gcj02Schema>;
export type VenueCategory = z.infer<typeof venueCategorySchema>;
export type Venue = z.infer<typeof venueSchema>;
export type VenueList = z.infer<typeof venueListSchema>;
export type VenueWalkResult = z.infer<typeof venueWalkResultSchema>;
export type VenueSearchInput = z.input<typeof venueSearchSchema>;
export type VenueNearbyInput = z.input<typeof venueNearbySchema>;
export type VenueWalkInput = z.input<typeof venueWalkSchema>;
