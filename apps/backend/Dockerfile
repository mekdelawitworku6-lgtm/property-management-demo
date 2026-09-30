# ---- Base: Node 20 + OpenSSL (required by the Prisma query engine) ----
FROM node:20-slim AS base
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends openssl ca-certificates >/dev/null \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---- Dev/tooling stage: used via `docker compose run --rm tools ...` (tests, migrations) ----
FROM base AS dev
ENV DATABASE_URL=postgresql://postgres:postgres@postgres:5432/property_management
# Deps are baked in so tooling uses the pinned versions (prisma 6.x, not 7.x).
# The compose `tools` service mounts a volume over /app/node_modules, because its
# bind mount of ./apps/backend onto /app would otherwise shadow these.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
# The compose `tools` service runs as ${HOST_UID:-1000}:${HOST_GID:-1000}, and Docker
# seeds a fresh named volume from this directory as root. Match the ownership so
# `prisma generate` and `npm ci` can write into the mounted node_modules.
RUN chown -R 1000:1000 /app/node_modules

# ---- Build stage: install deps + generate Prisma client + compile TypeScript ----
FROM base AS builder
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---- Runtime stage ----
FROM base AS runtime
# Noto Sans Ethiopic for Amharic PDF exports
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends fonts-noto-core >/dev/null \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package.json ./
RUN mkdir -p uploads && chown -R node:node /app
USER node
EXPOSE 4100
# Apply pending migrations, then start the API.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
