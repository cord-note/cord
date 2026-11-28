#!/usr/bin/env bash
# Starts the image, makes an account from an invite, pushes and pulls one change.
set -euo pipefail
IMAGE=${1:-cord-server}
docker run -d --name cord-smoke -p 8787:8787 "$IMAGE" >/dev/null
trap 'docker rm -f cord-smoke >/dev/null' EXIT
for _ in $(seq 30); do curl -fs localhost:8787/v1/hello >/dev/null && break; sleep 1; done
curl -fs localhost:8787/v1/hello | grep -q '"protocol":1'

CODE=$(docker exec cord-smoke cord-server invite --data /data)
SIGNED=$(curl -fs localhost:8787/v1/invites/redeem -H 'Content-Type: application/json' \
  -d "{\"code\":\"$CODE\",\"username\":\"smoke\",\"password\":\"smoke-test-pw\",\"deviceName\":\"ci\"}")
TOKEN=$(echo "$SIGNED" | sed -E 's/.*"token":"([^"]+)".*/\1/')
USER_ID=$(echo "$SIGNED" | sed -E 's/.*"userId":"([^"]+)".*/\1/')
AUTH="Authorization: Bearer $TOKEN"

curl -fs localhost:8787/v1/vaults -H "$AUTH" -H 'Content-Type: application/json' -d '{"id":"v1","name":"Smoke"}' >/dev/null
# payload is the format byte 1 then "Hi": base64 of 01 22 48 69 22
curl -fs localhost:8787/v1/vaults/v1/changes -H "$AUTH" -H 'Content-Type: application/json' -d "{\"changes\":[{
  \"id\":\"c1\",\"vaultId\":\"v1\",\"entityType\":\"note\",\"entityId\":\"n1\",\"kind\":\"field_set\",\"field\":\"title\",
  \"hlc\":\"0000000000001-000000-ci\",\"authorDeviceId\":\"ci\",\"authorUserId\":\"$USER_ID\",\"payload\":\"ASJIaSI=\"}]}" \
  | grep -q '"accepted":\["c1"\]'
curl -fs "localhost:8787/v1/vaults/v1/changes?after=0" -H "$AUTH" | grep -q '"seq":1'
echo "smoke test passed"
