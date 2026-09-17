#!/usr/bin/env bash
# Decrypt the shared Apple team sops file into GITHUB_ENV. Never echoes a value.
#
#   SOPS_AGE_KEY=<AGE-SECRET-KEY-1...>      .github/scripts/decrypt-apple-ci.sh
#   SOPS_AGE_KEY=<openssh private key>      # handled as an SSH age identity
#   SOPS_AGE_SSH_PRIVATE_KEY=<openssh key>  # same, explicit
#
# This repository is public, so nothing decrypted may reach the log: values go
# straight into GITHUB_ENV (heredoc form, for the multi-line .p8 key).
set -euo pipefail

required=(
  APP_STORE_CONNECT_API_KEY_ID
  APP_STORE_CONNECT_API_ISSUER_ID
  APP_STORE_CONNECT_API_KEY
  IOS_DISTRIBUTION_CERTIFICATE_BASE64
  IOS_DISTRIBUTION_CERTIFICATE_PASSWORD
)

raw="${SOPS_AGE_KEY:-${SOPS_AGE_SSH_PRIVATE_KEY:-}}"
if [[ -z "$raw" ]]; then
  echo "::error::Neither SOPS_AGE_KEY nor SOPS_AGE_SSH_PRIVATE_KEY is set on this repository. One of them holds the age identity for the Apple CI secrets."
  exit 1
fi

if [[ "$raw" == AGE-SECRET-KEY-1* ]]; then
  export SOPS_AGE_KEY="$raw"
else
  # An SSH identity: sops wants it as a file.
  key_file="${RUNNER_TEMP:-/tmp}/age-ssh-identity"
  printf '%s\n' "$raw" > "$key_file"
  chmod 600 "$key_file"
  export SOPS_AGE_SSH_PRIVATE_KEY_FILE="$key_file"
  unset SOPS_AGE_KEY
fi

sops -d --output-type json secrets/ci/apple.yaml \
  | node .github/scripts/sops-json-to-github-env.mjs

missing=()
for name in "${required[@]}"; do
  if ! grep -q "^${name}=" "$GITHUB_ENV" && ! grep -q "^${name}<<" "$GITHUB_ENV"; then
    missing+=("$name")
  fi
done
if (( ${#missing[@]} > 0 )); then
  echo "::error::secrets/ci/apple.yaml is missing keys: ${missing[*]}"
  exit 1
fi
