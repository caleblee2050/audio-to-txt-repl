#!/usr/bin/env bash
set -euo pipefail

# Simple Cloud Run deploy helper for beginners
# Usage:
#   cd web
#   ./deploy_cloud_run.sh
# Optional env vars:
#   SERVICE_NAME=aittx-service REGION=asia-northeast3 ./deploy_cloud_run.sh

SERVICE_NAME=${SERVICE_NAME:-aittx-service}
REGION=${REGION:-asia-northeast3}

echo "[deploy] Service: $SERVICE_NAME, Region: $REGION"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "[deploy] ERROR: gcloud CLI is not installed."
  echo "Install: https://cloud.google.com/sdk/docs/install"
  exit 1
fi

# Build locally to catch errors early (optional)
echo "[deploy] Building frontend (vite)"
npm run build

# Load env vars from .env if present and pass to Cloud Run
ENV_VARS=""
if [ -f ".env" ]; then
  echo "[deploy] Reading .env for runtime variables"
  GOOGLE_API_KEY=$(grep -E '^GOOGLE_API_KEY=' .env | cut -d= -f2- || true)
  TWILIO_ACCOUNT_SID=$(grep -E '^TWILIO_ACCOUNT_SID=' .env | cut -d= -f2- || true)
  TWILIO_AUTH_TOKEN=$(grep -E '^TWILIO_AUTH_TOKEN=' .env | cut -d= -f2- || true)
  TWILIO_PHONE_FROM=$(grep -E '^TWILIO_PHONE_FROM=' .env | cut -d= -f2- || true)
  ENV_VARS="GOOGLE_API_KEY=$GOOGLE_API_KEY,TWILIO_ACCOUNT_SID=$TWILIO_ACCOUNT_SID,TWILIO_AUTH_TOKEN=$TWILIO_AUTH_TOKEN,TWILIO_PHONE_FROM=$TWILIO_PHONE_FROM"
fi

echo "[deploy] Deploying to Cloud Run via source (Dockerfile)"
gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --region "$REGION" \
  --no-invoker-iam-check \
  --ingress all \
  ${ENV_VARS:+--update-env-vars "$ENV_VARS"}

echo "[deploy] Done. Check the service URL printed above."
echo "[deploy] Health: curl -s https://<SERVICE_URL>/api/health"