import type { NextConfig } from 'next';
const config: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@weego/contracts'],
  poweredByHeader: false,
  // The API artifact must never sweep probes, source documents or private env files.
  outputFileTracingExcludes: {
    '/*': ['../../.working/**/*', '../../outputs/**/*', '../../docs/**/*', '../../data/**/*', '../../apps/miniprogram/**/*', '../../.env*', './.env*', '../../node_modules/.pnpm/@tarojs*/**/*']
  }
};
export default config;
