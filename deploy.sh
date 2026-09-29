#!/usr/bin/env bash
# Deploy GreenProof to Google Cloud Run: one container serving the API and the web app.
#
#   ./deploy.sh
#
# The Cloudinary URL is read from server/.env (or $CLOUDINARY_URL) and stored in Secret Manager.
# Set EDITOR_KEY=<key> on the first deploy. Later deploys reuse the saved Secret Manager key.
# Override the target with GCP_PROJECT and GCP_REGION.
set -euo pipefail
cd "$(dirname "$0")"

PROJECT="${GCP_PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${GCP_REGION:-asia-south1}"
SERVICE=greenproof
REPO=greenproof
IMAGE="$REGION-docker.pkg.dev/$PROJECT/$REPO/app:$(date +%Y%m%d-%H%M%S)"
URL_SECRET=greenproof-cloudinary-url
KEY_SECRET=greenproof-editor-key

if [[ -z "$PROJECT" ]]; then
  echo "Set GCP_PROJECT or run: gcloud config set project <id>" >&2
  exit 1
fi
if [[ -z "${EDITOR_KEY:-}" ]] && ! gcloud secrets describe "$KEY_SECRET" --project "$PROJECT" >/dev/null 2>&1; then
  echo "Set EDITOR_KEY to a strong team key for the first deploy. Public report links remain open." >&2
  exit 1
fi
echo "Deploying $SERVICE to project $PROJECT ($REGION)"

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com --project "$PROJECT"
gcloud artifacts repositories describe "$REPO" --project "$PROJECT" --location "$REGION" >/dev/null 2>&1 \
  || gcloud artifacts repositories create "$REPO" --project "$PROJECT" --location "$REGION" --repository-format docker

# Cloud Build and the Cloud Run service both run as the default compute service account.
SERVICE_ACCOUNT="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')-compute@developer.gserviceaccount.com"
gcloud artifacts repositories add-iam-policy-binding "$REPO" --project "$PROJECT" --location "$REGION" \
  --member "serviceAccount:$SERVICE_ACCOUNT" --role roles/artifactregistry.writer >/dev/null

secret_exists() { gcloud secrets describe "$1" --project "$PROJECT" >/dev/null 2>&1; }
secret_set() {  # name value: create the secret or add a new version
  if secret_exists "$1"; then
    printf '%s' "$2" | gcloud secrets versions add "$1" --project "$PROJECT" --data-file=- >/dev/null
  else
    printf '%s' "$2" | gcloud secrets create "$1" --project "$PROJECT" --data-file=- >/dev/null
  fi
}

# Cloudinary account
CLOUDINARY_URL="${CLOUDINARY_URL:-$(grep -E '^CLOUDINARY_URL=' server/.env 2>/dev/null | cut -d= -f2- || true)}"
if [[ -n "$CLOUDINARY_URL" ]]; then
  secret_set "$URL_SECRET" "$CLOUDINARY_URL"
elif ! secret_exists "$URL_SECRET"; then
  echo "Put CLOUDINARY_URL in server/.env (or export it) for the first deploy." >&2
  exit 1
fi

# Team key: only the team can open and change projects; public report links stay open.
SECRETS="CLOUDINARY_URL=$URL_SECRET:latest"
USED_SECRETS=("$URL_SECRET")
if [[ -n "${EDITOR_KEY:-}" ]]; then
  secret_set "$KEY_SECRET" "$EDITOR_KEY"
fi
if secret_exists "$KEY_SECRET"; then
  SECRETS="$SECRETS,EDITOR_KEY=$KEY_SECRET:latest"
  USED_SECRETS+=("$KEY_SECRET")
else
  echo "Editor key secret is unavailable; deployment stopped." >&2
  exit 1
fi

# Let the service read its secrets.
for secret in "${USED_SECRETS[@]}"; do
  gcloud secrets add-iam-policy-binding "$secret" --project "$PROJECT" \
    --member "serviceAccount:$SERVICE_ACCOUNT" --role roles/secretmanager.secretAccessor >/dev/null
done

# Build with Cloud Build (uses the Dockerfile; .gcloudignore keeps server/.env out of the upload).
gcloud builds submit --project "$PROJECT" --tag "$IMAGE" .

# One instance: project records are cached in memory and written back to Cloudinary.
# No CPU throttling: AI analysis and record saving run in the background after each request.
gcloud run deploy "$SERVICE" \
  --project "$PROJECT" --region "$REGION" \
  --image "$IMAGE" \
  --allow-unauthenticated \
  --min-instances 1 --max-instances 1 \
  --no-cpu-throttling --cpu 1 --memory 1Gi \
  --set-secrets "$SECRETS"

echo
echo "GreenProof is live at: $(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format 'value(status.url)')"
