#!/usr/bin/env bash
# Put App Store Connect credentials in the environment, from whichever source
# this repository has. Never prints a value: the log of a public repository is
# public.
#
#   SOPS_AGE_KEY / SOPS_AGE_SSH_PRIVATE_KEY set  -> decrypt secrets/ci/apple.yaml
#                                                   (also carries the signing cert)
#   APP_STORE_CONNECT_API_KEY (+ _KEY_ID, _API_ISSUER_ID) as repository secrets
#                                                -> materialize the .p8 and let
#                                                   xcodebuild provision
#
# Xcode's automatic signing with -allowProvisioningUpdates can create or fetch
# the distribution certificate and the profiles for both bundle ids from the API
# key alone, so the direct-secret path does not need the p12.
set -euo pipefail

if [[ -n "${SOPS_AGE_KEY:-}" || -n "${SOPS_AGE_SSH_PRIVATE_KEY:-}" ]]; then
  echo "→ Credentials from secrets/ci/apple.yaml (sops)"
  # Only this path needs sops, and brew takes a minute; do not pay for it when
  # the repository carries the key directly.
  command -v sops >/dev/null 2>&1 || brew install sops
  sops --version >/dev/null
  bash .github/scripts/decrypt-apple-ci.sh
  if [[ -n "${IOS_DISTRIBUTION_CERTIFICATE_BASE64:-}" ]]; then
    echo "HAVE_SIGNING_CERT=true" >> "$GITHUB_ENV"
  else
    echo "HAVE_SIGNING_CERT=false" >> "$GITHUB_ENV"
  fi
  exit 0
fi

if [[ -z "${APP_STORE_CONNECT_API_KEY:-}" || -z "${APP_STORE_CONNECT_API_KEY_ID:-}" || -z "${APP_STORE_CONNECT_API_ISSUER_ID:-}" ]]; then
  echo "::error::No App Store Connect credentials. Set SOPS_AGE_KEY, or the three APP_STORE_CONNECT_* repository secrets."
  exit 1
fi

echo "→ Credentials from repository secrets (App Store Connect API key)"
key_path="${RUNNER_TEMP:-/tmp}/asc-key.p8"
umask 077
printf '%s\n' "$APP_STORE_CONNECT_API_KEY" > "$key_path"
chmod 600 "$key_path"

# A mistaken value (wrong secret pasted, or a key id swapped for the key) fails
# deep inside xcodebuild with a confusing message, so check the shape here.
if ! grep -q "BEGIN PRIVATE KEY" "$key_path"; then
  echo "::error::APP_STORE_CONNECT_API_KEY does not look like a .p8 private key (no BEGIN PRIVATE KEY header)."
  exit 1
fi
if [[ ! "$APP_STORE_CONNECT_API_KEY_ID" =~ ^[A-Z0-9]{10}$ ]]; then
  echo "::error::APP_STORE_CONNECT_API_KEY_ID is not a 10-character key id."
  exit 1
fi
if [[ ! "$APP_STORE_CONNECT_API_ISSUER_ID" =~ ^[0-9a-fA-F-]{36}$ ]]; then
  echo "::error::APP_STORE_CONNECT_API_ISSUER_ID is not a UUID."
  exit 1
fi

{
  echo "APP_STORE_CONNECT_API_KEY_PATH=$key_path"
  echo "APP_STORE_CONNECT_API_KEY_ID=$APP_STORE_CONNECT_API_KEY_ID"
  echo "APP_STORE_CONNECT_API_ISSUER_ID=$APP_STORE_CONNECT_API_ISSUER_ID"
  echo "HAVE_SIGNING_CERT=false"
} >> "$GITHUB_ENV"

echo "   .p8 written ($(wc -c < "$key_path" | tr -d ' ') bytes), key id and issuer id loaded"
