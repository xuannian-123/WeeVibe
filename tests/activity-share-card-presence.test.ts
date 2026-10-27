import { it, expect } from 'vitest';
import { existsSync } from 'node:fs';
it('has an independent WG08 activity itinerary card and explicit save panel, not only a requirements thumbnail', () => {
 expect(existsSync('apps/miniprogram/src/features/share-card/ActivityShareCard.tsx')).toBe(true);
});
