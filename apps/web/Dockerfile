FROM node:24.19.0-bookworm-slim AS build
WORKDIR /app/apps/web
RUN corepack enable && corepack install --global pnpm@11.21.0
COPY apps/web/package.json apps/web/pnpm-lock.yaml apps/web/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY apps/web ./
COPY packages/contracts /app/packages/contracts
ENV ASTRO_TELEMETRY_DISABLED=1
RUN pnpm run check && pnpm run build

FROM nginx:1.29-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
