# AdvocateDadCO.org

Public website for [AdvocateDadCO.org](https://advocatedadco.org) — advocacy with and for blind and low vision families, grounded in lived experience and systems change.

## Live site

- **Production:** https://advocatedadco.org
- **Hosting:** Cloudflare Pages (project `advocatedadco`)
- **Current deploy path:** Direct Upload of this static tree (git-connected deploys optional later)

## What’s in this repo

Static HTML/CSS/JS, assets, Pagefind search index, and resource PDFs as published.

## Terminology

Use **blind and low vision** for the field. Isabelle is described as **blind** (not “blind and low vision”) in personal narrative.

## Local preview

Any static server from the repo root, for example:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Deploy notes

Production deploys currently use Wrangler Pages Direct Upload. Connecting this repo to Cloudflare Pages for automatic deploys is a follow-up — do not change live DNS/Pages wiring without an explicit cutover plan.

## Attribution

© 2026 Rob Harris · AdvocateDadCO · AdvocateDadCO.org  
Content may be shared with attribution unless a specific resource says otherwise.
