#!/usr/bin/env bash
set -euo pipefail

BASE="${1:?usage: smoke.sh <base-url>}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

want_csp="$(awk '
  /^[^[:space:]]/ { block = $0 }
  block == "/*" && tolower($0) ~ /^[[:space:]]+content-security-policy:/ {
    sub(/^[[:space:]]*[^:]+:[[:space:]]*/, ""); print; exit
  }
' "$REPO/public/_headers")"
[ -n "$want_csp" ] || { echo "no Content-Security-Policy found in public/_headers" >&2; exit 1; }

headers=""
for attempt in 1 2 3 4 5; do
  if headers="$(curl -sS --fail-with-body -D - -o /dev/null --max-time 30 "$BASE/")"; then
    break
  fi
  echo "attempt $attempt: $BASE/ not ready yet, retrying"
  sleep $((attempt * 5))
done
[ -n "$headers" ] || { echo "$BASE/ never responded" >&2; exit 1; }

header_value() {
  printf '%s' "$headers" \
    | tr -d '\r' \
    | awk -v want="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" '
        { line = $0; sub(/:.*/, "", line)
          if (tolower(line) == want) { sub(/^[^:]*:[[:space:]]*/, "", $0); print; exit } }'
}

fail=0
check() {
  local name="$1" want="$2" got
  got="$(header_value "$name")"
  if [ "$got" != "$want" ]; then
    echo "FAIL $name" >&2
    echo "  want: $want" >&2
    echo "  got:  ${got:-<absent>}" >&2
    fail=1
  else
    echo "ok   $name"
  fi
}

check "content-security-policy" "$want_csp"
check "referrer-policy" "no-referrer"
check "x-content-type-options" "nosniff"
check "cross-origin-opener-policy" "same-origin"

sw_csp="$(curl -sS --fail-with-body -D - -o /dev/null --max-time 30 "$BASE/sw.js" \
  | tr -d '\r' | awk 'tolower($0) ~ /^content-security-policy:/ { sub(/^[^:]*:[[:space:]]*/, ""); print; exit }')"
case "$sw_csp" in
  *"connect-src 'self'"*) echo "ok   /sw.js connect-src 'self'" ;;
  *) echo "FAIL /sw.js CSP: ${sw_csp:-<absent>}" >&2; fail=1 ;;
esac

for path in /privacy.html /accessibility.html; do
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "$BASE$path")"
  if [ "$code" = "200" ]; then
    echo "ok   $path"
  else
    echo "FAIL $path returned $code" >&2
    fail=1
  fi
done

exit "$fail"
