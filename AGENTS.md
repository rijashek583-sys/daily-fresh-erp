# Daily Fresh ERP — Permanent Engineering & Release Rules

## Core Operational Constraints (CRITICAL)
- Do not run any end-to-end tests or verification. Only implement the changes requested.
- Do not execute scripts that create, edit, or delete Firestore data unless explicitly requested.
- Preserve existing billing, invoice, stock, ledger, payment, reporting, division, and backup functionality.
- Never bypass authentication, authorization, or existing business rules.
- Do not deploy untested or destructive changes automatically.
- Do not perform a production deployment without explicit authorization.

---

## 1. Shared Codebase & Central Feature Rollout
1. **Single Source of Truth**: All features, improvements, and bug fixes must be implemented directly in the shared application codebase (`src/`), never as ad-hoc, one-off overrides or per-user hacks.
2. **Universal Central Availability**: After a successful production deployment to Firebase Hosting, every authorized user across all devices (Web, Windows Desktop, Android) must automatically receive the feature without requiring manual individual installations or custom intervention.
3. **Continuous Centralized Feature Registry**:
   - New capabilities must be cataloged in `src/config/features.ts`.
   - Production-ready features are enabled by default (`defaultEnabled: true`) so that deployments seamlessly roll them out to all eligible users.
   - Centralized feature flags should only be used when genuinely necessary (e.g. staged rollout, experimental beta, or emergency kill switch).
4. **Strict Separation of Feature Enablement and Authorization**:
   - Hiding a button, page, or menu item via a feature flag is solely a presentation-layer convenience.
   - **Never rely on feature flags or UI hiding for security.** Server-side Firestore Security Rules (`firestore.rules`) and route guards (`RequireAdmin`, role checks) remain the authoritative security boundary.

---

## 2. Business Division Rules & Integrity
1. **Canonical Divisions**:
   - **Primary Foods**: Kuboos, Roomali, Wheat Kuboos ONLY.
   - **Bakery Foods**: Soft Kuboos, Poratta, Burger Bun, Milk Bread, and all other products.
2. **Subtotal & Invoice Reconciliation**:
   - Invoices, reports, and bills must strictly maintain the separate subtotals for Primary Foods and Bakery Foods.
   - Subtotals must always reconcile: `Primary Subtotal + Bakery Subtotal = Grand Total`.

---

## 3. Application Versioning, Manifests & Updates
1. **Version Manifest**:
   - The authoritative version and build identifier are tracked in `package.json` and published to `/version.json` via `scripts/update-version-manifest.cjs`.
   - The build process automatically generates `version.json` in both `public/` and `dist/`.
2. **Proactive, Safe Update Discovery**:
   - The web app checks `/version.json` on startup, on tab return (`visibilitychange` / `focus`), and periodically (every 20 minutes) using non-aggressive caching headers.
   - Zero Firestore reads are permitted for version checks; static hosting manifests are used exclusively.
3. **Unsaved Work Protection**:
   - Before executing an update or reload, the app must inspect for dirty form state or unsaved input.
   - The app must NEVER reload automatically during active billing or data entry.
   - Users must receive a clear confirmation prompt before reloading if unsaved data is detected.
4. **Notification Etiquette**:
   - Display clear, non-intrusive notifications: *"New update available. Save your work and update now."*
   - Prevent repeated nag notifications for the same version once dismissed by the user.

---

## 4. Database Migrations, Validation & Compatibility
1. **Non-Destructive Schema Evolution**:
   - Add new fields with sensible default fallbacks. Never write destructive scripts that wipe or alter historical billing or transaction data.
   - Keep older sessions and cached client assets compatible with updated backends.
2. **Pre-Release Verification**:
   - Always run the automated unit test suite (`npm test`) and TypeScript compiler (`npx tsc -b`) before releasing any code changes.
   - Document release notes, affected components, and rollback considerations in each release.

Treat these instructions as the permanent default for all future development tasks in this repository.
