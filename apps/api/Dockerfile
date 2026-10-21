# Laundry API + worker image (production).
# Builds the NestJS API and background worker from this monorepo with pnpm,
# then runs both under Node 24 with tsx against the compiled workspace.
# Local demo/dev behavior is unchanged: `pnpm dev:api` still uses tsx watch.
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages ./packages
COPY modules ./modules
COPY apps/api ./apps/api
COPY apps/worker ./apps/worker
COPY assets ./assets
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @laundry/contracts build \
 && pnpm --filter @laundry/api build \
 && pnpm --filter @laundry/worker build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable
COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=build /app/packages ./packages
COPY --from=build /app/modules ./modules
COPY --from=build /app/apps ./apps
COPY --from=build /app/assets ./assets
RUN pnpm install --frozen-lockfile --prod=false
EXPOSE 4100
# The compiled dist/ is CommonJS while the workspace packages declare
# `"type": "module"`, so plain `node dist/...` fails with
# "exports is not defined in ES module scope". tsx resolves TS paths and
# decorators the same way local `pnpm dev:api` does.
# The entrypoint requires DATABASE_URL, DEMO_MODE=false, and live
# WHATSAPP_*/RAZORPAY_* credentials; the API refuses to boot in
# NODE_ENV=production without them (see apps/api/src/main.ts).
CMD ["sh", "-c", "./node_modules/.bin/tsx --tsconfig apps/api/tsconfig.json apps/api/src/main.ts"]
