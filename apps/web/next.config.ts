import type { NextConfig } from 'next';
import path from 'node:path';
const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.resolve(__dirname, '../..'),
  transpilePackages: ['@weevibe/contracts'],
  poweredByHeader: false,
  // Generated Prisma client loads this WASM through a computed fs path; NFT
  // traces the JS loader but needs an explicit include for the runtime file.
  outputFileTracingIncludes: {
    '/api/v1/**': ['../../node_modules/.pnpm/@prisma+client*/node_modules/.prisma/client/query_compiler_bg.wasm']
  },
  // The API artifact must never sweep probes, source documents or private env files.
  outputFileTracingExcludes: {
    '/*': ['../../.working/**/*', '../../outputs/**/*', '../../docs/**/*', '../../data/**/*', '../../apps/miniprogram/**/*', '../../.env*', './.env*', '../../node_modules/.pnpm/@tarojs*/**/*']
  }
};
export default config;
