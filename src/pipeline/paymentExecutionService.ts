import type { DatabaseSync } from 'node:sqlite';
import { OutlayerClient } from '@outlayer/sdk';
import {
  getDb,
  getPolicyConfig,
  getPaymentByInvoiceId,
  savePaymentExecution,
  isAddressBlocklisted,
} from '../server/db.js';
import type {
  OperatingMode,
  PaymentExecutionRecord,
  PaymentStatus,
  ProcessedInvoiceRecord,
  SupportedChain,
} from '../shared/types.js';

/**
 * Official Defuse / NEAR Intents 1Click Asset Identifiers verified from
 * GET https://1click.chaindefuser.com/v0/tokens
 */
export const ONECLICK_USDC_ASSET_MAP: Record<SupportedChain, { assetId: string; decimals: number }> = {
  near: {
    assetId: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    decimals: 6,
  },
  arbitrum: {
    assetId: 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near',
    decimals: 6,
  },
  solana: {
    assetId: 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near',
    decimals: 6,
  },
  ethereum: {
    assetId: 'nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near',
    decimals: 6,
  },
  base: {
    assetId: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
    decimals: 6,
  },
  bitcoin: {
    assetId: 'nep141:btc.omft.near',
    decimals: 8,
  },
};

export interface OneClickQuoteResponse {
  quote?: {
    depositAddress?: string;
    amountIn: string;
    amountInFormatted: string;
    amountInUsd?: string;
    minAmountIn?: string;
    amountOut: string;
    amountOutFormatted: string;
    amountOutUsd?: string;
    minAmountOut?: string;
    timeEstimate?: number;
    deadline?: string;
    refundFee?: string;
    withdrawFee?: string;
  };
  quoteRequest?: Record<string, unknown>;
  signature?: string;
  timestamp?: string;
  correlationId?: string;
  message?: string;
}

export function usdToSmallestUnit(amountUsd: number, decimals = 6): string {
  const factor = Math.pow(10, decimals);
  return Math.round(amountUsd * factor).toString();
}

export async function requestOneClickExactOutputQuote(params: {
  destinationChain: SupportedChain;
  payoutAsset: string;
  exactOutputUsd: number;
  recipientAddress: string;
  refundAddress: string;
  dry: boolean;
  allowNetwork?: boolean;
}): Promise<{
  liveQuoteFetched: boolean;
  originAssetId: string;
  destinationAssetId: string;
  exactRequestedOutputRaw: string;
  estimatedInputFormatted: string;
  feesUsd: number;
  depositAddress: string | null;
  correlationId: string | null;
  quoteSignature: string | null;
  error?: string;
}> {
  const originAsset = ONECLICK_USDC_ASSET_MAP.near;
  const destAsset = ONECLICK_USDC_ASSET_MAP[params.destinationChain] || ONECLICK_USDC_ASSET_MAP.near;
  const exactRequestedOutputRaw = usdToSmallestUnit(params.exactOutputUsd, destAsset.decimals);

  const baseUrl = (process.env.ONECLICK_API_BASE_URL || 'https://1click.chaindefuser.com').replace(
    /\/$/,
    ''
  );
  const deadline = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  // For dry quotes where recipientAddress is a demo alias (like lagos-studio.near) that 1Click
  // recipient format validator accepts, pass it directly.
  const payload = {
    dry: params.dry,
    swapType: 'EXACT_OUTPUT',
    slippageTolerance: 100, // 1% buffer; unused input is refunded to refundTo
    originAsset: originAsset.assetId,
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: destAsset.assetId,
    amount: exactRequestedOutputRaw,
    refundTo: params.refundAddress,
    refundType: 'ORIGIN_CHAIN',
    recipient: params.recipientAddress,
    recipientType: 'DESTINATION_CHAIN',
    deadline,
  };

  if (params.allowNetwork !== false) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6500);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
      if (process.env.ONECLICK_API_KEY) {
        headers['Authorization'] = `Bearer ${process.env.ONECLICK_API_KEY}`;
      }

      const res = await fetch(`${baseUrl}/v0/quote`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        const data = (await res.json()) as OneClickQuoteResponse;
        if (data.quote) {
          const amountInFloat = Number(data.quote.amountInFormatted || params.exactOutputUsd);
          const feesUsd = Number(Math.max(0, amountInFloat - params.exactOutputUsd).toFixed(4));
          return {
            liveQuoteFetched: true,
            originAssetId: originAsset.assetId,
            destinationAssetId: destAsset.assetId,
            exactRequestedOutputRaw: data.quote.amountOut || exactRequestedOutputRaw,
            estimatedInputFormatted: `${data.quote.amountInFormatted} USDC`,
            feesUsd,
            depositAddress: data.quote.depositAddress || null,
            correlationId: data.correlationId || null,
            quoteSignature: data.signature || null,
          };
        }
      }
    } catch {
      // Fall through to deterministic calculation when offline
    }
  }

  // Deterministic fallback when offline or in pure offline unit test mode
  const bufferMultiplier = params.destinationChain === 'near' ? 1.001 : 1.0025;
  const estInput = Number((params.exactOutputUsd * bufferMultiplier).toFixed(4));
  const feesUsd = Number((estInput - params.exactOutputUsd).toFixed(4));

  return {
    liveQuoteFetched: false,
    originAssetId: originAsset.assetId,
    destinationAssetId: destAsset.assetId,
    exactRequestedOutputRaw,
    estimatedInputFormatted: `${estInput.toFixed(4)} USDC`,
    feesUsd,
    depositAddress: null,
    correlationId: null,
    quoteSignature: null,
  };
}

export async function pollOneClickExecutionStatus(depositAddress: string): Promise<{
  status: PaymentStatus;
  rawOneClickStatus: string;
  txHash: string | null;
  explorerUrl: string | null;
  actualReceivedAmount: string | null;
  statusSource: string;
}> {
  const baseUrl = (process.env.ONECLICK_API_BASE_URL || 'https://1click.chaindefuser.com').replace(
    /\/$/,
    ''
  );
  const res = await fetch(
    `${baseUrl}/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`,
    { headers: { Accept: 'application/json' } }
  );

  if (!res.ok) {
    throw new Error(`1Click status endpoint returned HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    status?: string;
    swapDetails?: {
      amountOutFormatted?: string;
      destinationChainTxHashes?: Array<{ hash: string; explorerUrl?: string }>;
      nearTxHashes?: string[];
    };
  };

  const rawStatus = (data.status || 'PENDING_DEPOSIT').toUpperCase();
  let mappedStatus: PaymentStatus = 'PENDING';
  if (rawStatus === 'SUCCESS') {
    mappedStatus = 'PAID';
  } else if (rawStatus === 'REFUNDED') {
    mappedStatus = 'REFUNDED';
  } else if (rawStatus === 'FAILED' || rawStatus === 'INCOMPLETE_DEPOSIT') {
    mappedStatus = 'FAILED';
  }

  const destTx = data.swapDetails?.destinationChainTxHashes?.[0];
  const txHash = destTx?.hash || data.swapDetails?.nearTxHashes?.[0] || null;
  const explorerUrl =
    destTx?.explorerUrl || (txHash ? `https://nearblocks.io/txns/${txHash}` : null);

  return {
    status: mappedStatus,
    rawOneClickStatus: rawStatus,
    txHash,
    explorerUrl,
    actualReceivedAmount: data.swapDetails?.amountOutFormatted
      ? `${data.swapDetails.amountOutFormatted} USDC`
      : null,
    statusSource: `https://1click.chaindefuser.com/v0/status?depositAddress=${depositAddress}`,
  };
}

/**
 * Independently revalidates a processed invoice right before payment execution.
 * Enforces idempotency, kill-switch, blocklist, arithmetic integrity, and policy limits.
 */
export function independentlyRevalidateBeforeExecution(
  invoice: ProcessedInvoiceRecord,
  db: DatabaseSync = getDb()
): { allowed: boolean; reason?: string } {
  const policy = getPolicyConfig(db);

  if (policy.kill_switch) {
    return {
      allowed: false,
      reason: 'Emergency Kill Switch is ACTIVE. Payment execution aborted.',
    };
  }

  if (invoice.finalDecision === 'BLOCK' || invoice.paymentStatus === 'BLOCKED') {
    return {
      allowed: false,
      reason: 'Invoice carries a mandatory BLOCK decision. Blocked invoices can never be executed.',
    };
  }

  if (invoice.finalDecision === 'HOLD' && !invoice.approvedBy) {
    return {
      allowed: false,
      reason: 'Invoice is in HOLD status and has not been authorized by a human controller.',
    };
  }

  if (!invoice.validation.schemaValid || !invoice.validation.arithmeticValid) {
    return {
      allowed: false,
      reason: 'Invoice failed independent schema or arithmetic revalidation.',
    };
  }

  if (invoice.validation.promptInjectionDetected) {
    return {
      allowed: false,
      reason: 'Invoice contains a detected prompt-injection attempt.',
    };
  }

  if (isAddressBlocklisted(invoice.receivingWalletAddress, db).blocked) {
    return {
      allowed: false,
      reason: `Receiving address "${invoice.receivingWalletAddress}" is on the security blocklist.`,
    };
  }

  if (invoice.total > policy.per_invoice_cap_usd) {
    return {
      allowed: false,
      reason: `Invoice total ($${invoice.total.toFixed(2)}) exceeds hard per-invoice cap ($${policy.per_invoice_cap_usd.toFixed(2)}).`,
    };
  }

  return { allowed: true };
}

export async function executeAuthorizedPayment(
  invoice: ProcessedInvoiceRecord,
  options?: { allowNetwork?: boolean; db?: DatabaseSync }
): Promise<PaymentExecutionRecord> {
  const db = options?.db || getDb();
  const idempotencyKey = `steward-pay:${invoice.id}:${invoice.invoiceNumber}`;

  // 1. Idempotency Check: Never double-pay an already paid or pending invoice
  const existingPayment = getPaymentByInvoiceId(invoice.id, db);
  if (existingPayment && (existingPayment.status === 'PAID' || existingPayment.status === 'PENDING')) {
    return existingPayment;
  }

  // 2. Independent Security Re-Validation Gate
  const revalidation = independentlyRevalidateBeforeExecution(invoice, db);
  const nowIso = new Date().toISOString();
  const refundAddress = process.env.TREASURY_NEAR_ACCOUNT_ID || 'treasury.steward-ap.near';
  const custodyMode = (process.env.TREASURY_CUSTODY_MODE ||
    (invoice.mode === 'simulation' ? 'simulation' : 'outlayer')) as PaymentExecutionRecord['custodyMode'];

  if (!revalidation.allowed) {
    const blockedRecord: PaymentExecutionRecord = {
      id: existingPayment?.id || `PAY-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      invoiceId: invoice.id,
      idempotencyKey,
      mode: invoice.mode,
      custodyMode,
      status: 'BLOCKED',
      quoteId: null,
      correlationId: null,
      depositAddress: null,
      sourceAsset: 'USDC',
      destinationAsset: invoice.requestedPayoutAsset,
      sourceChain: 'near',
      destinationChain: invoice.requestedDestinationChain,
      exactRequestedOutput: `${invoice.total.toFixed(2)} ${invoice.requestedPayoutAsset}`,
      exactRequestedOutputRaw: usdToSmallestUnit(invoice.total, 6),
      estimatedInputAmount: `${invoice.total.toFixed(2)} USDC`,
      actualReceivedAmount: null,
      feesUsd: 0,
      refundAddress,
      recipientAddress: invoice.receivingWalletAddress,
      txHash: null,
      explorerUrl: null,
      quoteSignature: null,
      statusSource: 'STEWARD Independent Policy Gate',
      errorMessage: revalidation.reason || 'Payment rejected by independent revalidation gate.',
      createdAt: existingPayment?.createdAt || nowIso,
      updatedAt: nowIso,
    };
    savePaymentExecution(blockedRecord, db);
    return blockedRecord;
  }

  // 3. Request Exact-Output Quote from NEAR Intents 1Click API
  // In simulation mode, we always set dry=true so we never lock mainnet quotes or spend funds.
  const isLiveMainnetAuthorized =
    invoice.mode === 'live' && process.env.ALLOW_MAINNET_EXECUTION === 'true';

  const quoteResult = await requestOneClickExactOutputQuote({
    destinationChain: invoice.requestedDestinationChain,
    payoutAsset: invoice.requestedPayoutAsset,
    exactOutputUsd: invoice.total,
    recipientAddress: invoice.receivingWalletAddress,
    refundAddress,
    dry: !isLiveMainnetAuthorized,
    allowNetwork: options?.allowNetwork,
  });

  // 4. Simulation Mode Execution (Explicitly labeled SIMULATED, zero fabricated tx hashes)
  if (invoice.mode === 'simulation' || !isLiveMainnetAuthorized) {
    const simulatedPayment: PaymentExecutionRecord = {
      id: existingPayment?.id || `PAY-SIM-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      invoiceId: invoice.id,
      idempotencyKey,
      mode: 'simulation',
      custodyMode: 'simulation',
      status: 'PAID',
      quoteId: quoteResult.correlationId
        ? `1CLICK-DRY-${quoteResult.correlationId.slice(0, 8)}`
        : `SIM-QUOTE-${invoice.invoiceNumber}`,
      correlationId: quoteResult.correlationId,
      depositAddress: quoteResult.depositAddress || 'SIMULATED_SINGLE_USE_DEPOSIT_ADDRESS',
      sourceAsset: 'USDC (NEAR)',
      destinationAsset: `${invoice.requestedPayoutAsset} (${invoice.requestedDestinationChain.toUpperCase()})`,
      sourceChain: 'near',
      destinationChain: invoice.requestedDestinationChain,
      exactRequestedOutput: `${invoice.total.toFixed(2)} ${invoice.requestedPayoutAsset}`,
      exactRequestedOutputRaw: quoteResult.exactRequestedOutputRaw,
      estimatedInputAmount: quoteResult.estimatedInputFormatted,
      actualReceivedAmount: `${invoice.total.toFixed(2)} ${invoice.requestedPayoutAsset} (SIMULATED)`,
      feesUsd: quoteResult.feesUsd,
      refundAddress,
      recipientAddress: invoice.receivingWalletAddress,
      txHash: null, // Rule 1 & Section 16: Never manufacture transaction hashes or explorer links!
      explorerUrl: null,
      quoteSignature: quoteResult.quoteSignature,
      statusSource: quoteResult.liveQuoteFetched
        ? 'SIMULATED EXECUTION (Live 1Click EXACT_OUTPUT Dry Quote Verified)'
        : 'SIMULATED EXECUTION (Offline Deterministic Quote Engine)',
      errorMessage: null,
      createdAt: existingPayment?.createdAt || nowIso,
      updatedAt: nowIso,
    };

    savePaymentExecution(simulatedPayment, db);
    return simulatedPayment;
  }

  // 5. Live Mode Execution via OutLayer TEE Agent Custody (if configured & authorized)
  if (!quoteResult.depositAddress) {
    const failedQuoteRecord: PaymentExecutionRecord = {
      id: existingPayment?.id || `PAY-LIVE-${Date.now()}`,
      invoiceId: invoice.id,
      idempotencyKey,
      mode: 'live',
      custodyMode,
      status: 'FAILED',
      quoteId: quoteResult.correlationId,
      correlationId: quoteResult.correlationId,
      depositAddress: null,
      sourceAsset: 'USDC (NEAR)',
      destinationAsset: `${invoice.requestedPayoutAsset} (${invoice.requestedDestinationChain.toUpperCase()})`,
      sourceChain: 'near',
      destinationChain: invoice.requestedDestinationChain,
      exactRequestedOutput: `${invoice.total.toFixed(2)} ${invoice.requestedPayoutAsset}`,
      exactRequestedOutputRaw: quoteResult.exactRequestedOutputRaw,
      estimatedInputAmount: quoteResult.estimatedInputFormatted,
      actualReceivedAmount: null,
      feesUsd: quoteResult.feesUsd,
      refundAddress,
      recipientAddress: invoice.receivingWalletAddress,
      txHash: null,
      explorerUrl: null,
      quoteSignature: quoteResult.quoteSignature,
      statusSource: 'https://1click.chaindefuser.com/v0/quote',
      errorMessage: '1Click API did not return a locked single-use depositAddress.',
      createdAt: existingPayment?.createdAt || nowIso,
      updatedAt: nowIso,
    };
    savePaymentExecution(failedQuoteRecord, db);
    return failedQuoteRecord;
  }

  if (custodyMode === 'outlayer' && process.env.OUTLAYER_API_KEY) {
    const outlayer = new OutlayerClient({
      apiKey: process.env.OUTLAYER_API_KEY,
      baseUrl: process.env.OUTLAYER_API_BASE_URL || 'https://api.outlayer.ai',
    });

    await outlayer.withdraw({
      chain: 'near',
      to: quoteResult.depositAddress,
      amount: quoteResult.exactRequestedOutputRaw,
      token: ONECLICK_USDC_ASSET_MAP.near.assetId,
      idempotencyKey,
    });
  }

  const pendingLiveRecord: PaymentExecutionRecord = {
    id: existingPayment?.id || `PAY-LIVE-${Date.now()}`,
    invoiceId: invoice.id,
    idempotencyKey,
    mode: 'live',
    custodyMode,
    status: 'PENDING',
    quoteId: quoteResult.correlationId,
    correlationId: quoteResult.correlationId,
    depositAddress: quoteResult.depositAddress,
    sourceAsset: 'USDC (NEAR)',
    destinationAsset: `${invoice.requestedPayoutAsset} (${invoice.requestedDestinationChain.toUpperCase()})`,
    sourceChain: 'near',
    destinationChain: invoice.requestedDestinationChain,
    exactRequestedOutput: `${invoice.total.toFixed(2)} ${invoice.requestedPayoutAsset}`,
    exactRequestedOutputRaw: quoteResult.exactRequestedOutputRaw,
    estimatedInputAmount: quoteResult.estimatedInputFormatted,
    actualReceivedAmount: null,
    feesUsd: quoteResult.feesUsd,
    refundAddress,
    recipientAddress: invoice.receivingWalletAddress,
    txHash: null,
    explorerUrl: null,
    quoteSignature: quoteResult.quoteSignature,
    statusSource: `https://1click.chaindefuser.com/v0/status?depositAddress=${quoteResult.depositAddress}`,
    errorMessage: null,
    createdAt: existingPayment?.createdAt || nowIso,
    updatedAt: nowIso,
  };

  savePaymentExecution(pendingLiveRecord, db);
  return pendingLiveRecord;
}
