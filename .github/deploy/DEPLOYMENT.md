# Manual Cloudflare Pages release

The website remains on the existing Cloudflare Pages Direct Upload project, `advocatedadco`. All site changes must be committed in GitHub before deployment. This workflow does not change DNS or connect the project to Cloudflare's Git integration.

## First release

Run **Cloudflare Pages — manual release** from Actions on **main**:

1. Select **verify-only** to check the live production manifest without uploading.
2. Select **deploy** after a successful verification. The workflow checks again, creates an isolated preview, verifies its exact manifest and served policy page, rechecks the production baseline, and then deploys and verifies production.

The reviewed source is commit `25ec05e`. The required production baseline is `9edaedf3-4ae2-4877-a3c3-e25d7f6d8dac`. The workflow stops unless the actual difference is exactly:

- `policy-action.html`: meta-description only.
- `fundraising.css`: removed.

Production starts with 189 files; the staged upload and verified deployment must have exactly 188. Every site blob must match the reviewed source. No build or Pagefind regeneration occurs. The two literal-question-mark filenames remain intact because the runner is Linux. The staging directory excludes `.git`, `.github`, `.gitignore`, and `README.md`; dependencies and evidence are stored outside it.

The workflow uses the existing repository secrets `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. Secret values are never written into the repository or evidence.

## Evidence and rollback

Each run saves the source commit, original live manifest, proposed manifest, two-change result, and any preview/production receipts as a GitHub Actions artifact. The verified deployment IDs and rollback ID appear in the run summary. The original production deployment is preserved; this workflow never deletes deployments.

Use the authenticated deployment manifest and deployment-specific `pages.dev` URL to verify served files. A canonical-domain bot challenge is not proof of a failed release. If production verification fails after publication, use the recorded rollback deployment in Cloudflare and review the failure.

## After the first successful release

The first-release lock is intentional. A later release, or a rerun after production has changed, stops for review. Replace this one-time source/baseline/change gate through a reviewed GitHub change before future deployments. Keep the workflow manual-only for now; no push trigger has been enabled.
