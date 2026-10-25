import { handle, readJson } from '../../http';
import type { createAmapProvider } from '../amap';

type Provider = ReturnType<typeof createAmapProvider>;
type Identity = { authenticate(authorization: string | null): Promise<{ user_id: string }> };
export function createVenueHandler(operation: keyof Provider, identity: Identity, provider: Provider) {
  return (request: Request) => handle(async () => {
    // Authentication always precedes provider input/configuration and rate checks.
    // Never accept user_id/OpenID/URL claims from the body as identity.
    const user = await identity.authenticate(request.headers.get('authorization'));
    const input = await readJson(request);
    return provider[operation](user.user_id, input);
  }, request);
}
