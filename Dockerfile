# ─── Stage 1: Build Astro frontend ───────────────────────────────────────────
FROM node:24.19.0-bookworm-slim AS web-build
WORKDIR /app/apps/web
RUN corepack enable && corepack install --global pnpm@11.21.0
COPY apps/web/package.json apps/web/pnpm-lock.yaml ./
# pnpm-workspace.yaml is optional at root; copy only if present
COPY apps/web/pnpm-workspace.yaml* ./
RUN pnpm install --frozen-lockfile
COPY apps/web ./
COPY packages/contracts /app/packages/contracts
ENV ASTRO_TELEMETRY_DISABLED=1
RUN pnpm run build

# ─── Stage 2: Cache Deno dependencies ────────────────────────────────────────
FROM denoland/deno:2.9.5 AS api-cache
ENV DENO_DIR=/deno-cache
WORKDIR /app
COPY packages/contracts ./packages/contracts
COPY apps/api ./apps/api
RUN deno cache --config apps/api/deno.json --lock=apps/api/deno.lock --frozen apps/api/src/server.ts

# ─── Stage 3: Final runtime image ────────────────────────────────────────────
FROM nginx:1.29-bookworm

# Install Deno and supervisord
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    unzip \
    supervisor \
    && rm -rf /var/lib/apt/lists/*

# Install Deno binary
RUN curl -fsSL https://deno.land/x/install/install.sh | DENO_INSTALL=/usr/local sh -s v2.9.5

# Copy Deno cache and source from api-cache stage
ENV DENO_DIR=/deno-cache
COPY --from=api-cache /deno-cache /deno-cache
COPY --from=api-cache /app /app

# Copy built frontend
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html

# nginx config — proxy /api/ to Deno on 127.0.0.1:8787
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
# Override proxy_pass to localhost (same container, not a separate service)
RUN sed -i 's|http://api:8787|http://127.0.0.1:8787|g' /etc/nginx/conf.d/default.conf

# Persistent data directory
RUN mkdir -p /data/audio

# supervisord config
COPY supervisord.conf /etc/supervisor/conf.d/cadence.conf

EXPOSE 80

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/cadence.conf"]
