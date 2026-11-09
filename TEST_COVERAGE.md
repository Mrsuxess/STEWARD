# STEWARD — Test Coverage & Verification Matrix

**Project:** STEWARD (`/home/suxess/Desktop/STEWARD`)  
**Audit Date:** November 8, 2026

---

## 1. Automated Test Suite Summary

| Test Suite Category | File | Baseline Tests | Final Tests | Passing | Failing | Status |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **Unit Tests** (Schema, Math, Vendor Registry, Policy, Risk, CSV, Idempotency) | `tests/steward.test.ts` | 6 | 6 | 6 | 0 | **100% PASS** |
| **Security & Red-Team Tests** (Prompt Injection, Approval Override, Kill Switch, 20 Attack Vectors) | `tests/steward.test.ts` | 3 | 4 | 4 | 0 | **100% PASS** |
| **Live External Integration Tests** (NEAR AI Cloud TEE Attestation, NEAR RPC, 1Click API, OutLayer Health) | `tests/steward.test.ts` | 3 | 6 | 6 | 0 | **100% PASS** |
| **End-to-End API, File Upload & Bug Regression Tests** (`BUG-001` to `BUG-008`, 9 E2E Scenarios) | `tests/steward.test.ts` | 2 | 8 | 8 | 0 | **100% PASS** |
| **30-Invoice Synthetic Attack Evaluation Benchmark** | `src/evaluation/redTeamAndSuite.ts` | 30 | 30 | 30 | 0 | **100% PASS (0 Unauthorized Payments)** |
| **Browser Multi-Viewport & E2E UI Verification** (`1440×900` to `360×800`) | Headless Chrome E2E | — | 6 Viewports / 10 Views | All | 0 | **100% PASS** |

---

## 2. Backend Module & Pipeline Coverage

| Module | File | Covered Functions & Branches | Verification Level |
| :--- | :--- | :--- | :--- |
| **Schema & Math Validator** | [`src/pipeline/schemaValidator.ts`](file:///home/suxess/Desktop/STEWARD/src/pipeline/schemaValidator.ts) | `validateExtractedInvoice`, `scanForPromptInjection` (8 regex rules, line-item math, subtotal+tax=total, negative/zero rejection) | Unit + API + 30-case suite |
| **TEE Hardware Attestation** | [`src/pipeline/attestationVerifier.ts`](file:///home/suxess/Desktop/STEWARD/src/pipeline/attestationVerifier.ts) | `generateFresh32ByteNonce`, `verifyBinaryIntelTdxQuoteV4`, `verifyAttestationReportPayload`, `fetchAndVerifyNearAiAttestation` (live quote, byte-flip tamper, nonce replay, measurement tamper, cert chain tamper, malformed payload, X.509 validity window) | Live Integration + Tamper Suite |
| **Confidential Extraction** | [`src/pipeline/nearAiExtraction.ts`](file:///home/suxess/Desktop/STEWARD/src/pipeline/nearAiExtraction.ts) | `extractInvoiceConfidentially`, `parseInvoiceTextDeterministically`, `listAvailableNearAiModels`, RAM buffer wipe (`fileBuffer.fill(0)`) | Unit + API + Upload tests |
| **Vendor Registry & 48h Lock** | [`src/pipeline/vendorRegistry.ts`](file:///home/suxess/Desktop/STEWARD/src/pipeline/vendorRegistry.ts) | `evaluateVendorRegistry` (including `vendorNameMatchesRegistry`), `createNewVendorInRegistry`, `requestVendorAddressChange`, `approveVendorRecord` | Unit + API + E2E |
| **Counterparty Risk & NEAR RPC** | [`src/pipeline/counterpartyRiskEngine.ts`](file:///home/suxess/Desktop/STEWARD/src/pipeline/counterpartyRiskEngine.ts) | `validateDestinationAddressFormat` (`near`, `arbitrum`, `solana`, `ethereum`, `base`, `bitcoin`), `inspectNearAccountViaRpc` (existing, nonexistent, smart contract, access keys), `assessCounterpartyRisk` (`ALLOW`, `WARN`, `BLOCK`) | Unit + Live NEAR Mainnet RPC |
| **Deterministic Policy Engine** | [`src/pipeline/policyEngine.ts`](file:///home/suxess/Desktop/STEWARD/src/pipeline/policyEngine.ts) | `checkDuplicateInvoice`, `getDailySpendSoFarUsd`, `evaluatePaymentPolicy` (`kill_switch`, `per_invoice_cap_usd`, `daily_cap_usd`, `auto_approve_below_usd`, `allowed_payout_assets`, `cooling_off_hours`, `new_vendor`) | Unit + API + 30-case suite |
| **Human Approval Queue** | [`src/pipeline/approvalService.ts`](file:///home/suxess/Desktop/STEWARD/src/pipeline/approvalService.ts) | `approveHeldInvoice` (with mandatory `BLOCK` override rejection & pre-execution re-validation), `rejectHeldInvoice` | Unit + API + E2E |
| **Payment Execution & 1Click** | [`src/pipeline/paymentExecutionService.ts`](file:///home/suxess/Desktop/STEWARD/src/pipeline/paymentExecutionService.ts) | `fetchOneClickSupportedTokens`, `requestOneClickExactOutputQuote`, `pollOneClickExecutionStatus`, `independentlyRevalidateBeforeExecution`, `executeAuthorizedPayment` (idempotency + OutLayer custody) | Unit + Live 1Click API |
| **Audit Ledger & Safe CSV** | [`src/pipeline/ledgerAndCsv.ts`](file:///home/suxess/Desktop/STEWARD/src/pipeline/ledgerAndCsv.ts) | `sanitizeCsvCell` (`=`, `+`, `-`, `@` neutralization), `generateAccountantCsv` (19 accountant columns) | Unit + API + E2E |
| **SQLite Persistence** | [`src/server/db.ts`](file:///home/suxess/Desktop/STEWARD/src/server/db.ts) | All 6 tables (`policy_config`, `vendors`, `vendor_address_history`, `blocklist`, `invoices`, `payments`, `security_events`), restart persistence | Integration + Restart test |
