#!/bin/sh
set -e

# Force API to internal port regardless of what EasyPanel injects
export API_PORT=8787
export API_HOST=127.0.0.1
export DATABASE_PATH="${DATABASE_PATH:-/data/music.db}"
export AUDIO_STORAGE_PATH="${AUDIO_STORAGE_PATH:-/data/audio}"
export DENO_DIR="${DENO_DIR:-/deno-cache}"

# Start Deno API in background
/usr/local/bin/deno run \
    --config /app/apps/api/deno.json \
    --allow-net \
    --allow-env \
    --allow-read \
    --allow-write \
    /app/apps/api/src/server.ts &

# Wait for Deno API to be ready (max 30s)
echo "Waiting for Deno API to start..."
i=0
until curl -fs http://127.0.0.1:8787/api/health > /dev/null 2>&1; do
    i=$((i+1))
    if [ $i -ge 30 ]; then
        echo "Deno API failed to start in 30s"
        exit 1
    fi
    sleep 1
done
echo "Deno API ready."

# Start nginx in foreground
exec /usr/sbin/nginx -g "daemon off;"
