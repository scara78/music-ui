FROM denoland/deno:2.9.5

WORKDIR /app
RUN mkdir -p /data/audio && chown -R deno:deno /data
COPY --chown=deno:deno packages/contracts ./packages/contracts
COPY --chown=deno:deno apps/api ./apps/api

USER deno
RUN deno cache --config apps/api/deno.json --lock=apps/api/deno.lock --frozen apps/api/src/server.ts

EXPOSE 8787
CMD ["deno", "run", "--config", "apps/api/deno.json", "--allow-net", "--allow-env", "--allow-read", "--allow-write", "apps/api/src/server.ts"]
