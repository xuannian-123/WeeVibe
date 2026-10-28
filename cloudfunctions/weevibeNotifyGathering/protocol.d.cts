export type NotifyConfig={scope:string;appId:string;secret:string};
export const PURPOSE:string;
export const PREFIX:string;
export class NotificationProofError extends Error{readonly kind:'configuration'|'identity';}
export function readConfig(env:NodeJS.ProcessEnv):NotifyConfig;
export function sign(action:'claim'|'ack',payload:unknown,config:NotifyConfig,now?:number,nonce?:string):{path:string;body:string;signature:string};
export function verify(path:string,body:string,signature:string,config:NotifyConfig,now?:number):{payload:unknown;nonceHash:string;expiresAt:Date};
