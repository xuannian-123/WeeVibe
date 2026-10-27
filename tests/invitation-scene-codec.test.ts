import { describe, expect, it } from 'vitest';
import {
  activityEntryFromParams, invitationIdFromScene, invitationSceneFromId
} from '../apps/miniprogram/src/features/invitations/scene';
import { activityIdSchema } from '../packages/contracts/src';

const id = '550e8400-e29b-41d4-a716-446655440000';
const scene = id.replaceAll('-', '');
const fullyEncoded = [...scene].map(char => `%${char.charCodeAt(0).toString(16)}`).join('');

describe('invitation scene codec', () => {
  it.each([id, id.toUpperCase()])('encodes a validated UUID as canonical 32 lower hex: %s', value => {
    expect(invitationSceneFromId(value)).toBe(scene);
  });

  it.each([
    scene, scene.toUpperCase(), `%35${scene.slice(1)}`, fullyEncoded,
    [...scene.toUpperCase()].map(char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`).join('')
  ])('decodes one raw or once-encoded scene into the canonical UUID: %s', value => {
    expect(invitationIdFromScene(value)).toBe(id);
  });

  it('permits exactly the 96-character fully encoded boundary', () => {
    expect(fullyEncoded).toHaveLength(96);
    expect(invitationIdFromScene(fullyEncoded)).toBe(id);
    expect(invitationIdFromScene(`${fullyEncoded}0`)).toBeUndefined();
  });

  it.each(Array.from({ length: 8 }, (_, index) => index + 1).flatMap(version =>
    ['8', '9', 'a', 'b'].map(variant => `550e8400-e29b-${version}1d4-${variant}716-446655440000`)
  ))('round-trips valid UUID version/variant combinations: %s', value => {
    const encoded = invitationSceneFromId(value);
    expect(encoded).toBe(value.replaceAll('-', ''));
    expect(invitationIdFromScene(encoded)).toBe(value);
  });

  it.each([
    '00000000-0000-0000-0000-000000000000',
    'ffffffff-ffff-ffff-ffff-ffffffffffff'
  ])('keeps special UUID acceptance aligned with the existing contract: %s', value => {
    const parsed = activityIdSchema.safeParse(value);
    expect(invitationSceneFromId(value)).toBe(parsed.success ? parsed.data.replaceAll('-', '') : undefined);
    expect(invitationIdFromScene(value.replaceAll('-', ''))).toBe(parsed.success ? parsed.data : undefined);
  });

  it.each([
    undefined, null, false, 123, {}, [], [scene], new String(scene), '', scene,
    ` ${id}`, `${id} `, `${id}\n`, `{${id}}`, `urn:uuid:${id}`, encodeURIComponent(id).replace('-', '%2D'),
    '550e8400-e29b-01d4-a716-446655440000', '550e8400-e29b-91d4-a716-446655440000',
    '550e8400-e29b-41d4-7716-446655440000', '550e8400-e29b-41d4-c716-446655440000'
  ])('rejects invalid UUID encoder input %#', value => {
    expect(invitationSceneFromId(value)).toBeUndefined();
  });

  it.each([
    undefined, null, false, 123, {}, [], [scene], new String(scene), '',
    scene.slice(1), `${scene}0`, 'g'.repeat(32), id, id.replaceAll('-', '%2D'),
    ` ${scene}`, `${scene} `, `${scene}\n`, `${scene}\r`, `${scene}\t`, `\0${scene}`, `${scene}\u2028`,
    `%20${scene}`, `${scene}%20`, `${scene}%0A`, `${scene}%00`, `${scene}%09`,
    `+${scene}`, `${scene}+`, `${scene}%2B`, `${scene.slice(0, 8)}+${scene.slice(9)}`,
    '%', '%3', '%GG', '%E0%A4%A', '%C0%AF', `${scene}%`, `%2535${scene.slice(1)}`,
    fullyEncoded.replaceAll('%', '%25'), 'a'.repeat(97), `%E9%9B%AA${scene.slice(1)}`,
    `${scene}&id=${id}`, `${scene}#fragment`, `${scene}?extra=1`, `scene=${scene}`,
    '550e8400e29b01d4a716446655440000', '550e8400e29b91d4a716446655440000',
    '550e8400e29b41d40716446655440000', '550e8400e29b41d47716446655440000',
    '550e8400e29b41d4c716446655440000', '550e8400e29b41d4f716446655440000'
  ])('rejects malformed, mixed, overlong, or multiply encoded scene input %#', value => {
    expect(invitationIdFromScene(value)).toBeUndefined();
  });
});

describe('activity entry parameters', () => {
  it.each([
    {}, { id }, { id, invitation_id: id }, { id: 'legacy-invalid-id', extra: 'unchanged' },
    { Scene: scene }, { SCENE: scene }, { '%73cene': scene },
    Object.assign(Object.create({ scene }), { id })
  ])('does not change the legacy path without an own exact scene key %#', params => {
    expect(activityEntryFromParams(params)).toEqual({ kind: 'standard' });
  });

  it.each([scene, scene.toUpperCase(), fullyEncoded])('recognizes only a valid scene-only entry: %s', value => {
    expect(activityEntryFromParams({ scene: value })).toEqual({ kind: 'scene', invitationId: id, scene });
  });

  it('accepts a scene-only object without a prototype', () => {
    expect(activityEntryFromParams(Object.assign(Object.create(null), { scene })))
      .toEqual({ kind: 'scene', invitationId: id, scene });
  });

  it.each<Record<string, unknown>>([
    { scene: undefined }, { scene: null }, { scene: '' }, { scene: false }, { scene: [scene, scene] },
    { scene: id }, { scene: `${scene} ` }, { scene: `%2535${scene.slice(1)}` },
    { scene, id }, { scene, invitation_id: id }, { scene, id, invitation_id: id },
    { scene, extra: '' }, { scene, id: undefined }, { scene, Scene: scene }, { scene, SCENE: scene },
    { scene, toString: 'extra' }, { scene, hasOwnProperty: 'extra' },
    { scene, [Symbol('extra')]: true }, Object.defineProperty({ scene }, 'hidden', { value: true })
  ])('rejects a present invalid scene or any mixed own parameter %#', params => {
    expect(activityEntryFromParams(params)).toEqual({ kind: 'invalid' });
  });

  it('does not mutate the supplied parameters', () => {
    const params = Object.freeze({ scene: scene.toUpperCase() });
    expect(activityEntryFromParams(params)).toEqual({ kind: 'scene', invitationId: id, scene });
    expect(params.scene).toBe(scene.toUpperCase());
  });
});
