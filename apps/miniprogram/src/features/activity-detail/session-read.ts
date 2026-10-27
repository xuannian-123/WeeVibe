import { ApiClientError } from '@weevibe/api-client';
import { api, getToken } from '../../platform/api';
import { rememberActivity } from '../../platform/activities';
/** Read snapshots are tagged with the session that requested them; never persisted with the token. */
export async function readActivityForSession(id: string) {
 const session=getToken();
 try {
  const detail=await api.getActivity(id);
  if(getToken()!==session)throw new ApiClientError('SESSION_CHANGED','账号已切换，请重新加载',409);
  rememberActivity(detail.viewer.user_id,detail);
  return {detail,session};
 }catch(error){
  // An old request's 401 must not make the shared read hook forget a newer session.
  if(getToken()!==session)throw new ApiClientError('SESSION_CHANGED','账号已切换，请重新加载',409);
  throw error;
 }
}
