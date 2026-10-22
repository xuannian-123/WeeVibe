// 无 AMAP_KEY 时的地图实现：完全确定性（坐标/关键词做种子，不用 Math.random）。
//
// searchAround 采用"固定世界"思路：把地图切成 0.01°×0.01° 的格子，每个格子里有哪些店
// 只由 (关键词, 格子坐标) 决定。所以有人退出、公平中心移动后重算，附近还是同一批店，
// 不会整批换名字，Demo 时更像真实地图。
import type { LatLng, MapProvider, Place, Poi } from "../types";
import { estimateCommute, getDemoCenter, hashString, haversineKm, seededRandom } from "./geo";

// ---------------- 地标 ----------------

/** 苏州园区 / 独墅湖一带的近似真实坐标（GCJ-02） */
export const SUZHOU_LANDMARKS: Place[] = [
  { label: "西交利物浦大学", lat: 31.2748, lng: 120.7383 },
  { label: "苏州大学独墅湖校区", lat: 31.2745, lng: 120.7462 },
  { label: "独墅湖图书馆", lat: 31.2622, lng: 120.7385 },
  { label: "月亮湾", lat: 31.2627, lng: 120.7293 },
  { label: "星湖街地铁站", lat: 31.2865, lng: 120.743 },
  { label: "金鸡湖", lat: 31.3075, lng: 120.6935 },
  { label: "苏州中心", lat: 31.3187, lng: 120.6753 },
  { label: "圆融时代广场", lat: 31.3228, lng: 120.7113 },
  { label: "李公堤", lat: 31.3018, lng: 120.681 },
  { label: "东方之门", lat: 31.3216, lng: 120.669 },
  { label: "苏州站", lat: 31.3304, lng: 120.6107 },
  { label: "观前街", lat: 31.3112, lng: 120.6225 },
  { label: "苏州科技城", lat: 31.3383, lng: 120.439 },
  { label: "斜塘老街", lat: 31.3008, lng: 120.7488 },
  { label: "苏州奥体中心", lat: 31.3122, lng: 120.741 },
  { label: "苏州工业园区站", lat: 31.3365, lng: 120.78 },
];

/** 上海（徐汇为中心）的近似真实坐标（GCJ-02），比赛在徐汇，演示成员从这里取 */
export const SHANGHAI_LANDMARKS: Place[] = [
  { label: "36space（漕宝路36号E座）", lat: 31.167645, lng: 121.43195 },
  { label: "徐家汇", lat: 31.1952, lng: 121.4372 },
  { label: "上海交通大学徐汇校区", lat: 31.2005, lng: 121.4335 },
  { label: "上海体育场", lat: 31.183, lng: 121.437 },
  { label: "漕河泾开发区", lat: 31.1675, lng: 121.397 },
  { label: "龙华寺", lat: 31.1757, lng: 121.4497 },
  { label: "西岸美术馆", lat: 31.166, lng: 121.46 },
  { label: "上海南站", lat: 31.1545, lng: 121.43 },
  { label: "打浦桥", lat: 31.206, lng: 121.466 },
  { label: "田子坊", lat: 31.209, lng: 121.469 },
  { label: "新天地", lat: 31.219, lng: 121.475 },
  { label: "静安寺", lat: 31.2235, lng: 121.446 },
  { label: "长宁来福士", lat: 31.2185, lng: 121.4235 },
  { label: "中山公园", lat: 31.221, lng: 121.417 },
  { label: "人民广场", lat: 31.233, lng: 121.475 },
  { label: "陆家嘴", lat: 31.24, lng: 121.5 },
  { label: "世纪大道", lat: 31.229, lng: 121.526 },
  { label: "七宝古镇", lat: 31.156, lng: 121.353 },
  { label: "虹桥火车站", lat: 31.1945, lng: 121.32 },
  { label: "五角场", lat: 31.299, lng: 121.514 },
  { label: "复旦大学邯郸校区", lat: 31.2985, lng: 121.5035 },
];

const SUZHOU_REF: LatLng = { lat: 31.3, lng: 120.68 };

function isShanghai(city: string | undefined): boolean {
  return (city ?? "").includes("上海");
}

/** 按城市取内置地标：苏州 / 上海有真实地标，其他城市围绕 DEMO_CENTER 生成 */
function landmarksFor(city: string): Place[] {
  if (isShanghai(city)) return SHANGHAI_LANDMARKS;
  return isSuzhou(city) ? SUZHOU_LANDMARKS : genericLandmarks(city.trim());
}

function isSuzhou(city: string | undefined): boolean {
  const c = (city ?? "").trim();
  return c === "" || c.includes("苏州");
}

/** 围绕 DEMO_CENTER 生成 "XX地标1…8"（非苏州城市用） */
function genericLandmarks(city: string): Place[] {
  const center = getDemoCenter();
  const rnd = seededRandom(hashString(`landmarks|${city}|${center.lat.toFixed(4)},${center.lng.toFixed(4)}`));
  const out: Place[] = [];
  for (let i = 1; i <= 8; i++) {
    const angle = rnd() * Math.PI * 2;
    const km = 0.8 + rnd() * 7;
    out.push({ label: `${city}地标${i}`, ...offsetKm(center, km * Math.cos(angle), km * Math.sin(angle)) });
  }
  return out;
}

function offsetKm(p: LatLng, eastKm: number, northKm: number): LatLng {
  const lat = p.lat + northKm / 111.32;
  const lng = p.lng + eastKm / (111.32 * Math.cos((p.lat * Math.PI) / 180));
  return { lat: round6(lat), lng: round6(lng) };
}

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

/** 模糊匹配分：包含子串最高，其次按共同字符占比 */
function matchScore(label: string, q: string): number {
  const name = label.toLowerCase();
  const query = q.toLowerCase();
  if (name.includes(query)) return 100 - (name.length - query.length);
  if (query.includes(name)) return 80;
  const chars = [...new Set([...query].filter((c) => c.trim() !== ""))];
  if (chars.length === 0) return 0;
  const hit = chars.filter((c) => name.includes(c)).length / chars.length;
  return hit >= 0.5 ? Math.round(hit * 60) : 0;
}

// ---------------- 场地目录 ----------------

type CatalogEntry = {
  keys: string[];
  type: string;
  cost: [number, number];
  names: { n: string; t?: string }[];
};

const T_HOTPOT = "餐饮服务;中餐厅;火锅店";
const T_SICHUAN = "餐饮服务;中餐厅;四川菜(川菜)";

// 全部为虚构店名，不使用真实连锁品牌
const CATALOG: CatalogEntry[] = [
  {
    keys: ["火锅", "涮肉", "涮锅"],
    type: T_HOTPOT,
    cost: [75, 130],
    names: [
      { n: "老灶台火锅" },
      { n: "重庆红汤记火锅" },
      { n: "川味坊老火锅", t: T_SICHUAN },
      { n: "围炉小馆火锅" },
      { n: "鼎沸重庆火锅" },
      { n: "清汤雅舍火锅" },
      { n: "潮汕鲜切牛肉火锅", t: "餐饮服务;中餐厅;潮州菜" },
      { n: "椰林椰子鸡火锅", t: "餐饮服务;中餐厅;粤菜(广东菜)" },
      { n: "铜炉涮肉馆" },
      { n: "山野菌汤火锅" },
      { n: "蜀香阁串串火锅", t: T_SICHUAN },
      { n: "毛肚研究所火锅" },
    ],
  },
  {
    keys: ["烧烤", "撸串", "烤串", "串"],
    type: "餐饮服务;中餐厅;特色/地方风味餐厅",
    cost: [55, 110],
    names: [
      { n: "炭火小院烧烤" },
      { n: "深夜撸串烧烤" },
      { n: "新疆红柳烤肉", t: "餐饮服务;中餐厅;清真菜馆" },
      { n: "东北老式烧烤" },
      { n: "江畔烧烤大排档" },
      { n: "烤串研究室" },
      { n: "海边烤生蚝烧烤", t: "餐饮服务;中餐厅;海鲜酒楼" },
      { n: "西北羊肉串烧烤", t: "餐饮服务;中餐厅;清真菜馆" },
    ],
  },
  {
    keys: ["烤肉", "烧肉"],
    type: "餐饮服务;外国餐厅;韩国料理",
    cost: [80, 150],
    names: [
      { n: "首尔炭火烤肉" },
      { n: "和风烧肉屋", t: "餐饮服务;外国餐厅;日本料理" },
      { n: "炭香牛肋烤肉" },
      { n: "石板烤肉坊" },
      { n: "巴西烤肉自助", t: "餐饮服务;外国餐厅;外国餐厅" },
    ],
  },
  {
    keys: ["桌游", "狼人杀", "棋牌"],
    type: "体育休闲服务;娱乐场所;棋牌室",
    cost: [40, 80],
    names: [
      { n: "骰子桌游吧" },
      { n: "卡牌小屋桌游" },
      { n: "周末桌游馆" },
      { n: "狼人杀俱乐部" },
      { n: "棋乐无穷桌游" },
      { n: "方块桌游空间" },
    ],
  },
  {
    keys: ["剧本杀", "推理"],
    type: "体育休闲服务;娱乐场所;娱乐场所",
    cost: [80, 150],
    names: [{ n: "迷雾剧本杀" }, { n: "夜幕推理馆" }, { n: "长夜剧本杀" }, { n: "一念剧本推理馆" }],
  },
  {
    keys: ["密室"],
    type: "体育休闲服务;娱乐场所;娱乐场所",
    cost: [80, 140],
    names: [{ n: "夜幕密室逃脱" }, { n: "失落之城密室" }, { n: "迷城真人密室" }],
  },
  {
    keys: ["ktv", "k歌", "唱歌", "唱k"],
    type: "体育休闲服务;娱乐场所;KTV",
    cost: [60, 120],
    names: [
      { n: "麦霸量贩式KTV" },
      { n: "声动KTV" },
      { n: "夜色量贩KTV" },
      { n: "回声KTV" },
      { n: "星光派对KTV" },
      { n: "麦田音乐KTV" },
    ],
  },
  {
    keys: ["羽毛球"],
    type: "体育休闲服务;运动场馆;羽毛球场",
    cost: [30, 60],
    names: [
      { n: "飞羽羽毛球馆" },
      { n: "羽动羽毛球馆" },
      { n: "白鹭羽毛球俱乐部" },
      { n: "全民健身羽毛球中心" },
      { n: "星羽羽毛球馆" },
    ],
  },
  {
    keys: ["台球", "桌球"],
    type: "体育休闲服务;娱乐场所;台球厅",
    cost: [30, 60],
    names: [{ n: "一杆清台球" }, { n: "黑八台球俱乐部" }, { n: "星空台球厅" }],
  },
  {
    keys: ["咖啡"],
    type: "餐饮服务;咖啡厅;咖啡厅",
    cost: [30, 50],
    names: [{ n: "湖边咖啡" }, { n: "慢半拍咖啡" }, { n: "拾光咖啡馆" }, { n: "白昼咖啡" }],
  },
];

const GENERIC_PREFIX = ["悦", "聚", "乐享", "星河", "湖畔", "邻里", "拾光", "小巷"];
const GENERIC_SUFFIX = ["馆", "坊", "空间", "工坊", "之家", "俱乐部"];

const SUZHOU_BRANCHES = [
  "星湖街", "金鸡湖", "独墅湖", "月亮湾", "仁爱路", "松涛街", "东平街", "现代大道",
  "苏州中心", "圆融", "李公堤", "湖东", "湖西", "斜塘", "娄葑", "星海街", "文星广场", "翰林邻里",
];
const GENERIC_BRANCHES = ["中心", "东门", "站前", "广场", "大学城", "滨江", "新区", "步行街"];
const SUZHOU_STREETS = [
  "星湖街", "仁爱路", "松涛街", "东平街", "现代大道", "苏州大道东", "星海街",
  "金鸡湖大道", "若水路", "林泉街", "启月街", "独墅湖大道", "月亮湾路", "东方大道",
];
const GENERIC_STREETS = ["中山路", "人民路", "解放路", "建设路", "文化路", "学府路", "滨江路", "新华路"];

function findCatalog(keyword: string): CatalogEntry | undefined {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return undefined;
  return CATALOG.find((e) => e.keys.some((k) => kw.includes(k) || k.includes(kw)));
}

function pick<T>(arr: T[], r: number): T {
  return arr[Math.min(arr.length - 1, Math.floor(r * arr.length))];
}

const CELL_DEG = 0.01;

/** 生成某个格子里、某个关键词下的店（只依赖关键词和格子坐标） */
function shopsInCell(keyword: string, ci: number, cj: number, suzhou: boolean): Poi[] {
  const seed = hashString(`cell|${keyword.toLowerCase()}|${ci}|${cj}`);
  const rnd = seededRandom(seed);
  const count = Math.floor(rnd() * 3); // 0..2，平均每平方公里约 1 家
  const entry = findCatalog(keyword);
  const out: Poi[] = [];
  for (let k = 0; k < count; k++) {
    const lat = round6((ci + rnd()) * CELL_DEG);
    const lng = round6((cj + rnd()) * CELL_DEG);
    let baseName: string;
    let type: string;
    let cost: number;
    if (entry) {
      const nm = pick(entry.names, rnd());
      baseName = nm.n;
      type = nm.t ?? entry.type;
      cost = Math.round(entry.cost[0] + rnd() * (entry.cost[1] - entry.cost[0]));
    } else {
      baseName = `${pick(GENERIC_PREFIX, rnd())}${keyword.trim()}${pick(GENERIC_SUFFIX, rnd())}`;
      type = "体育休闲服务;娱乐场所;娱乐场所";
      cost = Math.round(50 + rnd() * 70);
    }
    const branch = suzhou ? pick(SUZHOU_BRANCHES, rnd()) : pick(GENERIC_BRANCHES, rnd());
    const street = suzhou ? pick(SUZHOU_STREETS, rnd()) : pick(GENERIC_STREETS, rnd());
    const no = 10 + Math.floor(rnd() * 590);
    const rating = Math.round((3.6 + Math.floor(rnd() * 14) / 10) * 10) / 10; // 3.6–4.9
    const telTail = String(1000000 + Math.floor(rnd() * 8999999)).slice(-7);
    out.push({
      id: `mock-${hashString(`${keyword}|${ci}|${cj}|${k}`).toString(36)}`,
      name: `${baseName}(${branch}店)`,
      address: `${street}${no}号`,
      lat,
      lng,
      rating,
      costPerPerson: cost,
      type,
      tel: suzhou ? `0512-6${telTail}` : undefined,
    });
  }
  return out;
}

// ---------------- Provider ----------------

export function createMockMapProvider(): MapProvider {
  return {
    async searchPlaces(q: string, city: string): Promise<Place[]> {
      const query = (q ?? "").trim();
      const list = landmarksFor(city);
      if (!query) return list.slice(0, 8).map((p) => ({ ...p }));
      const scored = list
        .map((p, i) => ({ p, i, s: matchScore(p.label, query) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s || a.i - b.i)
        .slice(0, 8)
        .map((x) => ({ ...x.p }));
      if (scored.length > 0) return scored;
      // 没匹配上：在 DEMO_CENTER 附近按 q 确定性地造一个点，保证随便输什么都能继续
      const center = getDemoCenter();
      const rnd = seededRandom(hashString(`place|${query}`));
      const angle = rnd() * Math.PI * 2;
      const km = 1 + rnd() * 6;
      return [{ label: query, ...offsetKm(center, km * Math.cos(angle), km * Math.sin(angle)) }];
    },

    async reverseGeocode(p: LatLng): Promise<string> {
      const center = getDemoCenter();
      const candidates =
        haversineKm(center, SUZHOU_REF) < 60
          ? SUZHOU_LANDMARKS
          : [...SHANGHAI_LANDMARKS, ...landmarksFor((process.env.DEMO_CITY || "").trim() || "本地")];
      let best = candidates[0];
      let bestD = Infinity;
      for (const c of candidates) {
        const d = haversineKm(p, c);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      return `${best.label}附近`;
    },

    async searchAround(center: LatLng, keywords: string[], radiusM: number, city: string): Promise<Poi[]> {
      const kws = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))];
      if (kws.length === 0) return [];
      const suzhou = isSuzhou(city);
      const radiusKm = Math.max(0.1, radiusM / 1000);
      const dLat = radiusKm / 111.32 + CELL_DEG;
      const dLng = radiusKm / (111.32 * Math.cos((center.lat * Math.PI) / 180)) + CELL_DEG;
      const i0 = Math.floor((center.lat - dLat) / CELL_DEG);
      const i1 = Math.floor((center.lat + dLat) / CELL_DEG);
      const j0 = Math.floor((center.lng - dLng) / CELL_DEG);
      const j1 = Math.floor((center.lng + dLng) / CELL_DEG);

      const found: { poi: Poi; d: number }[] = [];
      for (const kw of kws) {
        for (let i = i0; i <= i1; i++) {
          for (let j = j0; j <= j1; j++) {
            for (const poi of shopsInCell(kw, i, j, suzhou)) {
              const d = haversineKm(center, poi);
              if (d <= radiusKm) found.push({ poi, d });
            }
          }
        }
      }
      found.sort((a, b) => a.d - b.d || (a.poi.id < b.poi.id ? -1 : a.poi.id > b.poi.id ? 1 : 0));

      // 同名同分店只留最近的一家
      const seen = new Set<string>();
      const unique: Poi[] = [];
      for (const f of found) {
        if (seen.has(f.poi.name) || seen.has(f.poi.id)) continue;
        seen.add(f.poi.name);
        seen.add(f.poi.id);
        unique.push(f.poi);
      }
      // 结果条数 12–20，由中心所在格子和关键词决定
      const limitRnd = seededRandom(
        hashString(`limit|${kws.join("|")}|${Math.floor(center.lat / CELL_DEG)}|${Math.floor(center.lng / CELL_DEG)}`),
      );
      const limit = 12 + Math.floor(limitRnd() * 9);
      return unique.slice(0, limit);
    },

    async commute(origins: LatLng[], dest: LatLng) {
      return origins.map((o) => estimateCommute(o, dest));
    },
  };
}

export const mockMapProvider: MapProvider = createMockMapProvider();
