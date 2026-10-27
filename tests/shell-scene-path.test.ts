import { describe, expect, it } from 'vitest';
import { activityPathFromScan } from '../apps/miniprogram/src/features/shell/helpers';

const id = '550e8400-e29b-41d4-a716-446655440000';
const scene = id.replaceAll('-', '');
const invitationId = '660e8400-e29b-41d4-a716-446655440000';
const encodedScene = [...scene].map(char => `%${char.charCodeAt(0).toString(16)}`).join('');

describe('strict invitation scene scan paths', () => {
  it('accepts a scene entry through the real scan helper', () => {
    expect(activityPathFromScan(`pages/activity/index?scene=${scene.toUpperCase()}`))
      .toBe(`/pages/activity/index?scene=${scene}`);
  });

  it('keeps the legacy id path control unchanged', () => {
    expect(activityPathFromScan(` /PAGES/ACTIVITY/INDEX?ID=${id.toUpperCase()} `))
      .toBe(`/pages/activity/index?id=${id.toUpperCase()}`);
  });

  it.each([
    `/pages/activity/index?scene=${scene}`,
    `pages/activity/index?scene=${scene}`,
    `/pages/activity/index?scene=${scene.toUpperCase()}`,
    `/pages/activity/index?scene=%35${scene.slice(1)}`,
    `/pages/activity/index?scene=${encodedScene}`
  ])('canonicalizes a strict internal scene scan: %s', value => {
    expect(activityPathFromScan(value)).toBe(`/pages/activity/index?scene=${scene}`);
  });

  it.each([
    `/pages/activity/index?scene=`, `/pages/activity/index?scene=${id}`,
    `/pages/activity/index?scene=${scene.slice(1)}`, `/pages/activity/index?scene=${scene}0`,
    `/pages/activity/index?scene=${'g'.repeat(32)}`, `/pages/activity/index?scene=${'a'.repeat(97)}`,
    `/pages/activity/index?scene=550e8400e29b01d4a716446655440000`,
    `/pages/activity/index?scene=550e8400e29b41d4c716446655440000`,
    `/pages/activity/index?scene=%`, `/pages/activity/index?scene=%GG`,
    `/pages/activity/index?scene=%2535${scene.slice(1)}`,
    `/pages/activity/index?scene=${encodedScene.replaceAll('%', '%25')}`,
    `/pages/activity/index?scene=${scene} `, `/pages/activity/index?scene= ${scene}`,
    `/pages/activity/index?scene=${scene}\n`, `/pages/activity/index?scene=${scene}\r`,
    `/pages/activity/index?scene=${scene}\0`, `/pages/activity/index?scene=${scene}%0A`,
    `/pages/activity/index?scene=${scene}%20`, `/pages/activity/index?scene=+${scene}`,
    `/pages/activity/index?scene=${scene}%2B`,
    ` /pages/activity/index?scene=${scene}`, `/PAGES/ACTIVITY/INDEX?scene=${scene}`,
    `/pages/activity/index?SCENE=${scene}`, `/pages/activity/index?%73cene=${scene}`,
    `/pages/activity/index?scene=${scene}&scene=${scene}`,
    `/pages/activity/index?scene=${scene}&id=${id}`, `/pages/activity/index?id=${id}&scene=${scene}`,
    `/pages/activity/index?scene=${scene}&invitation_id=${invitationId}`,
    `/pages/activity/index?scene=${scene}&extra=1`, `/pages/activity/index?extra=1&scene=${scene}`,
    `/pages/activity/index?scene=${scene}&`, `/pages/activity/index?scene=${scene}%26id%3D${id}`,
    `/pages/activity/index?scene=${scene}#fragment`, `/pages/activity/index?scene=${scene}%23fragment`,
    `/pages/activity/index?scene=${scene}?extra=1`, `/pages/activity/index?scene=${scene};id=${id}`,
    `https://evil.example/pages/activity/index?scene=${scene}`,
    `weixin://pages/activity/index?scene=${scene}`, `//pages/activity/index?scene=${scene}`,
    `/pages/editor/index?scene=${scene}`, `/pages/activity/index/?scene=${scene}`,
    `/pages/activity/../activity/index?scene=${scene}`
  ])('rejects noncanonical paths and unsafe scene payloads: %s', value => {
    expect(activityPathFromScan(value)).toBeUndefined();
  });

  it.each([
    [`pages/activity/index?id=${id}`, `/pages/activity/index?id=${id}`],
    [`/pages/activity/index?id=${id}`, `/pages/activity/index?id=${id}`],
    [` \n/pages/activity/index?id=${id}\t `, `/pages/activity/index?id=${id}`],
    [`PAGES/ACTIVITY/INDEX?ID=${id.toUpperCase()}`, `/pages/activity/index?id=${id.toUpperCase()}`],
    [` /PAGES/ACTIVITY/INDEX?ID=${id.toUpperCase()}&INVITATION_ID=${invitationId.toUpperCase()} `,
      `/pages/activity/index?id=${id.toUpperCase()}&invitation_id=${invitationId.toUpperCase()}`],
    [`/pages/activity/index?id=${id}&invitation_id=${invitationId}`,
      `/pages/activity/index?id=${id}&invitation_id=${invitationId}`]
  ])('preserves the legacy scan behavior exactly: %s', (value, expected) => {
    expect(activityPathFromScan(value)).toBe(expected);
  });

  it.each([
    `/pages/activity/index?id=${id}&id=${id}`,
    `/pages/activity/index?id=${id}&invitation_id=${invitationId}&invitation_id=${invitationId}`,
    `/pages/activity/index?invitation_id=${invitationId}&id=${id}`,
    `/pages/activity/index?id=${id}&unknown=1`, `/pages/activity/index?id=${id}#fragment`,
    `/pages/activity/index?id=%35${id.slice(1)}`,
    `https://evil.example/pages/activity/index?id=${id}`,
    `//pages/activity/index?id=${id}`,
    '/pages/activity/index?id=550e8400-e29b-01d4-a716-446655440000',
    '/pages/activity/index?id=550e8400-e29b-41d4-c716-446655440000'
  ])('keeps rejecting unsafe legacy routes: %s', value => {
    expect(activityPathFromScan(value)).toBeUndefined();
  });
});
