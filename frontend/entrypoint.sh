#!/bin/sh
set -e

if [ -n "$BACKEND_URL" ]; then
    export PROXY_URL="$BACKEND_URL"
else
    export PROXY_URL="http://${BACKEND_HOST:-backend:8000}"
fi

echo "Proxying backend requests to: $PROXY_URL"

envsubst '$PROXY_URL' \
    < /etc/nginx/conf.d/default.conf.template \
    > /etc/nginx/conf.d/default.conf

exec nginx -g 'daemon off;'
