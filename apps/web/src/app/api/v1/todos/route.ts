import { todoCursorSchema } from '@weevibe/contracts';
import { handle, ServiceError } from '../../../../server/http';
import { requireActor } from '../../../../server/activities/transport';
import { getTodos } from '../../../../server/todos';
export const runtime='nodejs';
export function GET(request:Request){return handle(async()=>{
 const actor=await requireActor(request),query=new URL(request.url).searchParams;
 if([...query.keys()].some(k=>k!=='cursor')||query.getAll('cursor').length>1)throw new ServiceError('INVALID_INPUT',400,'待办查询参数不正确');
 const raw=query.get('cursor');if(raw!==null&&!todoCursorSchema.safeParse(raw).success)throw new ServiceError('INVALID_INPUT',400,'待办分页标识不正确');
 return getTodos(actor,raw??undefined);
},request);}
