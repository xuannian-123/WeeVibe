import {gatheringSections} from './gathering-reference';
import type {Venue,VenueCategory} from './venues';
export const inspirationGroups=gatheringSections[0].groups;
export type InspirationGroup='eat'|'drink'|'play';
const patterns:Record<string,RegExp>={
 '常规中餐':/中餐|家常|本帮|东北|江浙|粤菜/, '辣中餐：川渝湘赣':/川菜|湘菜|赣菜|川渝/,'火锅／串串':/火锅|串串/,'烧烤':/烧烤|烤肉串/,'自助餐':/自助/,'西餐':/西餐|牛排|披萨|汉堡/,'日式':/日料|日式|寿司|居酒屋/,'韩式（含烤肉）':/韩式|韩国|韩餐/,'东南亚菜':/东南亚|泰国|泰式|越南/,'小吃／夜市':/小吃|夜市/,'轻食／简餐':/轻食|简餐|沙拉/,
 '咖啡':/咖啡|coffee|肯悦/i,'奶茶／果汁／甜品':/奶茶|果汁|甜品|冰淇淋/,'茶馆':/茶馆|茶室|茶楼/,'清吧':/清吧|酒吧|酒馆/,'夜店':/夜店|迪厅/,
 '看展':/展览|博物馆|美术馆|艺术馆/,'唱歌':/KTV|卡拉|歌厅/i,'桌游/棋牌':/桌游|棋牌|麻将/,'电影演出':/电影院|影院|剧院|演出/,'剧本杀/密室逃脱':/剧本杀|密室/,'打卡':/打卡/,'手作DIY':/手作|DIY|陶艺/i,'电玩城':/电玩城|游艺|游戏厅/,'室内运动':/健身|室内|羽毛球|台球|保龄球/,'露营':/露营|营地/,'散步':/公园|步行街|广场/,'骑行':/骑行|自行车/,'室外运动':/运动|体育|球场|滑雪|攀岩/,
};
export function classifyInspirationVenue(venue:Pick<Venue,'name'|'category_text'|'category_code'>):{group:InspirationGroup;option:string}|undefined{
 const text=`${venue.category_text||''} ${venue.name}`;
 // Specific drink categories take precedence over a broad restaurant POI type.
 for(const group of [inspirationGroups[1],inspirationGroups[0],inspirationGroups[2]])for(const option of group.options)if(patterns[option]?.test(text))return {group:group.id as InspirationGroup,option};
 if(/餐饮|餐厅/.test(text)||/^05/.test(venue.category_code))return {group:'eat',option:'其他'};
 return undefined;
}
export function inspirationCategory(value:string):{group:InspirationGroup;option?:string;keyword:string;api?:VenueCategory}|undefined{
 const group=inspirationGroups.find(g=>g.title===value||value.startsWith(g.id+':'));if(!group)return;
 const index=Number(value.split(':')[1]),option=value.includes(':')?group.options[index]:undefined;
 return {group:group.id as InspirationGroup,option,keyword:option?(option==='其他'?group.title:option.replace(/[／/]/g,'|')):group.id==='eat'?'餐厅':group.id==='drink'?'咖啡|奶茶|茶馆|酒吧':'休闲娱乐',...(group.id==='eat'?{api:'restaurant' as const}:option==='唱歌'?{api:'karaoke' as const}:option==='桌游/棋牌'?{api:'board_game' as const}:{})};
}
