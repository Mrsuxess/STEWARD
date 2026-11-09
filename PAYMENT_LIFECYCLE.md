# STEWARD — Non-Custodial Payment Lifecycle & 1Click Execution Specification

This document details how an invoice moves from intake through deterministic policy verification, **NEAR Intents 1Click** quote commitment, non-custodial wallet signing (**NEAR Wallet** or **MetaMask**), and cross-chain settlement tracking.

---

## 1. The 11 Payment Lifecycle States

Every payment in STEWARD (`PaymentExecutionRecord.status` / `PaymentLifecycleStatus`) progresses through a strict 11-state machine persisted in SQLite (`payments` table):

| State | Meaning | Trigger |
|---|---|---|
| `DRAFT` | Invoice extracted and validated; payment record not yet authorized. | Initial invoice intake. |
| `AWAITING_APPROVAL` | Invoice placed on `HOLD` by deterministic policy (e.g., $200–$500 range, new supplier, or 48h address cooling-off lock). | Policy engine returns `HOLD`. |
| `APPROVED` | Invoice passed all deterministic policy checks (`PAY` or human controller approval) and has a live 1Click preview quote (`dry: true`). | `POST /api/payments/prepare`. |
| `AWAITING_WALLET_SIGNATURE` | Controller committed a live 1Click quote (`dry: false`), generating a single-use `depositAddress` and a wallet-specific `PreparedWalletTransaction`. Waiting for the user to sign in NEAR Wallet or MetaMask. | `POST /api/payments/commit-quote`. |
| `DEPOSIT_SUBMITTED` | User signed and broadcast the deposit transaction in their wallet; `txHash` recorded and submitted to `POST https://1click.chaindefuser.com/v0/deposit/submit`. | `POST /api/payments/:id/submit-deposit`. |
| `DEPOSIT_CONFIRMED` | Source chain confirmed the deposit transaction (`KNOWN_DEPOSIT_TX` on 1Click). | `POST /api/payments/:id/poll-status`. |
| `PROCESSING` | NEAR Intents solvers are executing the cross-chain exact-output swap to the vendor's destination chain and asset. | `GET https://1click.chaindefuser.com/v0/status` returns `PROCESSING`. |
| `COMPLETED` | Vendor received the exact invoice output amount on the destination chain (`SUCCESS` on 1Click). Invoice marked `PAID`. | `GET https://1click.chaindefuser.com/v0/status` returns `SUCCESS` (or Demo Settlement in simulation mode). |
| `REFUNDED` | Swap could not complete within slippage/deadline bounds and 1Click refunded the connected treasury wallet's `refundTo` address. | `GET https://1click.chaindefuser.com/v0/status` returns `REFUNDED`. |
| `FAILED` | Wallet rejected signature, on-chain deposit reverted, or 1Click reported `FAILED` / `INCOMPLETE_DEPOSIT`. | Wallet rejection or solver failure. |
| `EXPIRED` | The 1Click quote deadline passed before a deposit transaction was signed and submitted. | Pre-signing expiration guard or status poller. |

---

## 2. Why Auto-Approved Invoices Still Require Wallet Confirmation

In a **non-custodial browser wallet architecture**, the user's private keys live exclusively inside their NEAR Wallet or MetaMask extension. Therefore:

1. **Policy Auto-Approval (`< $200` to verified supplier)**: STEWARD's deterministic policy engine automatically approves the invoice (`finalDecision = 'PAY'`) without requiring a controller to manually review line items in the Approval Queue.
2. **Cryptographic Signing**: Because STEWARD never holds private keys, broadcasting a real mainnet deposit transaction still requires the user to click **"Sign & Send in Wallet"** in the Payment Authorization Modal unless the organization delegates signing to a dedicated smart-contract treasury vault or OutLayer TEE worker.

---

## 3. Wallet-Specific Deposit Transaction Construction

When a controller clicks **Commit Live 1Click Quote (`dry: false`)** in [`PaymentAuthorizationModal.tsx`](file:///home/suxess/Desktop/STEWARD/src/client/components/PaymentAuthorizationModal.tsx):

### A. NEAR Wallet (`@hot-labs/near-connect`)
- **NEP-141 Token Deposit (e.g., USDC `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`)**:
  1. STEWARD checks `storage_balance_of({ account_id: depositAddress })` on the NEP-141 contract.
  2. If the 1Click `depositAddress` is not yet registered for storage on the token contract, STEWARD prepends a `storage_deposit` action (`0.00125 NEAR` / `1250000000000000000000 yoctoNEAR`, `registration_only: true`).
  3. Appends `ft_transfer({ receiver_id: depositAddress, amount: amountInRaw, memo: "STEWARD AP Invoice #..." })` with `30 TGas` and `1 yoctoNEAR` attached deposit.
- **Native NEAR Deposit**:
  - Builds a native `Transfer` action to `depositAddress` for `amountInRaw` yoctoNEAR.

### B. MetaMask (`EIP-1193`)
- **ERC-20 Token Deposit (USDC / USDT on Base, Arbitrum, or Ethereum)**:
  1. Verifies the connected MetaMask `chainId` matches the source chain (`0x2105` Base, `0xa4b1` Arbitrum, `0x1` Ethereum).
  2. Encodes `transfer(address,uint256)` ABI calldata (`0xa9059cbb` + 32-byte padded `depositAddress` + 32-byte hex `amountInRaw`).
  3. Estimates gas via `eth_estimateGas` before invoking `eth_sendTransaction`.
- **Native ETH Deposit**:
  - Sends native value (`valueHex`) directly to `depositAddress` (`data: "0x"`).

---

## 4. Safety & Policy Invariants Enforced Before Every Execution

Before `prepareNonCustodialPayment` or `commitQuoteAndPrepareTransaction` can issue a quote or prepare a transaction, [`independentlyRevalidateBeforeExecution()`](file:///home/suxess/Desktop/STEWARD/src/pipeline/paymentExecutionService.ts) verifies:
1. **Emergency Kill Switch**: Must be `false`.
2. **Invoice Decision**: Must not be `BLOCK`.
3. **Duplicate-Payment Prevention**: Invoice must not already be `PAID` or have an active in-flight payment (`DEPOSIT_SUBMITTED`, `DEPOSIT_CONFIRMED`, `PROCESSING`, `COMPLETED`).
4. **Per-Invoice Spending Cap**: `invoice.total <= policy.per_invoice_cap_usd`.
5. **24-Hour Rolling Spending Cap**: `rolling24hSpendUsd + invoice.total <= policy.daily_cap_usd`.
6. **Sanctions & Blocklist Check**: Destination wallet must not appear on the blocklist.
7. **Quote Expiration Guard**: `submitSignedDepositTransaction` rejects any submission whose `quoteExpiresAt` timestamp has passed and marks the quote `EXPIRED`.
