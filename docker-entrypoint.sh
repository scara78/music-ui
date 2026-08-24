#!/bin/sh
set -e

# Start Deno API in background
/usr/local/bin/deno run \
    --config /app/apps/api/deno.json \
    --allow-net \
    --allow-env \
    --allow-read \
    --allow-write \
    /app/apps/api/src/server.ts &

API_PID=$!

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

# Start nginx in foreground (keeps container alive)
exec /usr/sbin/nginx -g "daemon off;"
