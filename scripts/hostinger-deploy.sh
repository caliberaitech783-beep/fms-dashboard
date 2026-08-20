#!/usr/bin/env bash

set -euo pipefail

readonly SITE_ROOT="/home/u982351260/domains/fms.cmll.in"
readonly BUILD_ROOT="${SITE_ROOT}/.builds"
readonly CHECKOUT_ROOT="${BUILD_ROOT}/github-production"
readonly DEPLOY_KEY="${BUILD_ROOT}/github-deploy-key"
readonly KNOWN_HOSTS="${BUILD_ROOT}/github-known-hosts"
readonly LOCK_FILE="${BUILD_ROOT}/github-production.lock"
readonly PUBLIC_ROOT="${SITE_ROOT}/public_html"
readonly REPOSITORY="git@github.com:caliberaitech783-beep/fms-dashboard.git"

mkdir -p "${BUILD_ROOT}"

exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "A deployment is already running."
  exit 75
fi

export GIT_SSH_COMMAND="ssh -i ${DEPLOY_KEY} -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${KNOWN_HOSTS}"

if [[ ! -d "${CHECKOUT_ROOT}/.git" ]]; then
  git clone --branch hostinger-deploy --single-branch "${REPOSITORY}" "${CHECKOUT_ROOT}"
else
  git -C "${CHECKOUT_ROOT}" fetch --force origin hostinger-deploy
  git -C "${CHECKOUT_ROOT}" checkout --force -B hostinger-deploy FETCH_HEAD
fi

readonly DEPLOY_SHA="$(git -C "${CHECKOUT_ROOT}" rev-parse HEAD)"

rsync \
  --archive \
  --delete-after \
  --exclude '.git/' \
  --exclude '.well-known/acme-challenge/' \
  "${CHECKOUT_ROOT}/" \
  "${PUBLIC_ROOT}/"

printf '%s\n' "${DEPLOY_SHA}" > "${BUILD_ROOT}/last-deployed-sha"
printf 'Deployed %s\n' "${DEPLOY_SHA}"
