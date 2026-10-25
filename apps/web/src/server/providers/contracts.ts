// Structured provider boundary. Validate against a trusted snapshot before display;
// a provider response never authorizes a write or marks a reservation as complete.
import type { AiSnapshot, AiCreationDraft, AiInvitation, AiCoordinationProposal } from '@weevibe/contracts/src/ai';
import type { createAmapProvider } from './amap';
export interface ModelProvider {
  activityDraft(input: { text: string; timezone: string; selectedDate: string; sourceRevision: number }): Promise<AiCreationDraft>;
  invitationFacts(input: { snapshot: AiSnapshot }): Promise<AiInvitation>;
  timeCoordinationDraft(input: { snapshot: AiSnapshot; request: string }): Promise<AiCoordinationProposal>;
}
// Search, nearby and walk share the authenticated business user and query schemas.
export type VenueProvider = ReturnType<typeof createAmapProvider>;
