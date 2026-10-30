import {z} from 'zod';
export const preferenceMemoryCommandSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('settings'),learning:z.boolean(),recommending:z.boolean()}).strict(),
 z.object({action:z.literal('clear')}).strict(),
 z.object({action:z.enum(['delete','correct','revoke']),category:z.enum(['play','travel','pace']),values:z.array(z.string().max(40)).max(6).optional()}).strict(),
]);
export const preferenceMemoryViewSchema=z.object({learning:z.boolean(),recommending:z.boolean(),version:z.number(),profiles:z.array(z.object({category:z.enum(['play','travel','pace']),values:z.array(z.string().max(40)).max(6),confidence:z.string(),evidence_count:z.number(),source:z.string(),last_at:z.string().nullable()})),pending:z.number(),failed:z.number()});
