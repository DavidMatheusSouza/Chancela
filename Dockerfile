# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS base
RUN corepack enable && apk add --no-cache libc6-compat
WORKDIR /app

# ---- dependencies -----------------------------------------------------------
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/policy-engine/package.json packages/policy-engine/
COPY packages/ai/package.json packages/ai/
COPY packages/contracts/package.json packages/contracts/
RUN pnpm install --frozen-lockfile=false

# ---- build ------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY . .
RUN pnpm --filter @trustagent/web build

# ---- runtime ----------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
RUN addgroup -g 1001 -S nodejs && adduser -S trustagent -u 1001

COPY --from=build --chown=trustagent:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=trustagent:nodejs /app/apps ./apps
COPY --from=build --chown=trustagent:nodejs /app/packages ./packages
COPY --from=build --chown=trustagent:nodejs /app/package.json ./package.json
COPY --from=build --chown=trustagent:nodejs /app/pnpm-workspace.yaml ./pnpm-workspace.yaml

USER trustagent
EXPOSE 3080
ENV PORT=3080

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3080/api/health || exit 1

CMD ["pnpm", "--filter", "@trustagent/web", "start"]
