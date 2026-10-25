import { handle, readJson } from '../http';
import type { createAiCreationProvider } from './creation';

export function createAiCreationHandler(
  identity: { authenticate(authorization: string | null): Promise<{ user_id: string }> },
  provider: Pick<ReturnType<typeof createAiCreationProvider>, 'generate'>,
) {
  return (request: Request) => handle(async () => {
    const user = await identity.authenticate(request.headers.get('authorization'));
    return provider.generate(user.user_id, await readJson(request, 8192));
  }, request);
}
