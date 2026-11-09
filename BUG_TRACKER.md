# STEWARD — Bug Tracker & Defect Resolution Log

**Project:** STEWARD (`/home/suxess/Desktop/STEWARD`)  
**Application URL:** `http://localhost:3001`  
**Audit Date:** November 8, 2026

---

## Severity Classification Key
- **P0 — Critical:** Security vulnerability allowing unauthorized payment, application crash, payment execution bypass, broken approval protection, or broken attestation verification.
- **P1 — High:** Broken core feature, API failure, state inconsistency, policy validation gap, or broken file upload/error handling.
- **P2 — Medium:** Endpoint input validation gap, UI workflow gap, filter/search missing, or layout/certificate check enhancement.
- **P3 — Low:** Minor visual polish, copy accuracy, or empty-state presentation.

---

## Defect Summary Table

| Bug ID | Severity | Component / File | Title | Status | Regression Test Added |
| :--- | :---: | :--- | :--- | :---: | :---: |
| **BUG-001** | **P1 (High / Security)** | `src/pipeline/paymentExecutionService.ts` | Pre-execution re-validation (`independentlyRevalidateBeforeExecution`) did not re-check rolling 24h `daily_cap_usd`, `allowed_payout_assets`, or vendor `SUSPENDED` status when approving held invoices | **FIXED & VERIFIED** | Yes (`tests/steward.test.ts`) |
| **BUG-002** | **P1 (High)** | `src/server/app.ts`, `src/pipeline/nearAiExtraction.ts` | Empty files (`0 bytes`), unsupported binary files, or unparseable invoice text fabricated fallback `"Unknown Vendor" / $100` instead of returning HTTP 400; `MulterError` (>8MB) and malformed JSON `SyntaxError` returned Express HTML stack traces instead of JSON | **FIXED & VERIFIED** | Yes (`tests/steward.test.ts`) |
| **BUG-003** | **P1 (High)** | `src/server/app.ts`, `src/client/App.tsx` | `POST /api/policy` accepted negative numbers, `NaN`, or inverted spending caps (`auto_approve_below_usd > per_invoice_cap_usd`) without validation; Settings UI lacked an interactive form to edit and save policy thresholds | **FIXED & VERIFIED** | Yes (`tests/steward.test.ts`) |
| **BUG-004** | **P2 (Medium)** | `src/server/app.ts`, `src/client/App.tsx` | `POST /api/vendors` and `POST /api/vendors/:id/change-address` did not validate destination wallet address format (`validateDestinationAddressFormat`) or return a clean HTTP 409 on duplicate vendor names; Vendors UI lacked search/filter input | **FIXED & VERIFIED** | Yes (`tests/steward.test.ts`) |
| **BUG-005** | **P2 (Medium)** | `src/pipeline/attestationVerifier.ts`, `src/server/app.ts` | Intel TDX v4 & NVIDIA GPU X.509 certificate verification did not explicitly check `validFrom`/`validTo` certificate validity windows or expose `tamperMeasurements` and `tamperCert` flags on `POST /api/attestation/verify` | **FIXED & VERIFIED** | Yes (`tests/steward.test.ts`) |
| **BUG-006** | **P2 (Medium)** | `src/server/app.ts` | `POST /api/payments/quote-preview` did not validate `amountUsd > 0`, supported `destinationChain`, supported `payoutAsset`, or `recipientAddress` format before generating a quote | **FIXED & VERIFIED** | Yes (`tests/steward.test.ts`) |
| **BUG-007** | **P3 (Low)** | `src/client/components/StewardLogo.tsx`, `src/client/App.tsx` | `getPlainEnglishDecisionExplanation` checked `approvedBy !== 'SYSTEM_POLICY_AUTO'` instead of `'AUTO_POLICY_ENGINE'`, labeling auto-paid invoices as controller-approved; Dashboard Overview lists needed explicit empty states when DB is empty | **FIXED & VERIFIED** | Yes (`tests/steward.test.ts`) |
| **BUG-008** | **P1 (High / Security)** | `src/pipeline/vendorRegistry.ts` | `evaluateVendorRegistry` matched a vendor by `vendorId` (`getVendorByIdOrName`) without verifying that `invoice.vendorName` also matched `matchedVendor.businessName`, allowing a spoofed/lookalike vendor name with a known `vendorId` to be treated as `isVerifiedVendor = true` | **FIXED & VERIFIED** | Yes (`tests/steward.test.ts`) |

---

## Detailed Defect Records

### BUG-001 — Pre-Execution Re-Validation Missing Rolling 24h Daily Cap, Allowed Asset, and Vendor Suspension Checks
- **Severity:** P1 (High / Security Defense-in-Depth)
- **Location:** [`src/pipeline/paymentExecutionService.ts`](file:///home/suxess/Desktop/STEWARD/src/pipeline/paymentExecutionService.ts#L246-L302) (`independentlyRevalidateBeforeExecution`)
- **Reproduction Steps:**
  1. Submit multiple mid-tier invoices (e.g., four $450.00 invoices) while daily spend is $185.00; each is placed in `HELD` because $185 + $450 <= $1,500 at intake time.
  2. Approve each `HELD` invoice sequentially via `POST /api/invoices/:id/approve`.
  3. Because `independentlyRevalidateBeforeExecution` checked `per_invoice_cap_usd` ($500) but did not check `getDailySpendSoFarUsd(invoice.mode, db) + invoice.total > policy.daily_cap_usd` ($1,500), approving the fourth invoice would push 24-hour spend to $1,985.00, exceeding the $1,500 daily cap.
- **Root Cause:** `independentlyRevalidateBeforeExecution` checked 6 invariants (`kill_switch`, `per_invoice_cap_usd`, `isAddressBlocklisted`, `schemaValid`, `arithmeticValid`, `promptInjectionDetected`) but omitted `daily_cap_usd`, `allowed_payout_assets`, and vendor `SUSPENDED` status.
- **Fix Applied:** Added deterministic re-checks in `independentlyRevalidateBeforeExecution` for:
  - Rolling 24-hour spend (`currentDailySpend + invoice.total > policy.daily_cap_usd`)
  - Allowed payout assets (`!policy.allowed_payout_assets.includes(invoice.requestedPayoutAsset.toUpperCase())`)
  - Vendor suspension (`invoice.vendorId` matching a `SUSPENDED` vendor in `vendors`)
  - Valid destination wallet syntax (`validateDestinationAddressFormat`)
- **Verification:** Added regression test in [`tests/steward.test.ts`](file:///home/suxess/Desktop/STEWARD/tests/steward.test.ts) verifying that approving held invoices once cumulative daily spend would exceed `daily_cap_usd` is rejected with HTTP 400 and 0 funds moved.

---

### BUG-002 — Empty/Invalid File Upload & Express Middleware Error Handling
- **Severity:** P1 (High)
- **Location:** [`src/server/app.ts`](file:///home/suxess/Desktop/STEWARD/src/server/app.ts#L197-L234), [`src/pipeline/nearAiExtraction.ts`](file:///home/suxess/Desktop/STEWARD/src/pipeline/nearAiExtraction.ts#L140-L238)
- **Reproduction Steps:**
  1. Upload a 0-byte file, a `.png`/`.exe` file, or a corrupted PDF to `POST /api/invoices/upload-pdf`.
  2. Upload a >8MB file to `POST /api/invoices/upload-pdf` or send malformed JSON `{bad` to `POST /api/invoices/process`.
- **Root Cause:**
  - `upload-pdf` did not enforce `.pdf`/`.txt` extension/MIME checks or verify `%PDF-` header on `.pdf` files, and allowed empty `extractedText` to pass into `processInvoiceThroughStewardPipeline`, where `parseInvoiceTextDeterministically("")` generated fallback defaults (`Unknown Vendor`, `$100`).
  - Express lacked a final JSON error-handling middleware for `MulterError` (`LIMIT_FILE_SIZE`) and `SyntaxError` (malformed JSON).
- **Fix Applied:**
  - Validated file extension/MIME (`.pdf` or `.txt`), rejected empty (`0-byte`) files, verified `%PDF-` magic header on PDF uploads, and rejected unparseable/empty text before pipeline execution while still scrubbing the `Buffer` in `finally`.
  - Added Express error middleware at the end of `createApp()` returning clean JSON `413` for `LIMIT_FILE_SIZE` and `400` for `MulterError` / malformed JSON `SyntaxError` with zero stack trace leakage.
- **Verification:** Verified with automated supertest cases in [`tests/steward.test.ts`](file:///home/suxess/Desktop/STEWARD/tests/steward.test.ts) covering empty file, invalid extension, corrupted PDF, oversized >8MB upload, and malformed JSON.

---

### BUG-003 — Policy Update Schema/Range Validation & Interactive Settings Editor
- **Severity:** P1 (High)
- **Location:** [`src/server/app.ts`](file:///home/suxess/Desktop/STEWARD/src/server/app.ts#L449-L475), [`src/client/App.tsx`](file:///home/suxess/Desktop/STEWARD/src/client/App.tsx#L2677-L2775)
- **Reproduction Steps:**
  1. Send `POST /api/policy` with `{ "per_invoice_cap_usd": -50 }` or `{ "auto_approve_below_usd": 1000, "per_invoice_cap_usd": 500 }`.
  2. Previously, invalid values were merged directly into SQLite `policy_config`.
- **Root Cause:** Missing Zod/range validation on `POST /api/policy`, and read-only policy display on the Settings page.
- **Fix Applied:**
  - Added strict validation in `POST /api/policy` ensuring positive finite numbers, `auto_approve_below_usd <= per_invoice_cap_usd <= daily_cap_usd`, valid `cooling_off_hours` (0–720), non-empty `allowed_payout_assets`, and valid `new_vendor` enum (`HOLD` | `BLOCK` | `ALLOW`).
  - Added an interactive Policy Thresholds configuration form in the Settings tab of [`src/client/App.tsx`](file:///home/suxess/Desktop/STEWARD/src/client/App.tsx) with Reset to Defaults and Save Controls.
- **Verification:** Verified via API tests and browser E2E testing on the Settings page.

---

### BUG-004 — Vendor Creation & Wallet Rotation Address Validation + Vendor Search UI
- **Severity:** P2 (Medium)
- **Location:** [`src/server/app.ts`](file:///home/suxess/Desktop/STEWARD/src/server/app.ts#L276-L322), [`src/client/App.tsx`](file:///home/suxess/Desktop/STEWARD/src/client/App.tsx#L2074-L2273)
- **Reproduction Steps:**
  1. Call `POST /api/vendors` with `preferredDestinationChain: "ethereum"` and `walletAddress: "not-an-eth-address"`.
  2. Call `POST /api/vendors` with an existing `businessName` (`"Lagos Design Studio Ltd"`).
- **Root Cause:** Missing `validateDestinationAddressFormat` check in vendor routes and unhandled SQLite `UNIQUE` constraint error.
- **Fix Applied:**
  - Validated `walletAddress` against `preferredDestinationChain` using `validateDestinationAddressFormat` in both `POST /api/vendors` and `POST /api/vendors/:id/change-address`.
  - Returned clean HTTP `409 Conflict` when registering a duplicate vendor business name, and HTTP `404` when rotating/verifying a non-existent vendor ID.
  - Added a real-time supplier search bar and status filter in the Vendors tab of [`src/client/App.tsx`](file:///home/suxess/Desktop/STEWARD/src/client/App.tsx).
- **Verification:** Verified with unit/API tests in [`tests/steward.test.ts`](file:///home/suxess/Desktop/STEWARD/tests/steward.test.ts) and UI testing.

---

### BUG-005 — X.509 Certificate Validity Window Check & Extended Attestation Tamper Modes
- **Severity:** P2 (Medium)
- **Location:** [`src/pipeline/attestationVerifier.ts`](file:///home/suxess/Desktop/STEWARD/src/pipeline/attestationVerifier.ts)
- **Reproduction Steps:**
  1. Inspect `verifyBinaryIntelTdxQuoteV4` certificate chain checks and `POST /api/attestation/verify` tamper options.
- **Root Cause:** X.509 PCK and NVIDIA leaf certificates were signature-verified, but their `validFrom` / `validTo` dates were not explicitly checked against current time, and `tamperMeasurements` / `tamperCert` options were not exposed for automated tamper testing.
- **Fix Applied:**
  - Added explicit `validFrom <= now <= validTo` validity window verification for the Intel SGX PCK Leaf, Intermediate, Root CA, and NVIDIA GPU certificates.
  - Added support for `tamperMeasurements` and `tamperCert` in `verifyNearAiAttestationReport` and `POST /api/attestation/verify`.
- **Verification:** Verified all tampering vectors (`tamperQuote`, `tamperNonce`, `tamperMeasurements`, `tamperCert`) fail verification and record `ATTESTATION_FAILURE` security events.

---

### BUG-006 — 1Click Quote Preview Endpoint Input Validation
- **Severity:** P2 (Medium)
- **Location:** [`src/server/app.ts`](file:///home/suxess/Desktop/STEWARD/src/server/app.ts#L345-L364)
- **Reproduction Steps:**
  1. Send `POST /api/payments/quote-preview` with `{ "amountUsd": -50, "destinationChain": "invalid", "recipientAddress": "bad!" }`.
- **Root Cause:** Endpoint coerced `Number(amountUsd || 100)` without checking `amountUsd > 0`, chain validity, or recipient wallet syntax.
- **Fix Applied:** Added validation for `destinationChain` (`near`, `arbitrum`, `solana`, `ethereum`, `base`, `bitcoin`), `amountUsd` (`> 0` and `<= 1,000,000`), and `validateDestinationAddressFormat(destinationChain, recipientAddress)`.
- **Verification:** Verified in [`tests/steward.test.ts`](file:///home/suxess/Desktop/STEWARD/tests/steward.test.ts).

---

### BUG-007 — Auto-Approved Decision Headline & Empty Database States
- **Severity:** P3 (Low)
- **Location:** [`src/client/components/StewardLogo.tsx`](file:///home/suxess/Desktop/STEWARD/src/client/components/StewardLogo.tsx#L210-L216), [`src/client/App.tsx`](file:///home/suxess/Desktop/STEWARD/src/client/App.tsx)
- **Reproduction Steps:**
  1. Process a legitimate invoice under $200 (`RT-01-LEGOS-STUDIO`). `orchestrator.ts` sets `approvedBy: 'AUTO_POLICY_ENGINE'`.
  2. `getPlainEnglishDecisionExplanation` checked `inv.approvedBy !== 'SYSTEM_POLICY_AUTO'`, so `isHumanApproved` evaluated to `true`.
- **Fix Applied:** Updated check to `Boolean(inv.approvedBy) && inv.approvedBy !== 'AUTO_POLICY_ENGINE' && inv.approvedBy !== 'SYSTEM_POLICY_AUTO'` and added clean empty states for Recent Invoices, Payment Activity, and Security Activity on the Dashboard Overview.
- **Verification:** Verified in unit tests and browser visual inspection.

---

### BUG-008 — Vendor ID vs. Business Name Cross-Verification & Unverified Vendor Hold Rule
- **Severity:** P1 (High / Security)
- **Location:** [`src/pipeline/vendorRegistry.ts`](file:///home/suxess/Desktop/STEWARD/src/pipeline/vendorRegistry.ts#L39-L50), [`src/pipeline/policyEngine.ts`](file:///home/suxess/Desktop/STEWARD/src/pipeline/policyEngine.ts#L202-L212)
- **Reproduction Steps:**
  1. Submit an invoice containing a valid `vendorId` (`"VND-LAGOS-01"`) and matching wallet (`"lagos-studio.near"`), but a spoofed or injected `vendorName` (`"Lagos'; DROP TABLE invoices; --"` or `"Lagos Design Studi0 Ltd"`), or submit an invoice for a vendor registered in `PENDING_APPROVAL` status.
  2. `getVendorByIdOrName` matched the vendor record via `vendorId` and `evaluatePaymentPolicy` only checked `input.vendorCheck.isNewVendor` rather than `!input.vendorCheck.isVerifiedVendor`.
- **Root Cause:** `evaluateVendorRegistry` did not require `invoice.vendorName` to match `matchedVendor.businessName`, and `evaluatePaymentPolicy` lacked an explicit `HOLD` rule when `!input.vendorCheck.isNewVendor && !input.vendorCheck.isVerifiedVendor`.
- **Fix Applied:** Added `vendorNameMatchesRegistry` check in `evaluateVendorRegistry` (`VENDOR_NAME_MISMATCH_WITH_REGISTRY`) and added Rule H1b (`VENDOR_NOT_VERIFIED_OR_NAME_MISMATCH` -> `HOLD`) in `evaluatePaymentPolicy`.
- **Verification:** Verified via `Red-Team 20-Vector Coverage` test in [`tests/steward.test.ts`](file:///home/suxess/Desktop/STEWARD/tests/steward.test.ts).

