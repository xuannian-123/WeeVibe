import { describe, expect, it } from "vitest";
import { guardAvatarSay } from "./avatarAgent";

const g = { names: ["小林", "秘密小橘"], notes: ["今天加班七点四十才能走"], allowedNumbers: new Set([19, 0, 53]) };

describe("分身的话公开前的兜底", () => {
  it("正常的话放行", () => {
    expect(guardAvatarSay("晚到 53 分钟我也来，行。", g)).toBe("晚到 53 分钟我也来，行。");
    expect(guardAvatarSay("这次我就想安静聊聊，别太吵就行🙂", g)).toBeDefined();
    expect(guardAvatarSay("等我一下，我想一起去", g)).toBeDefined();
  });
  it("预算数字（阿拉伯 / 中文）都拦下", () => {
    expect(guardAvatarSay("人均一百五以内我觉得挺合适", g)).toBeUndefined();
    expect(guardAvatarSay("人均 80 以内就行", g)).toBeUndefined();
    expect(guardAvatarSay("八十块左右最好", g)).toBeUndefined();
    expect(guardAvatarSay("别超过两百", g)).toBeUndefined();
  });
  it("名字、底线原因、私聊原话、没出现过的数字都拦下", () => {
    expect(guardAvatarSay("我是小林的分身", g)).toBeUndefined();
    expect(guardAvatarSay("我宿舍有门禁", g)).toBeUndefined();
    expect(guardAvatarSay("今天加班七点四十才能走", g)).toBeUndefined();
    expect(guardAvatarSay("我 21 点前得走", g)).toBeUndefined();
  });
});
