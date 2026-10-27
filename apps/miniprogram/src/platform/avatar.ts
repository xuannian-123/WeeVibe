import Taro from '@tarojs/taro';
import { ApiClientError } from '@weevibe/api-client';
import { avatarResultSchema, type AvatarAsset } from '@weevibe/contracts';
import { api, getToken } from './api';
import { extensionRequest } from './extension-api';
function localAvatar(userId:string,asset:AvatarAsset) {
  if(!/^[0-9a-f-]{36}$/i.test(userId)) throw new ApiClientError('INVALID_RESPONSE','头像账号无法验证',0);
  const fs=Taro.getFileSystemManager();
  const path=`${Taro.env.USER_DATA_PATH}/weevibe-avatar-${userId}-${asset.digest}.jpg`;
  fs.writeFileSync(path,asset.base64,'base64');
  return path;
}
export async function loadAvatar(userId:string) {
  const token=getToken();const current=await api.me();
  if(!token || getToken()!==token || current.user_id!==userId) throw new ApiClientError('UNAUTHENTICATED','账号已变化，未读取头像',401);
  const result=avatarResultSchema.parse(await extensionRequest('/api/v1/account/avatar'));
  return result.avatar?localAvatar(userId,result.avatar):'';
}
export async function uploadAvatar(path:string, expectedToken:string|undefined) {
  if(!expectedToken || expectedToken!==getToken()) throw new ApiClientError('UNAUTHENTICATED','账号已切换，请重新打开资料页',401);
  const token=expectedToken;const user=await api.me();
  if(!token || getToken()!==token) throw new ApiClientError('UNAUTHENTICATED','请重新登录',401);
  let prepared=path;
  try{prepared=(await Taro.compressImage({src:path,quality:60,compressedWidth:256,compressedHeight:256})).tempFilePath;}catch{/* A small chooseAvatar result may already be suitable. */}
  const fs=Taro.getFileSystemManager();
  let base64=String(fs.readFileSync(prepared,'base64'));
  if(base64.length>56000){try{prepared=(await Taro.compressImage({src:path,quality:25,compressedWidth:128,compressedHeight:128})).tempFilePath;base64=String(fs.readFileSync(prepared,'base64'));}catch{throw new ApiClientError('INVALID_INPUT','头像过大，请选择较小图片后重试',400);}}
  if(base64.length>56000) throw new ApiClientError('INVALID_INPUT','头像仍过大，请选择较小图片后重试',400);
  if(getToken()!==token) throw new ApiClientError('UNAUTHENTICATED','账号已切换，未上传',401);
  const result=avatarResultSchema.parse(await extensionRequest('/api/v1/account/avatar','POST',{base64}));
  if(getToken()!==token) throw new ApiClientError('UNAUTHENTICATED','账号已变化，未展示原账号的头像结果',401);
  if(!result.avatar) throw new ApiClientError('INVALID_RESPONSE','头像未保存，请重试',0);
  return localAvatar(user.user_id,result.avatar);
}
