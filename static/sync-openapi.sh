#!/bin/bash
#
# Fetch all OpenAPI v3 specs (Core + Apps) from a Nokia EDA instance.
# Based on eda-labs/openapi's fetch.sh, hardened with:
#   - full discovery dump for inspection
#   - per-entry HTTP status checking (no more silent partial fetches)
#   - a JSON-sanity check on each downloaded spec
#   - a final accounting summary (total / ok / failed)
#
# Usage:
#   RELEASE=26.4.3 ./static/sync-openapi.sh
#   RELEASE=26.4.3 npm run sync:openapi
#
# Override any of EDA_API_URL / KC_PASSWORD / EDA_PASSWORD via env vars
# if you don't want the admin/admin defaults below committed anywhere.

set -uo pipefail   # deliberately NOT -e: one failed entry shouldn't kill the whole run

export EDA_API_URL="${EDA_API_URL:-"https://100.124.224.215:9443"}"
export RELEASE="${RELEASE:-"unlabeled"}"
export KC_KEYCLOAK_URL="${EDA_API_URL}/core/httpproxy/v1/keycloak"
export KC_REALM="master"
export KC_CLIENT_ID="admin-cli"
export KC_USERNAME="admin"
export KC_PASSWORD="${KC_PASSWORD:-"admin"}"
export EDA_PASSWORD="${EDA_PASSWORD:-"admin"}"
export EDA_REALM="eda"
export API_CLIENT_ID="eda"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_ROOT="${SCRIPT_DIR}/openapi/${RELEASE}"
mkdir -p "${OUT_ROOT}"

echo "==> Target EDA instance: ${EDA_API_URL}"
echo "==> Output dir:          ${OUT_ROOT}"
echo

# ---------------------------------------------------------------------------
# 1. Keycloak admin token
# ---------------------------------------------------------------------------
echo "==> Getting Keycloak admin token..."
KC_ADMIN_ACCESS_TOKEN=$(curl -sk \
  -X POST "${KC_KEYCLOAK_URL}/realms/${KC_REALM}/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password" \
  -d "client_id=${KC_CLIENT_ID}" \
  -d "username=${KC_USERNAME}" \
  -d "password=${KC_PASSWORD}" \
  | jq -r '.access_token // empty')

if [ -z "${KC_ADMIN_ACCESS_TOKEN}" ]; then
  echo "FATAL: failed to obtain Keycloak admin token. Check EDA_API_URL/KC_PASSWORD and that ${EDA_API_URL} is reachable."
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. Look up the 'eda' client + its secret
# ---------------------------------------------------------------------------
echo "==> Fetching 'eda' client id..."
KC_CLIENTS=$(curl -sk \
  -X GET "${KC_KEYCLOAK_URL}/admin/realms/${EDA_REALM}/clients" \
  -H "Authorization: Bearer ${KC_ADMIN_ACCESS_TOKEN}" \
  -H "Content-Type: application/json")

EDA_CLIENT_ID=$(echo "${KC_CLIENTS}" | jq -r ".[] | select(.clientId==\"${API_CLIENT_ID}\") | .id")

if [ -z "${EDA_CLIENT_ID}" ]; then
  echo "FATAL: client 'eda' not found in realm '${EDA_REALM}'"
  exit 1
fi

EDA_CLIENT_SECRET=$(curl -sk \
  -X GET "${KC_KEYCLOAK_URL}/admin/realms/${EDA_REALM}/clients/${EDA_CLIENT_ID}/client-secret" \
  -H "Authorization: Bearer ${KC_ADMIN_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  | jq -r '.value // empty')

if [ -z "${EDA_CLIENT_SECRET}" ]; then
  echo "FATAL: failed to fetch 'eda' client secret"
  exit 1
fi

# ---------------------------------------------------------------------------
# 3. EDA access token (as the admin user, password grant)
# ---------------------------------------------------------------------------
echo "==> Getting EDA access token for user 'admin'..."
EDA_ACCESS_TOKEN=$(curl -sk "${EDA_API_URL}/core/httpproxy/v1/keycloak/realms/${EDA_REALM}/protocol/openid-connect/token" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'client_id=eda' \
  --data-urlencode 'grant_type=password' \
  --data-urlencode 'scope=openid' \
  --data-urlencode 'username=admin' \
  --data-urlencode "password=${EDA_PASSWORD}" \
  --data-urlencode "client_secret=${EDA_CLIENT_SECRET}" \
  | jq -r '.access_token // empty')

if [ -z "${EDA_ACCESS_TOKEN}" ]; then
  echo "FATAL: failed to obtain EDA access token. Check EDA_PASSWORD."
  exit 1
fi

echo "==> Auth OK."
echo

# ---------------------------------------------------------------------------
# 4. Discovery: GET /openapi/v3, save raw for inspection
# ---------------------------------------------------------------------------
echo "==> Fetching discovery document (/openapi/v3)..."
curl -sk "${EDA_API_URL}/openapi/v3" \
  -H "Authorization: Bearer ${EDA_ACCESS_TOKEN}" \
  -H 'Content-Type: application/json' \
  | jq . > "${OUT_ROOT}/_discovery-raw.json"

TOTAL_ENTRIES=$(jq '.paths | length' "${OUT_ROOT}/_discovery-raw.json")
echo "==> Discovery document lists ${TOTAL_ENTRIES} entries under .paths"
echo "==> Full raw discovery saved to ${OUT_ROOT}/_discovery-raw.json (grep this if something's still missing)"
echo

# Quick visibility into anything query/EQL/transaction related, so you can see
# immediately whether it's even present in the discovery doc before we try
# fetching it.
echo "==> Entries matching query/eql/transaction/core (sanity check):"
jq -r '.paths | to_entries[] | .key' "${OUT_ROOT}/_discovery-raw.json" \
  | grep -iE "quer|eql|transaction|core" || echo "   (none found matching those keywords)"
echo

# ---------------------------------------------------------------------------
# 5. Fetch every entry, with explicit status-code + JSON sanity checking
# ---------------------------------------------------------------------------
ok_count=0
fail_count=0
declare -a failures=()

while IFS=$'\t' read -r path url; do
  [ -z "${url}" ] && { failures+=("${path}: no serverRelativeURL field in discovery doc"); fail_count=$((fail_count+1)); continue; }

  target_dir="${OUT_ROOT}${path}"
  mkdir -p "${target_dir}"

  filename="$(echo "${path}" | cut -d '/' -f 3 | cut -d '.' -f 1).json"
  if [ "${filename}" == ".json" ]; then
    filename="core.json"
  fi

  tmpfile=$(mktemp)
  http_code=$(curl -sk -o "${tmpfile}" -w "%{http_code}" \
    "${EDA_API_URL}${url}" \
    -H "Authorization: Bearer ${EDA_ACCESS_TOKEN}" \
    -H 'Content-Type: application/json')

  if [ "${http_code}" != "200" ]; then
    failures+=("${path} -> ${url}: HTTP ${http_code}")
    fail_count=$((fail_count+1))
    rm -f "${tmpfile}"
    continue
  fi

  if ! jq . "${tmpfile}" > "${target_dir}/${filename}" 2>/dev/null; then
    failures+=("${path} -> ${url}: HTTP 200 but response is not valid JSON")
    fail_count=$((fail_count+1))
    rm -f "${tmpfile}"
    continue
  fi

  rm -f "${tmpfile}"
  ok_count=$((ok_count+1))
  echo "OK   ${path} -> ${target_dir}/${filename}"
done < <(jq -r '.paths | to_entries[] | .key + "\t" + (.value["x-eda-nokia-com"].serverRelativeURL // "")' "${OUT_ROOT}/_discovery-raw.json")

# ---------------------------------------------------------------------------
# 6. Summary
# ---------------------------------------------------------------------------
echo
echo "================= SUMMARY ================="
echo "Discovery entries: ${TOTAL_ENTRIES}"
echo "Fetched OK:         ${ok_count}"
echo "Failed:             ${fail_count}"
if [ "${fail_count}" -gt 0 ]; then
  echo
  echo "Failures:"
  printf '  - %s\n' "${failures[@]}"
fi
echo "============================================="

if [ "${ok_count}" -ne "${TOTAL_ENTRIES}" ]; then
  echo
  echo "NOTE: fetched count != discovery entry count. Inspect ${OUT_ROOT}/_discovery-raw.json"
  echo "      and the failure list above to see exactly what's missing and why."
fi
