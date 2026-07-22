# Security Remediation — C-01 Manual Steps

This file documents the manual actions that **must** be completed by a developer
with Firebase Console access to fully resolve audit finding C-01.

The automated parts (pre-commit hook, `.gitignore`) are already in place.

---

## ⚠️ Why This Is Critical

The `.env` file containing live Firebase credentials was committed in the initial
`v1.0-beta` baseline commit. The file is now in Git history and accessible to
anyone with repository read access, regardless of whether `.env` is listed in
`.gitignore` today.

---

## Step 1 — Rotate Firebase Credentials (Do This First)

> Complete this step **before** doing anything else. New credentials must be in
> place before you purge old ones from history.

1. Open [Firebase Console](https://console.firebase.google.com/) → **daily-fresh-billing-system**
2. Go to **Project Settings** → **General** → **Your apps** → Web app
3. Click **Regenerate API key** (or delete the current web app and re-add it)
4. Copy the new config values
5. Update your **local `.env.local` file** with the new values (use `.env.local.example` as a template)
6. **Do NOT commit `.env.local`** — it is in `.gitignore`
7. Update your production/CI environment variables with the new values

---

## Step 2 — Purge .env from Git History

> Only do this after Step 1 is complete and new credentials are working.

### Option A: `git filter-repo` (Recommended)

```bash
# Install git-filter-repo (one-time)
pip install git-filter-repo

# From the project root — removes .env from ALL history
git filter-repo --path .env --invert-paths --force

# Force-push ALL branches to overwrite remote history
git push origin --force --all
git push origin --force --tags
```

### Option B: BFG Repo Cleaner (Alternative)

```bash
# Download BFG: https://rtyley.github.io/bfg-repo-cleaner/
java -jar bfg.jar --delete-files .env daily-fresh-app.git
git reflog expire --expire=now --all && git gc --prune=now --aggressive
git push origin --force --all
```

---

## Step 3 — Notify All Collaborators

After force-pushing, every developer who has cloned the repository must:

```bash
git fetch origin
git reset --hard origin/main  # or your primary branch name
```

Their local copies may still contain the old `.env` in `git reflog`. They should
run `git reflog expire --expire=now --all && git gc --prune=now` as well.

---

## Step 4 — Verify

Run `git log --all --full-history -- .env` — it should return **no results**.

---

## Environment Variable Setup (going forward)

| File | Purpose | Committed? |
|---|---|---|
| `.env.local` | Local development secrets | ❌ Never commit |
| `.env.local.example` | Template with dummy values | ✅ Safe to commit |
| CI/CD env vars | Production secrets | N/A — set in pipeline UI |

---

*Automated protection: a Husky pre-commit hook in `.husky/pre-commit` now blocks
any future attempt to commit a `.env` file.*
