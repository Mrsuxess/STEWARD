# STEWARD — Threat Model & Security Architecture (`SECURITY.md`)

STEWARD is built around a single non-negotiable security principle:

> **AI extracts and explains. Code decides. Humans authorize exceptions.**

This document details the threat model, defense-in-depth controls, cryptographic verification mechanisms, and honest security limitations of the system.

---

## 1. Threat Model

Accounts-payable automation faces threats across four distinct surfaces:

### Threat A: Indirect Prompt Injection via Untrusted Invoices
- **Attack Vector**: An attacker submits an invoice (PDF or text) containing visible or hidden instructions (e.g., white-on-white text, fake `[SYSTEM]` blocks, JSON injection, or roleplay commands) instructing the AI to:
  - Replace the vendor's verified wallet address with an attacker's wallet.
  - Mark the invoice as `APPROVED` or `VERIFIED`.
  - Ignore spending limits or duplicate checks.
  - Execute a payment tool or leak environment variables/API keys.
- **STEWARD Mitigations**:
  1. **Zero Tool Access**: The NEAR AI Cloud model call has `tools: undefined`. The model literally cannot invoke payment functions, database writes, or shell commands.
  2. **Untrusted Data Framing**: Invoice text is wrapped inside random boundary delimiters and processed with a strict system prompt that extracts factual fields only.
  3. **Deterministic Prompt-Injection Scanner**: Before and after extraction, deterministic regex and structural heuristics scan the raw input (in ephemeral memory before deletion) and extracted fields for instruction-override patterns (`ignore previous instructions`, `system override`, `pay to wallet`, `approve immediately`, role-spoofing markers, etc.). Any match triggers a mandatory `BLOCK` (`PROMPT_INJECTION_DETECTED`) and logs a critical security event.
  4. **Registry-Authoritative Verification**: Even if an AI model extracts an attacker's wallet address from an invoice, STEWARD never trusts the invoice's wallet address as proof of vendor identity. The extracted address is strictly compared against the SQLite **Verified Vendor Registry**. Any mismatch triggers `HOLD` or `BLOCK`.

### Threat B: Vendor Impersonation & Silent Payment Redirects (BEC Fraud)
- **Attack Vector**: A compromised vendor email or impersonator submits an invoice for an existing vendor with a new receiving wallet address.
- **STEWARD Mitigations**:
  1. **New Vendor Rule**: Unknown vendors (`new_vendor: require_human`) are never paid automatically; they are placed on `HOLD`.
  2. **Silent Address Change Prevention**: If an invoice specifies a receiving wallet address that differs from the vendor's verified registry address, STEWARD immediately intercepts the discrepancy (`ADDRESS_MISMATCH_WITH_REGISTRY`).
  3. **48-Hour Cooling-Off Period**: Updating a verified vendor's wallet address in the registry automatically enforces a mandatory **48-hour cooling-off lock** (`cooling_off_hours: 48`) and requires explicit human confirmation. Any invoice submitted during the cooling-off window is held (`VENDOR_IN_COOLING_OFF_PERIOD`).
  4. **Immutable Audit History**: Every vendor address change is permanently recorded in `vendor_address_history`.

### Threat C: Malicious or High-Risk Counterparty Destinations
- **Attack Vector**: An invoice requests payment to a known scam/sanctioned address, an uninitialized NEAR account, or a recently deployed/unverified smart contract.
- **STEWARD Mitigations**:
  1. **Threat Blocklist**: Deterministic check against known malicious addresses (`BLOCKLISTED_ADDRESS` → immediate `BLOCK`).
  2. **Live NEAR RPC Intelligence**: Queries `view_account` and `view_access_key_list` on NEAR RPC to verify account existence, balance/activity history, and whether the destination is a smart contract (`code_hash` inspection).
  3. **Multi-Chain Address Validation**: Validates destination address syntax for NEAR, Ethereum/Arbitrum/Base (`0x...`), Solana (base58), and Bitcoin.

### Threat D: Financial Limit Bypass, Arithmetic Fraud & Double-Payment
- **Attack Vector**: Submitting an invoice where line items don't sum to the total, submitting the same invoice number twice, or attempting to drain the treasury via rapid invoices.
- **STEWARD Mitigations**:
  1. **Strict Arithmetic Verification**: Deterministic check verifying `sum(lineItems.amount) == subtotal` and `subtotal + tax == total` (within `$0.01` rounding tolerance). Discrepancies trigger immediate `BLOCK` (`ARITHMETIC_MISMATCH`).
  2. **Duplicate Detection**: Invoices matching an existing `(vendor_id, invoice_number)` or invoice fingerprint are immediately `BLOCKED` (`DUPLICATE_INVOICE`).
  3. **Server-Side Spending Caps**:
     - Automatic approval only below `$200.00` (`auto_approve_below_usd: 200`).
     - Invoices between `$200.00` and `$500.00` require human approval (`HOLD`).
     - Invoices exceeding `$500.00` (`per_invoice_cap_usd: 500`) or pushing daily spend above `$1,500.00` (`daily_cap_usd: 1500`) are `BLOCKED`.
  4. **Idempotency Keys**: Payment execution locks on a deterministic `idempotency_key` (`pay:<invoiceId>`) in SQLite so concurrent clicks or network retries cannot double-pay an invoice.
  5. **Emergency Kill Switch**: Turning on `kill_switch: true` immediately blocks all automatic and manual payment executions across the platform.

### Threat E: CSV Formula Injection (Spreadsheet Malware)
- **Attack Vector**: An attacker embeds `=cmd|' /C calc'!A0` or `@SUM(...)` inside a vendor name or invoice memo so that when the bookkeeper opens the exported CSV in Excel or Google Sheets, arbitrary formulas execute.
- **STEWARD Mitigations**:
  - Every text field in the CSV exporter is sanitized according to OWASP CSV Injection guidelines (any cell starting with `=`, `+`, `-`, `@`, `\t`, or `\r` is prefixed with a single quote `'`) and RFC 4180 double-quote escaped.

---

## 2. Confidential Compute & Cryptographic Attestation (`NEAR AI Cloud`)

STEWARD verifies that invoice extraction occurs inside a hardware Trusted Execution Environment (TEE) via `GET https://cloud-api.near.ai/v1/attestation/report`:

1. **Fresh 32-Byte Nonce**: Generated via `crypto.randomBytes(32).toString('hex')` for every invoice analysis.
2. **Intel TDX Quote v4 Verification**:
   - Parses the binary TDX v4 quote (`version=4`, `teeType=0x81`).
   - Verifies the embedded X.509 PCK certificate chain up to the self-signed **Intel SGX Root CA** (`44:A0:19:6B:2B:99:F8:89:B8:E1:49:E9:5B:80:7A:35:0E:74:24:96:43:99:E8:85:A7:CB:B8:CC:FA:B6:74:D3`).
   - Verifies the Quoting Enclave (`QE`) report signature using the PCK leaf certificate's public key and confirms `QE_Report.REPORTDATA[0..32] == SHA256(AttestationPublicKey || AuthData)`.
   - Verifies the ECDSA-P256 signature over the 632-byte TDX Quote Header + TD Report Body using `AttestationPublicKey`.
   - Verifies that the binary `MRTD` and `RTMR0..3` registers inside the signed TD Report Body match the reported `tcb_info`.
   - Verifies that `TD_Report.REPORTDATA` binds both the enclave's `signing_address` (bytes `0..32`) and STEWARD's fresh `nonce` (bytes `32..64`).
3. **NVIDIA Hopper GPU Attestation Verification**:
   - Parses `nvidia_payload`, validates the NVIDIA Hopper (`arch: "HOPPER"`) X.509 certificate chain and validity window, and verifies that the GPU attestation payload echoes the exact fresh `nonce`.

---

## 3. Explicit Security Limitations & Honest Disclosures

1. **Application Memory vs. Garbage Collection in Node.js**:
   - STEWARD never writes raw uploaded PDF files or raw invoice text to disk or SQLite. Buffer contents (`Buffer.fill(0)`) are explicitly zeroed immediately after extraction.
   - *Limitation*: In V8/Node.js, JavaScript `string` primitives are immutable and managed by the V8 garbage collector. While `Buffer` instances are zeroed deterministically in place, temporary JS strings created during JSON parsing or HTTP transport may remain in process heap memory until garbage-collected.
2. **Third-Party Infrastructure Boundaries**:
   - When calling `https://cloud-api.near.ai/v1`, TLS terminates inside the attested NEAR AI Cloud Gateway TEE (`gateway_attestation`) and inference runs inside the Model TEE (`model_attestations`). While hardware attestation proves the enclave measurements (`MRTD`/`RTMR`), we rely on Intel SGX/TDX and NVIDIA Hopper hardware roots of trust and current TCB revocation status.
3. **Non-NEAR Counterparty Intelligence Depth**:
   - For native NEAR destinations, STEWARD queries live NEAR RPC (`view_account`, `view_access_key_list`) to verify account existence, balance, storage, and smart contract code hashes.
   - For non-NEAR destinations (Ethereum, Arbitrum, Solana, Bitcoin) paid via NEAR Intents 1Click cross-chain settlement, STEWARD validates address syntax, vendor registry matching, internal payment history, and threat blocklists, and explicitly notes in the risk report that deep on-chain contract inspection is NEAR-native.
4. **Treasury Custody Trade-offs**:
   - **OutLayer Agent Custody (`https://api.outlayer.ai`)**: Stores private keys inside an Intel TDX enclave with TEE-enforced spending policies. Requires an active OutLayer wallet API key (`OUTLAYER_API_KEY`).
   - **NEAR Function-Call Access Keys**: On NEAR, standard Function-Call access keys cannot attach arbitrary native NEAR tokens (`deposit > 0`) unless calling a specialized treasury/multisig contract (because NEP-141 `ft_transfer` requires a `1 yoctoNEAR` attached deposit for security).
   - **Server-Side Policy-Gated Signer**: Enforces all spending limits, allowlists, kill-switch checks, and human approvals inside STEWARD's backend before signing, and is strictly gated by `ALLOW_MAINNET_EXECUTION=false` by default.
