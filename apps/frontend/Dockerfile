# syntax=docker/dockerfile:1

# ── Stage 1: base ────────────────────────────────────────────────────────────
FROM node:22-alpine AS base
WORKDIR /app

# ── Stage 2: deps ─────────────────────────────────────────────────────────────
FROM base AS deps
RUN npm install -g pnpm

# Copy workspace manifests needed for dependency resolution
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/frontend/package.json ./apps/frontend/package.json
COPY packages/types/package.json ./packages/types/package.json

RUN pnpm install --frozen-lockfile

# ── Stage 3: builder ──────────────────────────────────────────────────────────
FROM base AS builder
RUN npm install -g pnpm

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/frontend/node_modules ./apps/frontend/node_modules

COPY . .

RUN pnpm --filter frontend build

# ── Stage 4: runner ───────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# standalone output bundles everything needed — just copy it
COPY --from=builder /app/apps/frontend/.next/standalone ./
COPY --from=builder /app/apps/frontend/.next/static ./.next/static

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "apps/frontend/server.js"]
