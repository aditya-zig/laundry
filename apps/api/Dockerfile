# Actual compiled Node artifacts. API and worker are separate processes; this
# image defaults to API only. It is not a production-v2 readiness certificate.
FROM node:24.22.0-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.json tsconfig.base.json ./
COPY patches ./patches
COPY packages ./packages
COPY modules ./modules
COPY apps/api ./apps/api
COPY apps/worker ./apps/worker
# Keep the frozen workspace graph/patches reproducible without copying frontend
# sources, browser recordings, credentials or developer caches into the context.
COPY apps/customer/package.json ./apps/customer/package.json
COPY apps/partner/package.json ./apps/partner/package.json
COPY apps/ops/package.json ./apps/ops/package.json
COPY apps/pilot-console/package.json ./apps/pilot-console/package.json
COPY tools/build-node.mjs ./tools/build-node.mjs
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @laundry/contracts build \
 && pnpm --filter @laundry/api build \
 && pnpm --filter @laundry/worker build \
 && pnpm --filter @laundry/api deploy --prod --legacy /out/api \
 && pnpm --filter @laundry/worker deploy --prod --legacy /out/worker

FROM node:24.22.0-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0
WORKDIR /app
COPY --from=build /out/api ./api
COPY --from=build /out/worker ./worker
COPY --from=build /app/modules/schema/migrations ./modules/schema/migrations
COPY assets/services ./assets/services
USER node
EXPOSE 4100
# Startup requires explicit TLS DB, HTTPS origins, non-demo identity/provider
# configuration and send budget. No development TypeScript loader is required.
# The legacy worker is not automatically launched or called production-v2 ready.
CMD ["node", "api/dist/apps/api/src/main.js"]
