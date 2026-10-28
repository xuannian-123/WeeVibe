import {createHash} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {profileImageSchema,type MemberProfile} from '@weevibe/contracts';
import {withDb} from '../db';
import {ServiceError} from '../http';
import {parsePrivateProfile} from '../account-rules';
import type {Tx} from '../activities/state';

type StoredAvatar={bytes:Uint8Array;contentType:string;digest:string};
function verifiedAvatar(image:StoredAvatar|null):MemberProfile['avatar']{
  if(!image||image.contentType!=='image/jpeg'||!image.bytes.length||image.bytes.length>42000)return null;
  const bytes=Buffer.from(image.bytes);
  if(createHash('sha256').update(bytes).digest('hex')!==image.digest)return null;
  const parsed=profileImageSchema.safeParse({base64:bytes.toString('base64'),content_type:'image/jpeg',digest:image.digest});
  return parsed.success?parsed.data:null;
}
const avatarSelect={bytes:true,contentType:true,digest:true} as const;
const incomplete=()=>new ServiceError('INVALID_INPUT',400,'请先保存头像和昵称，再继续组局或填写。');

/** Require persisted identity rows; display fallbacks and local avatar paths never qualify. */
export async function assertGatheringProfile(tx:Tx,actor:string):Promise<void>{
  const[saved,image]=await Promise.all([
    tx.privateProfile.findUnique({where:{userId:actor},select:{data:true}}),
    tx.userAvatar.findUnique({where:{userId:actor},select:avatarSelect}),
  ]);
  if(!saved||!verifiedAvatar(image))throw incomplete();
  try{if(!parsePrivateProfile(saved.data).nickname.trim())throw incomplete();}
  catch{throw incomplete();}
}

/** HTTP-only entry points can verify the same persisted identity without a business transaction. */
export function assertGatheringProfileActor(actor:string):Promise<void>{return withDb(db=>db.$transaction(tx=>assertGatheringProfile(tx,actor),{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead}));}
