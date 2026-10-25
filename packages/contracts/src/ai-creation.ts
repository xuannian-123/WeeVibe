import { z } from 'zod';
import { aiCreationDraftSchema } from './ai';

export const aiCreateRequestSchema = z.object({
  text: z.string().trim().min(1).max(1000),
  selected_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const parsed = Date.parse(`${value}T00:00:00+08:00`);
    return Number.isFinite(parsed) && new Date(parsed + 8 * 3600000).toISOString().slice(0, 10) === value;
  }, '日期无效'),
  source_revision: z.number().int().min(1).max(2_147_483_647),
}).strict();
export const aiCreateResponseSchema = z.object({
  draft: aiCreationDraftSchema,
  notices: z.array(z.string().min(1).max(500)).max(20),
}).strict();
export type AiCreateRequest = z.infer<typeof aiCreateRequestSchema>;
export type AiCreateResponse = z.infer<typeof aiCreateResponseSchema>;
