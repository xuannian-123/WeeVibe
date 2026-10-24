import { z } from 'zod';

// WeChat forbids dynamically compiled functions. Configure before any page
// imports the shared contracts, because Zod captures this when schemas are built.
z.config({ jitless: true });
