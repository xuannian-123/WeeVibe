import { z } from "zod";
import { getMapProvider, wgs84ToGcj02 } from "../map";
import type { Place } from "../types";
import { HttpError } from "./http";
import { defaultCity } from "./ju";

export async function geoSearch(url: URL): Promise<Place[]> {
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 50);
  const city = (url.searchParams.get("city") ?? "").trim() || defaultCity();
  return getMapProvider().searchPlaces(q, city);
}

const reverseQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  from: z.enum(["wgs84", "gcj02"]).optional(),
});

export async function geoReverse(url: URL): Promise<Place> {
  const r = reverseQuery.safeParse({
    lat: url.searchParams.get("lat") ?? undefined,
    lng: url.searchParams.get("lng") ?? undefined,
    from: url.searchParams.get("from") || undefined,
  });
  if (!r.success) throw new HttpError(400, "参数不合法：需要 lat、lng（数字），from 可选 wgs84");
  const raw = { lat: r.data.lat, lng: r.data.lng };
  const p = r.data.from === "wgs84" ? wgs84ToGcj02(raw) : raw;
  let label = "";
  try {
    label = await getMapProvider().reverseGeocode(p);
  } catch (e) {
    console.warn(`[geo] reverseGeocode 失败：${(e as Error).message}`);
  }
  return { lat: p.lat, lng: p.lng, label: label || "我的位置" };
}
