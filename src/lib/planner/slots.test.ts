import { describe, expect, it } from "vitest";
import { generateSlots } from "./index";
import { spec } from "./testutil";

describe("generateSlots", () => {
  it("单日 30 分钟一档，latest 本身也算，带 +08:00", () => {
    const slots = generateSlots(spec({ earliest: "18:00", latest: "20:00", durationMinutes: 150 }));
    expect(slots.map((s) => s.id)).toEqual([
      "2026-10-23T18:00",
      "2026-10-23T18:30",
      "2026-10-23T19:00",
      "2026-10-23T19:30",
      "2026-10-23T20:00",
    ]);
    expect(slots[0].start).toBe("2026-10-23T18:00:00+08:00");
    expect(slots[0].end).toBe("2026-10-23T20:30:00+08:00");
    // 跨午夜
    expect(slots[4].end).toBe("2026-10-23T22:30:00+08:00");
    expect(new Date(slots[0].start).toISOString()).toBe("2026-10-23T10:00:00.000Z");
  });

  it("超过 12 个改为 60 分钟一档", () => {
    const slots = generateSlots(spec({ dates: ["2026-10-23", "2026-10-24"], earliest: "18:00", latest: "21:00" }));
    // 30 分钟会是 14 个 → 改 60 分钟 → 每天 4 个
    expect(slots.map((s) => s.id)).toEqual([
      "2026-10-23T18:00",
      "2026-10-23T19:00",
      "2026-10-23T20:00",
      "2026-10-23T21:00",
      "2026-10-24T18:00",
      "2026-10-24T19:00",
      "2026-10-24T20:00",
      "2026-10-24T21:00",
    ]);
  });

  it("60 分钟仍超就截断到 12 个", () => {
    const slots = generateSlots(
      spec({ dates: ["2026-10-23", "2026-10-24", "2026-10-25"], earliest: "10:00", latest: "20:00" }),
    );
    expect(slots).toHaveLength(12);
    expect(slots[11].id).toBe("2026-10-24T10:00");
  });

  it("结束时间跨日、跨月", () => {
    const [s] = generateSlots(spec({ dates: ["2026-10-31"], earliest: "23:00", latest: "23:00", durationMinutes: 120 }));
    expect(s.end).toBe("2026-11-01T01:00:00+08:00");
  });

  it("不依赖机器时区", () => {
    const old = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    const a = generateSlots(spec());
    process.env.TZ = "UTC";
    const b = generateSlots(spec());
    process.env.TZ = old;
    expect(a).toEqual(b);
    expect(a[0].start).toBe("2026-10-23T18:00:00+08:00");
  });
});
