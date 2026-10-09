# Reviewed manual Cloudflare Pages releases

This workflow uses the existing `advocatedadco` Direct Upload project. It does not change DNS or Cloudflare Git integration. There is no push trigger. Review and merge this workflow PR before attempting a manual validation run.

## What is checked

- **GitHub provenance:** the run must use the current `main` commit, with full Git history. Live production must identify a clean `main` ancestor; its entire Cloudflare manifest must match that commit's bytes. Its deployment ID must also match a successful GitHub production receipt. The already-verified first GitHub release is pinned as the initial bootstrap, including its manifest digest. A stray direct upload with a new ID is rejected even if it copies a real Git SHA.
- **Public approval:** `release-policy.json` records the approved public blob SHA for every deployable file. The updater calculates changes from the staged Git index for each PR; it never reads untracked files, uploads, merges, or grants publication approval. New tracked files require an explicit reviewed-additions flag. Operating documents, internal strategy, workflows, family records, and secrets are not eligible public content.
- **Exact change review:** the verify-only run saves and displays added, removed, and changed paths against authenticated live production. A removal must be a removal from the recorded live commit to the target commit; staging must include every approved tracked public file. A changed live deployment or a newer `main` commit stops publication.
- **Files and links:** HTML references, anchors, CSS URLs, literal script fetch/import/audio references, and media paths in JSON are checked. Referenced images, audio, PDFs, scripts, and styles must exist. No external-link crawler is run.
- **Content:** source text, SVG/JSON/CSV, extractable PDF text, and compressed Pagefind fragment text are scanned for confidential/internal markers, own-writing wording issues, private-key/provider-token patterns, and literal credential assignments. Reviewed exact official titles and organization names are exempt; arbitrary quotation marks do not grant an exemption. Private-name detection uses normalized phrase digests, with no plaintext private name or matching phrase in public code. Unapproved file identifiers and missing unapproved targets are hashed in reports. Source excerpts and matching values are never logged.
- **TEST links:** only `test.html` and `test-access.html` may contain TEST links or links to the test routes. Test pages must stay out of search.
- **Search:** required runtime files, language metadata, fragment counts, current indexed routes, and searchable-page coverage are checked. Pagefind 1.5.2 rebuilds approved staged HTML into a separate verification folder; test and noindex pages are excluded. Its core data must exactly match the committed search data. Only committed files are uploaded. Regenerate and commit the index when content changes.
- **Preview before publication:** preview and production each must match the staged manifest. Key pages are tested at desktop and mobile widths for their served bytes, main headings/content, horizontal overflow, internal resource errors, and working keyboard search with Escape/focus return. Contact/newsletter forms are never submitted.
- **Evidence:** the baseline manifest, rollback ID, file-change plan, check results, and preview/production receipts are saved in Actions artifacts. After production verification passes, a permanent GitHub Deployment record stores the exact Cloudflare ID, main commit, manifest digest, and rollback.

## Manual operation

1. Make the site change through a reviewed GitHub PR. Stage the public edits. Run `node .github/deploy/build-search.cjs SITE OUTPUT TOOLS .github/deploy/release-policy.json` to regenerate Pagefind if needed; replace the old generated index and stage its added/deleted files. Run `node .github/deploy/update-public-files.cjs` to calculate fingerprints, then review and stage the policy change. For genuinely new reviewed public files, use `--approve-additions`; this is a human review decision. These helpers automate calculation, not approval. Do not stage confidential files. New HTML pages must first be added to the reviewed public list before building search.
2. Run **Cloudflare Pages — reviewed manual release** on `main` with **verify-only**. Review its file list and findings. Continue only after all checks pass.
3. Copy its review digest. Run again on the same `main` commit with **deploy**, supplying that digest. A changed baseline or commit invalidates the digest.
4. The workflow checks again, deploys an isolated preview, tests it, checks that production/main/staging remain unchanged, then publishes the same files and verifies production.

The first successful manual deploy under this workflow is required before considering deploy-on-merge. Enabling that trigger is a separate reviewed change; this PR does not enable it.

## Current site findings

The proposed checks intentionally block the current public tree:

- Exact outside titles in the ECC catalog, Find Help, and ONH are preserved. The ONH Braille paragraph contains own-writing wording that still requires Rob's approval to reword; its search fragment is also blocked. Other source occurrences of related wording have a separate review inventory. Formal TVI terminology and the clinical term CVI are preserved.
- Search does not index `blind-low-vision-iep-checklist.html`, `ecc-transition-readiness-families.html`, or `essential-evaluations-blind-low-vision.html`.
- A fresh Pagefind verification build also differs from the committed search data.

These findings are not waived. The index repair is prepared separately and changes generated Pagefind files only, indexing 21 public pages including the three guide landing pages, while preserving the existing guide access flow. This workflow change does not rewrite public content or publish. Merge the separate search repair and update public fingerprints before validation.

## Boundaries and recovery

The guard is layered, not a claim that automated scanning can recognize every private document or all secrets. Images, audio, encoded content, and confidential material without recognizable markers require explicit human review before their blob hashes are approved. Document-specific private comparisons remain local after Rob confirms the source files; no private phrase dictionary is committed here. Phrase digests are not encryption and may be guessable; they are used here only for the specifically authorized name check. Future sensitive document matching belongs in a private secret or local comparison.

If a deployment succeeds but verification or GitHub receipt recording fails, production may already have changed. Use the saved rollback ID in Cloudflare, inspect the evidence, and reconcile through a reviewed GitHub change. Do not loosen provenance checks or blindly redeploy. Restoring a pre-GitHub deployment requires explicit reconciliation because it has no matching GitHub provenance.

Pages control files such as `_worker.js`, `_headers`, `_redirects`, and `_routes.json` need a separately reviewed implementation; this static-file workflow stops if they appear.

## Checks for maintainers

```sh
node .github/deploy/release-tests.cjs
python .github/deploy/site-checks-tests.py
node .github/deploy/update-public-files-tests.cjs
```

The production receipt bootstrap is the verified deployment `c134cfd8-13df-48c0-99f4-cef974f6f1f9` from successful run `37987116517`, commit `f71781a07eac3e86a987e134ba2590a7c2613306`.
