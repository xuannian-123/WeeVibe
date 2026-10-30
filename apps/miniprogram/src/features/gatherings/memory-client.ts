import {preferenceMemoryViewSchema} from '@weevibe/contracts';
import type {z} from 'zod';
import {extensionRequest} from '../../platform/extension-api';
import {getToken} from '../../platform/api';
export const memoryCategories=['play','travel','pace'] as const;
export const memoryLabels={play:'活动类型',travel:'交通方式',pace:'活动节奏'};
const schema=preferenceMemoryViewSchema;
export type MemoryView=z.infer<typeof schema>;
export async function requestMemory(session:string,body?:unknown){if(getToken()!==session)throw Error('账号已变化');const raw=await extensionRequest('/api/v1/preference-memory',body?'POST':'GET',body);if(getToken()!==session)throw Error('账号已变化');return schema.parse(raw);}
