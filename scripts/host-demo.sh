#!/bin/sh
# Bouwt de publieke demo en zet ze klaar om lokaal te draaien, los van de werkmap (eigen data in $HOST_DIR/state).
# De server luistert enkel op 127.0.0.1; een Cloudflare Tunnel maakt ze bereikbaar.
set -e
HOST_DIR="${HOST_DIR:-$HOME/.trustee-demo}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
CLOUDFLARE_ENV=demo npx vite build
npx wrangler d1 migrations apply trustee-demo --local --env demo --persist-to "$HOST_DIR/state"
mkdir -p "$HOST_DIR"
rm -rf "$HOST_DIR/release"
cp -R dist "$HOST_DIR/release"
echo "Klaar. Start: cd $HOST_DIR/release/trustee_demo && $REPO/node_modules/.bin/wrangler dev --config wrangler.json --ip 127.0.0.1 --port 8799 --persist-to $HOST_DIR/state --test-scheduled"
