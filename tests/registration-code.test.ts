import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { applicationDetail, applicationActivity, applicationId, applicantB } from './application-fixtures';
import { loadRegistrationCode, registrationCodeTarget, type RegistrationCodeTarget } from '../apps/miniprogram/src/features/share-card/registration-code';
import { invitationIdFromScene } from '../apps/miniprogram/src/features/invitations/scene';
const source = () => ({ invitation_id: applicationId, activity_id: applicationActivity, title: '公开活动', inviter_display_name: '公开分享者', inviter_avatar_url: null, starts_at: null, ends_at: null, timezone: 'Asia/Shanghai', cancelled: false, source_only: true });
// Real bundled image bytes validate the transport shape only; this is deliberately NOT a QR code.
const png = readFileSync('apps/miniprogram/src/assets/gathering-animals/cat.png').toString('base64');
const result = (target: RegistrationCodeTarget) => ({ activity_id: target.activity_id, invitation_id: target.invitation_id, page: target.page, scene: target.scene, env_version: target.env_version, image: { content_type: 'image/png', base64: png } });
const setup = () => ({ readSource: vi.fn().mockResolvedValue(source()), generate: vi.fn().mockImplementation(async target => result(target)), assertCurrent: vi.fn() });

describe('isolated future registration-code adapter (no real provider or deployed route)', () => {
  it.each(['trial', 'develop', 'release'] as const)('retains a verified source as a 32-character scene for %s, without secrets or personal fields', env => {
    const detail = applicationDetail(); const target = registrationCodeTarget(detail, source(), env);
    expect(target).toEqual({ activity_id: applicationActivity, invitation_id: applicationId, page: 'pages/activity/index', scene: applicationId.replaceAll('-', ''), env_version: env, check_path: true, width: 430 });
    expect(invitationIdFromScene(target.scene)).toBe(applicationId);
    expect(JSON.stringify(target)).not.toContain(detail.viewer.user_id);
    expect(JSON.stringify(target)).not.toMatch(/token|openid|nickname|avatar|contact/i);
  });
  it.each(['cancelled', 'source-cancelled', 'wrong-activity', 'empty', 'all-cancelled'])('rejects %s before calling a provider', async kind => {
    const detail = applicationDetail(), ports = setup();
    if (kind === 'cancelled') detail.cancelled_at = detail.server_time;
    if (kind === 'source-cancelled') ports.readSource.mockResolvedValue({ ...source(), cancelled: true });
    if (kind === 'wrong-activity') ports.readSource.mockResolvedValue({ ...source(), activity_id: applicantB });
    if (kind === 'empty') detail.segments = [];
    if (kind === 'all-cancelled') detail.segments[0].cancelled_at = detail.server_time;
    await expect(loadRegistrationCode(detail, applicationId, 'trial', ports)).rejects.toThrow(); expect(ports.generate).not.toHaveBeenCalled();
  });
  it('does not accept an arbitrary UUID as evidence of a real source', async () => {
    const ports = setup(); ports.readSource.mockRejectedValue(new Error('not found'));
    await expect(loadRegistrationCode(applicationDetail(), applicationId, 'trial', ports)).rejects.toThrow(); expect(ports.generate).not.toHaveBeenCalled();
  });
  it('rejects invalid ids and unsupported environments before transport', async () => {
    for (const [id, env] of [['token=secret', 'trial'], [applicationId, 'production']] as const) {
      const ports = setup(); await expect(loadRegistrationCode(applicationDetail(), id, env as 'trial', ports)).rejects.toThrow(); expect(ports.readSource).not.toHaveBeenCalled();
    }
  });
  it('checks source ownership and page/session freshness before provider invocation', async () => {
    const ports = setup(); ports.assertCurrent.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error('STALE'); });
    await expect(loadRegistrationCode(applicationDetail(), applicationId, 'trial', ports)).rejects.toThrow('STALE'); expect(ports.generate).not.toHaveBeenCalled();
    ports.assertCurrent.mockReset(); ports.readSource.mockResolvedValue({ ...source(), invitation_id: applicantB });
    await expect(loadRegistrationCode(applicationDetail(), applicationId, 'trial', ports)).rejects.toThrow('CODE_SOURCE_MISMATCH');
  });
  it.each(['activity_id', 'invitation_id', 'scene', 'env_version', 'page', 'extra', 'url', 'mime', 'oversized', 'html'])('rejects a mismatched or unsafe %s response', async kind => {
    const ports = setup(); ports.generate.mockImplementation(async target => {
      const response: Record<string, unknown> = result(target);
      if (kind === 'activity_id' || kind === 'invitation_id') response[kind] = applicantB;
      if (kind === 'scene') response.scene = applicantB.replaceAll('-', '');
      if (kind === 'env_version') response.env_version = 'release';
      if (kind === 'page') response.page = 'pages/admin/index';
      if (kind === 'extra') response.access_token = 'PRIVATE_SENTINEL';
      if (kind === 'url') response.image = { url: 'https://example.invalid/private' };
      if (kind === 'mime') response.image = { content_type: 'image/svg+xml', base64: png };
      if (kind === 'oversized') response.image = { content_type: 'image/png', base64: 'A'.repeat(700004) };
      return kind === 'html' ? '<html>provider error</html>' : response;
    });
    await expect(loadRegistrationCode(applicationDetail(), applicationId, 'trial', ports)).rejects.toThrow();
  });
  it('ignores a provider response after the owner becomes stale', async () => {
    const ports = setup(); ports.generate.mockImplementation(async target => { ports.assertCurrent.mockImplementation(() => { throw new Error('STALE'); }); return result(target); });
    await expect(loadRegistrationCode(applicationDetail(), applicationId, 'trial', ports)).rejects.toThrow('STALE');
  });
  it('allows a bounded, matching image response without treating the test image as scannable', async () => {
    const ports = setup(); const response = await loadRegistrationCode(applicationDetail(), applicationId, 'trial', ports);
    expect(response.image.base64).toBe(png); expect(ports.readSource).toHaveBeenCalledOnce(); expect(ports.generate).toHaveBeenCalledOnce();
  });
});
