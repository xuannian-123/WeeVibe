# Build from repository root: docker build -f apps/web/Dockerfile -t weego-api:local .
# Prepared locally; Linux image build has not yet been executed on this machine.
FROM node:24-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@11.15.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web ./apps/web
COPY packages/contracts ./packages/contracts
COPY prisma ./prisma
COPY scripts/prisma-check.mjs ./scripts/prisma-check.mjs
RUN pnpm install --frozen-lockfile --filter weego --filter @weego/web...
RUN pnpm db:generate
RUN pnpm build:api
RUN mkdir -p apps/web/public

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/api/v1/health').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"
CMD ["node", "apps/web/server.js"]
