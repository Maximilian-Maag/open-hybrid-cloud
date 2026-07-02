# syntax=docker/dockerfile:1

# ── Stage 1: base ────────────────────────────────────────────────────────────
FROM node:22-alpine AS base
WORKDIR /app

# ── Stage 2: deps ─────────────────────────────────────────────────────────────
FROM base AS deps
RUN npm install -g pnpm

# Copy workspace manifests needed for dependency resolution
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/backend/package.json ./apps/backend/package.json
COPY packages/types/package.json ./packages/types/package.json

RUN pnpm install --frozen-lockfile

# ── Stage 3: builder ──────────────────────────────────────────────────────────
FROM base AS builder
RUN npm install -g pnpm

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/backend/node_modules ./apps/backend/node_modules

COPY . .

RUN pnpm --filter backend build

# ── Stage 4: runner ───────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# standalone output bundles everything needed — just copy it
COPY --from=builder /app/apps/backend/.next/standalone/. .
COPY --from=builder /app/apps/backend/.next/static ./.next/static
# Migration files are needed at runtime for the programmatic migrator
COPY --from=builder /app/apps/backend/drizzle ./drizzle

EXPOSE 3001

ENV PORT=3001
ENV HOSTNAME=0.0.0.0

CMD ["ls", "-laR", "/app"]
