import { Text, View } from '@tarojs/components';
import { activityIdSchema, venueSchema } from '@weevibe/contracts';
import { ApiClientError } from '@weevibe/api-client';
import { getToken } from '../../platform/api';
import { readSaved, usePageRead } from '../../platform/page-state';
import { readCreationIdentity } from './api';
import { emptyForm } from './form';
import { OrdinaryEditor } from './index';
import { Action, Notice } from '../../components/ui';

export function VenueEditor({ sourceId }: { sourceId: string }) {
  const read = usePageRead(async () => {
    const id = activityIdSchema.safeParse(sourceId); if (!id.success) throw new ApiClientError('INVALID_INPUT', '地点草稿入口无效', 400);
    const identity = await readCreationIdentity();
    const stored = readSaved<{ owner_user_id: string; venue: unknown }>(`weevibe-venue-plan-v1:${id.data}`);
    if (!stored || stored.owner_user_id !== identity.user_id || identity.session !== getToken()) throw new ApiClientError('FORBIDDEN', '地点草稿不属于当前账号，请从灵感重新选择', 403);
    const venue = venueSchema.parse(stored.venue), form = emptyForm();
    form.name = `一起去${venue.name}`.slice(0, 100);form.segments[0].place = venue.name;form.segments[0].address = venue.address || '';
    form.segments[0].venue = { name: venue.name, address: venue.address, location: venue.location, source: venue.source };
    return { form, session: identity.session };
  });
  if (!read.data || read.data.session !== getToken() || read.loading || read.error) return <View className="screen"><Text>从喜欢的地点开始</Text>{read.error && <Notice tone="error">{read.error}</Notice>}<Action disabled={read.loading} onClick={()=>void read.refresh()}>重新读取地点</Action></View>;
  return <OrdinaryEditor key={`${sourceId}-${read.data.session}`} initialForm={read.data.form} draftSuffix={`:venue:${sourceId}`}/>;
}
