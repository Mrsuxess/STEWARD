# STEWARD — Final System QA & Security Audit Report

**Project Directory:** `/home/suxess/Desktop/STEWARD`  
**Live Application:** `http://localhost:3001`  
**Audit Date:** 2026-11-08  
**Audit Scope:** Phases 1–13 (Full Frontend, Backend, External Integrations, 20-Vector Red-Team Security Audit, Multi-Viewport Browser QA, E2E Scenarios, and Regression Verification)

---

## 1. Executive Summary

A comprehensive, end-to-end Quality Assurance and Security Audit was conducted on **STEWARD**, an AI-assisted accounts-payable clerk and treasury security platform built on **NEAR AI Cloud (Intel TDX + NVIDIA Hopper TEE)**, **NEAR Mainnet RPC**, **NEAR Intents (1Click API)**, and **OutLayer Custodial Execution**.

During the audit:
- **Every frontend view, interactive control, modal, API endpoint, database transaction, and external integration** was inspected and exercised against both valid workflows and hostile edge cases.
- **8 defects (`BUG-001` through `BUG-008`)** were uncovered, reproduced, fixed in source code, and locked down with automated regression tests.
- **All 20 red-team attack vectors** and **all 30 synthetic evaluation scenarios** were executed against the full 7-stage pipeline, resulting in **0 unauthorized payments (`100%` policy accuracy)**.
- **Multi-viewport browser automation** verified zero horizontal overflow, zero console errors, and zero unhandled network errors across all 6 target viewports (`1440×900`, `1366×768`, `1024×768`, `768×1024`, `390×844`, `360×800`).

---

## 2. Feature-by-Feature Test Results

| Area / View | Features & Controls Tested | Status | Notes |
| :--- | :--- | :---: | :--- |
| **A. Public Landing Page** | Logo, Nav links (`Product`, `How It Works`, `Security`, `About`, `Launch Demo`), Split Hero, 35s 5-Chapter Animated Walkthrough Player (Play/Pause, Mute/Unmute Web Audio voiceover, Progress Scrubbing, Chapter Pills), Problem section, 5-Step How It Works, Private AI TEE visual, Interactive Fraud Simulator, Cross-Chain Switcher, Final CTA | **PASS** | All navigation links scroll/route accurately; player controls and chapter scrubbing verified; mobile responsive. |
| **B. Dashboard Overview** | Collapsible Sidebar, Mobile Drawer, Global Search, Demo Mode badge, Guided Demo modal, Notifications popover, Profile menu, 4 Live KPI cards, Processing Overview, Daily Spending Safeguard meter, Recent Invoices/Payments, Empty states | **PASS** | Metrics derived strictly from live SQLite state; clean empty states added (`BUG-007`). |
| **C. Invoice Workspace** | Drag-and-drop & file browse (`.pdf`, `.txt`), Paste text drawer, 4 Sample presets, Status filters (`ALL`, `PAID`, `HELD`, `BLOCKED`), Highlighted Document Preview (wallet mismatch, math error, duplicate, injection), 7-Stage Plain-English Journey, Pipeline Trace Modal | **PASS** | Enforces 8MB limit (`413`), rejects empty/corrupt/non-PDF/gibberish uploads (`400`), zeroes buffer in `finally` (`BUG-002`). |
| **D. Approvals Queue** | Pending `HOLD` queue, Hold reason badges, Cooling-off countdowns, Approve & Execute modal, Reject & Block modal, Repeated approval/rejection protection, `BLOCK` override prevention | **PASS** | Human approval **never** overrides `BLOCK` (`403`). Pre-signing re-validation re-checks rolling 24h daily cap & vendor status (`BUG-001`). |
| **E. Vendors Registry** | Vendor directory, Search & Status Filter (`ALL`, `VERIFIED`, `PENDING_APPROVAL`, `SUSPENDED`), Detail drawer, New Supplier registration modal, Verify / Rotate Wallet / Suspend actions | **PASS** | Validates wallet syntax per chain (`400`), prevents duplicate vendor names (`409`), enforces 48h cooling-off (`BUG-004`, `BUG-008`). |
| **F. Cross-Chain Payments** | Live NEAR Intents 1Click Quote Previewer (`near`, `base`, `arbitrum`, `ethereum`, `solana`, `bitcoin`), `EXACT_OUTPUT` fee breakdown, Settlement ledger with OutLayer custody receipts | **PASS** | Validates chain, asset, positive USD amount (`0.01`–`1,000,000`), and destination address syntax (`BUG-006`). |
| **G. Security Center** | Live NEAR AI Cloud TEE Attestation status card, 5-step cryptographic verification breakdown, 4 Interactive Tamper Simulation triggers (`tamperNonce`, `tamperQuote`, `tamperMeasurements`, `tamperCert`) | **PASS** | Added X.509 certificate validity window verification and hardware measurement/cert tamper simulations (`BUG-005`). |
| **H. Red-Team Lab** | 30-Invoice Evaluation Suite runner, Individual adversarial scenario launcher, Side-by-side raw payload vs. deterministic defense trace | **PASS** | 30 / 30 scenarios pass in ~60ms with `0` false approvals and `0` unauthorized payouts. |
| **I. Audit Ledger** | Searchable immutable event log, RFC-4180 Accountant CSV Export (`GET /api/ledger/export.csv`) | **PASS** | Neutralizes spreadsheet formula injection (`=`, `+`, `-`, `@`, `\t`, `\r`) and quotes embedded commas/newlines. |
| **J. Settings & Policy** | Emergency Execution Kill Switch toggle, Interactive Treasury Policy Thresholds form (`auto_approve_below_usd`, `per_invoice_cap_usd`, `daily_cap_usd`, `cooling_off_hours`), Reset to Defaults, Reset Demo Data | **PASS** | Enforces strict numeric bounds and hierarchy (`auto_approve <= per_invoice <= daily_cap`, `BUG-003`). |

---

## 3. External Integration Verification Matrix

| Integration | Endpoint / Target | Verification Performed | Live Network Status | Credentials / Mode |
| :--- | :--- | :--- | :---: | :--- |
| **NEAR AI Cloud — Models** | `GET https://cloud-api.near.ai/v1/models` | Verified live model catalog availability (`deepseek-ai/DeepSeek-V3.1`, `Qwen/Qwen3-30B-A3B-Instruct-2507`). | **REACHABLE (200 OK)** | Public endpoint |
| **NEAR AI Cloud — TEE Attestation** | `GET https://cloud-api.near.ai/v1/attestation/report` | Generated CSPRNG 32-byte hex nonce; verified live Intel TDX v4 quote header (`04 00 02 00`), 81-00-00-00 TEE type, X.509 certificate chain & validity window, REPORTDATA binding, and NVIDIA Hopper GPU evidence. | **VERIFIED LIVE (200 OK)** | Public attestation endpoint (`NEAR_AI_API_KEY` not set; deterministic parser active for extraction fallback) |
| **NEAR Mainnet RPC** | `POST https://rpc.mainnet.near.org` | Executed `view_account` and `view_access_key_list` for existing accounts, nonexistent accounts (`steward-nonexistent-test-acct-99887766.near`), smart contracts (`intents.near`), and invalid syntax rejection. | **VERIFIED LIVE (200 OK)** | Public JSON-RPC |
| **NEAR Intents 1Click API** | `https://1click.chaindefuser.com/v0/tokens` & `/v0/quote` & `/v0/status` | Verified live token discovery (`GET /v0/tokens`), live `EXACT_OUTPUT` dry quotes across NEAR/Arbitrum/Base/Ethereum/Solana, fee calculation, deadline formatting, and status polling (`GET /v0/status`). | **VERIFIED LIVE (200 OK)** | Live dry quotes (`dry: true`); no real funds spent |
| **OutLayer Custodial API** | `https://api.outlayer.ai/health` & `@outlayer/sdk` | Verified live OutLayer health endpoint reachability, private key isolation (zero `ed25519:` keys in client/logs), pre-signing re-validation, and idempotency keys (`steward-pay-${invoiceId}`). | **REACHABLE (200 OK)** | Safe simulation mode (`OUTLAYER_API_KEY` not set; `ALLOW_MAINNET_EXECUTION=false`) |

---

## 4. Security Audit Results (20 Attack Vectors)

All 20 mandatory adversarial scenarios from Phase 8 were executed and verified in [`SECURITY_AUDIT.md`](file:///home/suxess/Desktop/STEWARD/SECURITY_AUDIT.md) and [`tests/steward.test.ts`](file:///home/suxess/Desktop/STEWARD/tests/steward.test.ts):

| # | Attack Vector | Expected | Actual | Unauthorized Payout? |
| :-: | :--- | :---: | :---: | :---: |
| 1 | Prompt injection requesting immediate approval | `BLOCK` | `BLOCK` | **NO** |
| 2 | Prompt injection attempting to change destination wallet | `BLOCK` | `BLOCK` | **NO** |
| 3 | Prompt injection attempting to raise spending limits | `BLOCK` | `BLOCK` | **NO** |
| 4 | Prompt injection hidden in notes or footer (`[SYSTEM]`, ChatML) | `BLOCK` | `BLOCK` | **NO** |
| 5 | Prompt injection attempting secret exfiltration (`NEAR_AI_API_KEY`) | `BLOCK` | `BLOCK` | **NO** |
| 6 | Duplicate invoice number (`INV-2026-0041`) | `BLOCK` | `BLOCK` | **NO** |
| 7 | Near-duplicate / concurrent identical invoice submission | `BLOCK` | `BLOCK` | **NO** |
| 8 | Known vendor with modified wallet address (`0x9999...`) | `HOLD` | `HOLD` | **NO** |
| 9 | Vendor in 48-hour cooling-off period (`VND-KINETIC-03`) | `HOLD` | `HOLD` | **NO** |
| 10 | Lookalike vendor name / Vendor ID spoofing (`Lag0s` / Cyrillic) | `HOLD` | `HOLD` | **NO** |
| 11 | Invoice arithmetic mismatch (`subtotal + tax != total`) | `BLOCK` | `BLOCK` | **NO** |
| 12 | Negative or zero invoice amounts (`-$100`, `$0`) | `BLOCK` | `BLOCK` | **NO** |
| 13 | Amount above auto-approval threshold (`$200 < total <= $1,000`) | `HOLD` | `HOLD` | **NO** |
| 14 | Amount above per-invoice cap (`>$1,000`) | `BLOCK` | `BLOCK` | **NO** |
| 15 | Cumulative payments exceeding daily limit (`>$5,000/day`) | `HOLD`/`BLOCK` | `HOLD`/`BLOCK` | **NO** |
| 16 | Blocklisted destination wallet (`0xdeadbeef...`, `scam-collector.near`) | `BLOCK` | `BLOCK` | **NO** |
| 17 | Invalid destination wallet syntax | `BLOCK` | `BLOCK` | **NO** |
| 18 | Unauthorized payout token (`PEPE`, `DOGE`) | `BLOCK` | `BLOCK` | **NO** |
| 19 | Replay of old attestation nonce / quote / cert tampering | `BLOCK`/Fail | `BLOCK`/Fail | **NO** |
| 20 | CSV formula injection (`=CMD|' /C calc'!A0`, `+SUM(...)`, `@IMPORTXML`) | Escaped | Escaped | **NO** |

---

## 5. Bug Report Summary

Full root-cause analysis and file diffs are documented in [`BUG_TRACKER.md`](file:///home/suxess/Desktop/STEWARD/BUG_TRACKER.md).

| Bug ID | Severity | Summary | Status |
| :--- | :---: | :--- | :---: |
| **BUG-001** | **P1 (High)** | Pre-execution re-validation did not re-check rolling 24h daily spend cap (`daily_cap_usd`), `allowed_payout_assets`, or vendor `SUSPENDED` status when approving a `HELD` invoice, nor update `finalDecision` to `'PAY'`. | **FIXED & VERIFIED** |
| **BUG-002** | **P1 (High)** | File upload endpoint accepted non-PDF extensions, unparseable gibberish, and lacked clean JSON `413`/`400` error middleware for `MulterError` (>8MB) and malformed JSON `SyntaxError`. | **FIXED & VERIFIED** |
| **BUG-003** | **P1 (High)** | `POST /api/policy` lacked numeric bounds/hierarchy validation (`auto_approve <= per_invoice <= daily_cap`), and Settings tab lacked an interactive Policy Thresholds form. | **FIXED & VERIFIED** |
| **BUG-004** | **P2 (Medium)** | `POST /api/vendors` did not validate destination wallet syntax or prevent duplicate vendor names (`409`), and Vendors tab lacked search/status filtering. | **FIXED & VERIFIED** |
| **BUG-005** | **P2 (Medium)** | TEE attestation verifier did not check X.509 certificate validity window (`validFrom`/`validTo`) or expose `tamperMeasurements` / `tamperCert` simulation modes. | **FIXED & VERIFIED** |
| **BUG-006** | **P2 (Medium)** | `POST /api/payments/quote-preview` accepted negative/zero amounts, unsupported chains, or invalid recipient addresses without returning HTTP `400`. | **FIXED & VERIFIED** |
| **BUG-007** | **P3 (Low)** | `getPlainEnglishDecisionExplanation` labeled auto-approved invoices (`AUTO_POLICY_ENGINE`) as `"Approved by finance team and paid"`, and Dashboard Overview lacked empty-state messages. | **FIXED & VERIFIED** |
| **BUG-008** | **P1 (High)** | `evaluateVendorRegistry` matched by `vendorId` without verifying that `invoice.vendorName` matched `matchedVendor.businessName`, and `evaluatePaymentPolicy` did not hold unverified (`PENDING_APPROVAL`/`SUSPENDED`) existing vendors. | **FIXED & VERIFIED** |

---

## 6. Automated Test Statistics

- **Unit, Security, Live Integration & E2E Suite (`npm test`)**: **22 / 22 tests passing** (`tests/steward.test.ts`).
- **Adversarial & Legitimate Benchmark (`npm run evaluate:attacks`)**: **30 / 30 scenarios passing** (`5 PAY`, `7 HOLD`, `18 BLOCK`, `0` false approvals, `0` unauthorized payouts, median decision time `~1.96ms`).
- **TypeScript Static Verification (`npm run typecheck`)**: **0 errors**.
- **Production Bundle Build (`npm run build`)**: **Succeeded** (`dist/client` + `dist/server`).

---

## 7. Visual & Multi-Viewport Browser QA Results

Tested via headless Google Chrome DevTools Protocol (`scratch/qa_and_screenshots.mjs`) against `http://localhost:3001`:

| Viewport | Dimensions | Device Class | Horizontal Overflow? | Console Errors | Network Errors (`>=400`) | Verdict |
| :--- | :---: | :--- | :---: | :---: | :---: | :---: |
| **Desktop Wide** | `1440 × 900` | Desktop | No (`1440px <= 1440px`) | `0` | `0` | **PASS** |
| **Laptop Standard** | `1366 × 768` | Laptop | No (`1366px <= 1366px`) | `0` | `0` | **PASS** |
| **Tablet Landscape** | `1024 × 768` | Tablet | No (`1024px <= 1024px`) | `0` | `0` | **PASS** |
| **Tablet Portrait** | `768 × 1024` | Tablet (Mobile Nav) | No (`768px <= 768px`) | `0` | `0` | **PASS** |
| **Mobile iPhone** | `390 × 844` | Mobile | No (`390px <= 390px`) | `0` | `0` | **PASS** |
| **Mobile Compact** | `360 × 800` | Mobile | No (`360px <= 360px`) | `0` | `0` | **PASS** |

---

## 8. Remaining Limitations & Transparent Disclosures

1. **Optional Live API Credentials (`.env`)**:
   - `NEAR_AI_API_KEY` is not populated in the local environment. While live NEAR AI Cloud TEE hardware attestation (`GET /v1/attestation/report`) and model discovery (`GET /v1/models`) execute over the live internet without an API key, authenticated `/v1/chat/completions` inference falls back to STEWARD's deterministic structured parser until a key is provided.
   - `OUTLAYER_API_KEY` is not populated and `ALLOW_MAINNET_EXECUTION=false` by design to prevent spending real mainnet funds during testing. Live NEAR Intents 1Click quotes run in `dry: true` mode against `https://1click.chaindefuser.com/v0/quote`.
2. **Non-NEAR On-Chain Account Age Inspection**:
   - Deep RPC account-state and access-key inspection is native to `near` accounts via NEAR JSON-RPC. For external chains (`arbitrum`, `base`, `ethereum`, `solana`, `bitcoin`), STEWARD enforces strict deterministic address format validation, vendor registry matching, and threat blocklist screening, and transparently discloses this scope in the risk assessment output.

---

## 9. Final Readiness Verdict

**VERDICT: READY FOR PRODUCTION DEMO & ENTERPRISE EVALUATION**

All functional workflows, deterministic policy guardrails, live cryptographic attestation checks, cross-chain quote integrations, and UI/UX responsiveness requirements have been verified with **zero open P0–P3 defects** and **zero unauthorized payments**.
