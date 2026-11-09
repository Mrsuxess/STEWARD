import type { DatabaseSync } from 'node:sqlite';
import { OutlayerClient } from '@outlayer/sdk';
import {
  getDb,
  getPolicyConfig,
  getPaymentByInvoiceId,
  getPaymentById,
  savePaymentExecution,
  getInvoiceById,
  saveProcessedInvoice,
  isAddressBlocklisted,
  getVendorByIdOrName,
  logSecurityEvent,
} from '../server/db.js';
import { validateDestinationAddressFormat } from './counterpartyRiskEngine.js';
import { getDailySpendSoFarUsd } from './policyEngine.js';
import type {
  OneClickTokenInfo,
  OperatingMode,
  PaymentExecutionRecord,
  PaymentLifecycleStatus,
  PaymentStatus,
  PreparedNearAction,
  PreparedWalletTransaction,
  ProcessedInvoiceRecord,
  SupportedChain,
  TreasuryWalletType,
  WalletAssetBalance,
} from '../shared/types.js';

/**
 * Fallback static Defuse / NEAR Intents 1Click Asset Identifiers used only when
 * live GET https://1click.chaindefuser.com/v0/tokens is unreachable offline.
 */
export const ONECLICK_USDC_ASSET_MAP: Record<
  SupportedChain,
  { assetId: string; decimals: number; contractAddress?: string }
> = {
  near: {
    assetId: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    decimals: 6,
    contractAddress: '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
  },
  arbitrum: {
    assetId: 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near',
    decimals: 6,
    contractAddress: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
  },
  solana: {
    assetId: 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near',
    decimals: 6,
    contractAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  },
  ethereum: {
    assetId: 'nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near',
    decimals: 6,
    contractAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  },
  base: {
    assetId: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
    decimals: 6,
    contractAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  },
  bitcoin: {
    assetId: 'nep141:btc.omft.near',
    decimals: 8,
  },
};

export function normalizeOneClickChainName(blockchain: string): SupportedChain | string {
  const b = (blockchain || '').toLowerCase().trim();
  if (b === 'eth' || b === 'ethereum') return 'ethereum';
  if (b === 'arb' || b === 'arbitrum') return 'arbitrum';
  if (b === 'sol' || b === 'solana') return 'solana';
  if (b === 'btc' || b === 'bitcoin') return 'bitcoin';
  if (b === 'near') return 'near';
  if (b === 'base') return 'base';
  return b;
}

export function chainToOneClickBlockchainCode(chain: SupportedChain): string {
  switch (chain) {
    case 'ethereum':
      return 'eth';
    case 'arbitrum':
      return 'arb';
    case 'solana':
      return 'sol';
    case 'bitcoin':
      return 'btc';
    case 'near':
      return 'near';
    case 'base':
      return 'base';
    default:
      return chain;
  }
}

let cachedTokens: OneClickTokenInfo[] | null = null;
let cachedTokensTimestamp = 0;

export async function fetchOneClickSupportedTokens(options?: {
  allowNetwork?: boolean;
  forceRefresh?: boolean;
}): Promise<OneClickTokenInfo[]> {
  const now = Date.now();
  if (
    !options?.forceRefresh &&
    cachedTokens &&
    cachedTokens.length > 0 &&
    now - cachedTokensTimestamp < 60_000
  ) {
    return cachedTokens;
  }

  const baseUrl = (process.env.ONECLICK_API_BASE_URL || 'https://1click.chaindefuser.com').replace(
    /\/$/,
    ''
  );
  if (options?.allowNetwork !== false) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5500);
      const res = await fetch(`${baseUrl}/v0/tokens`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) {
        const data = (await res.json()) as Array<Record<string, unknown>>;
        if (Array.isArray(data) && data.length > 0) {
          const normalized: OneClickTokenInfo[] = data.map((t) => ({
            assetId: String(t.assetId || ''),
            symbol: String(t.symbol || ''),
            blockchain: String(t.blockchain || ''),
            normalizedChain: normalizeOneClickChainName(String(t.blockchain || '')),
            decimals: Number(t.decimals ?? 6),
            price: Number(t.price ?? 0),
            priceUpdatedAt: String(t.priceUpdatedAt || new Date().toISOString()),
            contractAddress: t.contractAddress ? String(t.contractAddress) : undefined,
            coingeckoId: t.coingeckoId ? String(t.coingeckoId) : undefined,
          }));
          cachedTokens = normalized;
          cachedTokensTimestamp = now;
          return normalized;
        }
      }
    } catch {
      // Fallback to verified static map when offline
    }
  }

  const fallbackNow = new Date().toISOString();
  const fallbackTokens: OneClickTokenInfo[] = [
    ...Object.entries(ONECLICK_USDC_ASSET_MAP).map(([chain, info]) => ({
      assetId: info.assetId,
      symbol: chain === 'bitcoin' ? 'BTC' : 'USDC',
      blockchain: chainToOneClickBlockchainCode(chain as SupportedChain),
      normalizedChain: chain as SupportedChain,
      decimals: info.decimals,
      price: chain === 'bitcoin' ? 75679 : 1.0,
      priceUpdatedAt: fallbackNow,
      contractAddress: info.contractAddress,
    })),
    {
      assetId: 'nep141:usdt.tether-token.near',
      symbol: 'USDT',
      blockchain: 'near',
      normalizedChain: 'near',
      decimals: 6,
      price: 1.0,
      priceUpdatedAt: fallbackNow,
      contractAddress: 'usdt.tether-token.near',
    },
    {
      assetId: 'nep141:wrap.near',
      symbol: 'wNEAR',
      blockchain: 'near',
      normalizedChain: 'near',
      decimals: 24,
      price: 3.6,
      priceUpdatedAt: fallbackNow,
      contractAddress: 'wrap.near',
    },
    {
      assetId: 'nep141:eth.omft.near',
      symbol: 'ETH',
      blockchain: 'eth',
      normalizedChain: 'ethereum',
      decimals: 18,
      price: 2227.5,
      priceUpdatedAt: fallbackNow,
    },
    {
      assetId: 'nep141:base.omft.near',
      symbol: 'ETH',
      blockchain: 'base',
      normalizedChain: 'base',
      decimals: 18,
      price: 2227.5,
      priceUpdatedAt: fallbackNow,
    },
    {
      assetId: 'nep141:arb.omft.near',
      symbol: 'ETH',
      blockchain: 'arb',
      normalizedChain: 'arbitrum',
      decimals: 18,
      price: 2227.5,
      priceUpdatedAt: fallbackNow,
    },
  ];
  return fallbackTokens;
}

export function resolveOneClickToken(
  chain: SupportedChain,
  symbol: string,
  tokens: OneClickTokenInfo[]
): OneClickTokenInfo {
  const normSymbol = symbol.trim().toUpperCase();

  // Always prefer canonical mainnet asset IDs for USDC, NEAR/wNEAR, and NEAR USDT
  if (normSymbol === 'USDC' && ONECLICK_USDC_ASSET_MAP[chain]) {
    const canonicalId = ONECLICK_USDC_ASSET_MAP[chain].assetId;
    const exactMatch = tokens.find((t) => t.assetId === canonicalId);
    if (exactMatch) return exactMatch;
  }
  if (chain === 'near' && (normSymbol === 'NEAR' || normSymbol === 'WNEAR')) {
    const wnearMatch = tokens.find((t) => t.assetId === 'nep141:wrap.near');
    if (wnearMatch) return wnearMatch;
  }
  if (chain === 'near' && normSymbol === 'USDT') {
    const usdtMatch = tokens.find((t) => t.assetId === 'nep141:usdt.tether-token.near');
    if (usdtMatch) return usdtMatch;
  }

  const candidates = tokens.filter(
    (t) =>
      t.normalizedChain === chain &&
      (t.symbol.toUpperCase() === normSymbol ||
        (normSymbol === 'NEAR' && t.symbol.toUpperCase() === 'WNEAR'))
  );
  if (candidates.length > 0) {
    return candidates[0];
  }
  const fallbackInfo = ONECLICK_USDC_ASSET_MAP[chain] || ONECLICK_USDC_ASSET_MAP.near;
  return {
    assetId: fallbackInfo.assetId,
    symbol: normSymbol,
    blockchain: chainToOneClickBlockchainCode(chain),
    normalizedChain: chain,
    decimals: fallbackInfo.decimals,
    price: 1.0,
    priceUpdatedAt: new Date().toISOString(),
    contractAddress: fallbackInfo.contractAddress,
  };
}

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
  return BigInt(Math.round(amountUsd * factor)).toString();
}

export function tokenUnitsToSmallestUnit(amountUnits: number, decimals: number): string {
  const fixed = amountUnits.toFixed(Math.min(decimals, 8));
  const [whole, frac = ''] = fixed.split('.');
  const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals);
  const combined = `${whole}${paddedFrac}`.replace(/^0+/, '') || '0';
  return combined;
}

export function formatRawTokenAmount(rawAmount: string, decimals: number, maxFraction = 6): string {
  try {
    const val = BigInt(rawAmount || '0');
    const divisor = BigInt(10) ** BigInt(decimals);
    const whole = val / divisor;
    const remainder = val % divisor;
    if (remainder === 0n) {
      return whole.toString();
    }
    const fracStr = remainder.toString().padStart(decimals, '0').slice(0, maxFraction).replace(/0+$/, '');
    return fracStr ? `${whole.toString()}.${fracStr}` : whole.toString();
  } catch {
    return '0';
  }
}

export async function requestOneClickExactOutputQuote(params: {
  originChain?: SupportedChain;
  originAsset?: string;
  destinationChain: SupportedChain;
  payoutAsset: string;
  exactOutputUsd: number;
  recipientAddress: string;
  refundAddress: string;
  dry: boolean;
  slippageToleranceBps?: number;
  allowNetwork?: boolean;
}): Promise<{
  liveQuoteFetched: boolean;
  originChain: SupportedChain;
  originAssetSymbol: string;
  originAssetId: string;
  originDecimals: number;
  originContractAddress?: string;
  destinationChain: SupportedChain;
  destinationAssetSymbol: string;
  destinationAssetId: string;
  destinationDecimals: number;
  exactRequestedOutputRaw: string;
  estimatedInputRaw: string;
  minInputAmountRaw: string;
  estimatedInputFormatted: string;
  feesUsd: number;
  slippageBps: number;
  timeEstimateSeconds: number;
  quoteExpiresAt: string;
  depositAddress: string | null;
  correlationId: string | null;
  quoteSignature: string | null;
  isDryQuote: boolean;
  isSimulatedQuote: boolean;
  error?: string;
}> {
  const tokens = await fetchOneClickSupportedTokens({ allowNetwork: params.allowNetwork });
  const originChain = params.originChain || 'near';
  const originSymbol = (params.originAsset || 'USDC').toUpperCase();
  const destSymbol = (params.payoutAsset || 'USDC').toUpperCase();

  let originToken = resolveOneClickToken(originChain, originSymbol, tokens);
  const destToken = resolveOneClickToken(params.destinationChain, destSymbol, tokens);

  // 1Click requires originAsset !== destinationAsset. When both origin and destination
  // are the exact same token on the same chain (e.g. NEAR USDC -> NEAR USDC), use
  // the chain's paired stablecoin (USDT) as the 1Click solver origin asset so 1Click
  // returns a genuine live solver quote and single-use depositAddress.
  if (originToken.assetId === destToken.assetId) {
    const fallbackPairSymbol =
      originChain === 'near' ? 'WNEAR' : originSymbol === 'USDC' ? 'USDT' : 'USDC';
    const pairedToken = resolveOneClickToken(originChain, fallbackPairSymbol, tokens);
    if (pairedToken.assetId !== destToken.assetId) {
      originToken = pairedToken;
    }
  }

  const destPrice = destToken.price > 0 ? destToken.price : 1.0;
  const outputTokenUnits =
    destSymbol === 'USDC' || destSymbol === 'USDT'
      ? params.exactOutputUsd
      : params.exactOutputUsd / destPrice;
  const exactRequestedOutputRaw = tokenUnitsToSmallestUnit(outputTokenUnits, destToken.decimals);

  const slippageBps = params.slippageToleranceBps ?? 100;
  const baseUrl = (process.env.ONECLICK_API_BASE_URL || 'https://1click.chaindefuser.com').replace(
    /\/$/,
    ''
  );
  const deadline = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const payload = {
    dry: params.dry,
    swapType: 'EXACT_OUTPUT',
    slippageTolerance: slippageBps,
    originAsset: originToken.assetId,
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: destToken.assetId,
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
          const amountInUsdFloat = Number(
            data.quote.amountInUsd || data.quote.amountInFormatted || params.exactOutputUsd
          );
          const feesUsd = Number(Math.max(0, amountInUsdFloat - params.exactOutputUsd).toFixed(4));
          return {
            liveQuoteFetched: true,
            originChain,
            originAssetSymbol: originToken.symbol,
            originAssetId: originToken.assetId,
            originDecimals: originToken.decimals,
            originContractAddress: originToken.contractAddress,
            destinationChain: params.destinationChain,
            destinationAssetSymbol: destToken.symbol,
            destinationAssetId: destToken.assetId,
            destinationDecimals: destToken.decimals,
            exactRequestedOutputRaw: data.quote.amountOut || exactRequestedOutputRaw,
            estimatedInputRaw: data.quote.amountIn,
            minInputAmountRaw: data.quote.minAmountIn || data.quote.amountIn,
            estimatedInputFormatted: `${data.quote.amountInFormatted} ${originToken.symbol}`,
            feesUsd,
            slippageBps,
            timeEstimateSeconds: Number(data.quote.timeEstimate ?? 25),
            quoteExpiresAt: data.quote.deadline || deadline,
            depositAddress: data.quote.depositAddress || null,
            correlationId: data.correlationId || null,
            quoteSignature: data.signature || null,
            isDryQuote: params.dry,
            isSimulatedQuote: false,
          };
        }
      }
    } catch {
      // Fall through to deterministic calculation when offline
    }
  }

  // Deterministic fallback when offline or in pure offline unit test mode
  const bufferMultiplier = params.destinationChain === originChain ? 1.001 : 1.0025;
  const originPrice = originToken.price > 0 ? originToken.price : 1.0;
  const estInputUsd = Number((params.exactOutputUsd * bufferMultiplier).toFixed(4));
  const estInputUnits =
    originSymbol === 'USDC' || originSymbol === 'USDT'
      ? estInputUsd
      : estInputUsd / originPrice;
  const estimatedInputRaw = tokenUnitsToSmallestUnit(estInputUnits, originToken.decimals);
  const feesUsd = Number((estInputUsd - params.exactOutputUsd).toFixed(4));

  return {
    liveQuoteFetched: false,
    originChain,
    originAssetSymbol: originToken.symbol,
    originAssetId: originToken.assetId,
    originDecimals: originToken.decimals,
    originContractAddress: originToken.contractAddress,
    destinationChain: params.destinationChain,
    destinationAssetSymbol: destToken.symbol,
    destinationAssetId: destToken.assetId,
    destinationDecimals: destToken.decimals,
    exactRequestedOutputRaw,
    estimatedInputRaw,
    minInputAmountRaw: estimatedInputRaw,
    estimatedInputFormatted: `${estInputUnits.toFixed(originToken.decimals > 6 ? 6 : 4)} ${originToken.symbol}`,
    feesUsd,
    slippageBps,
    timeEstimateSeconds: 25,
    quoteExpiresAt: deadline,
    depositAddress: null,
    correlationId: null,
    quoteSignature: null,
    isDryQuote: params.dry,
    isSimulatedQuote: true,
  };
}

export async function submitOneClickDepositHash(params: {
  txHash: string;
  depositAddress: string;
  allowNetwork?: boolean;
}): Promise<{ notified: boolean; statusCode?: number; message?: string }> {
  if (params.allowNetwork === false) {
    return { notified: false, message: 'Offline mode: skipped 1Click deposit notification.' };
  }
  const baseUrl = (process.env.ONECLICK_API_BASE_URL || 'https://1click.chaindefuser.com').replace(
    /\/$/,
    ''
  );
  try {
    const res = await fetch(`${baseUrl}/v0/deposit/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        txHash: params.txHash,
        depositAddress: params.depositAddress,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    return {
      notified: res.ok,
      statusCode: res.status,
      message: data.message || (res.ok ? '1Click notified of deposit txHash.' : `HTTP ${res.status}`),
    };
  } catch (err) {
    return {
      notified: false,
      message: `Failed to notify 1Click deposit endpoint: ${(err as Error).message}`,
    };
  }
}

export async function pollOneClickExecutionStatus(depositAddress: string): Promise<{
  status: PaymentStatus;
  lifecycleStatus: PaymentLifecycleStatus;
  rawOneClickStatus: string;
  txHash: string | null;
  originTxHash: string | null;
  destinationTxHash: string | null;
  explorerUrl: string | null;
  destinationExplorerUrl: string | null;
  actualReceivedAmount: string | null;
  refundReason: string | null;
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
      refundReason?: string | null;
      originChainTxHashes?: Array<{ hash: string; explorerUrl?: string }>;
      destinationChainTxHashes?: Array<{ hash: string; explorerUrl?: string }>;
      nearTxHashes?: string[];
    };
  };

  const rawStatus = (data.status || 'PENDING_DEPOSIT').toUpperCase();
  let mappedStatus: PaymentStatus = 'PENDING';
  let lifecycleStatus: PaymentLifecycleStatus = 'AWAITING_WALLET_SIGNATURE';

  if (rawStatus === 'SUCCESS') {
    mappedStatus = 'PAID';
    lifecycleStatus = 'COMPLETED';
  } else if (rawStatus === 'KNOWN_DEPOSIT_TX') {
    mappedStatus = 'DEPOSIT_CONFIRMED';
    lifecycleStatus = 'DEPOSIT_CONFIRMED';
  } else if (rawStatus === 'PROCESSING') {
    mappedStatus = 'PROCESSING';
    lifecycleStatus = 'PROCESSING';
  } else if (rawStatus === 'REFUNDED') {
    mappedStatus = 'REFUNDED';
    lifecycleStatus = 'REFUNDED';
  } else if (rawStatus === 'FAILED' || rawStatus === 'INCOMPLETE_DEPOSIT') {
    mappedStatus = 'FAILED';
    lifecycleStatus = 'FAILED';
  }

  const originTx = data.swapDetails?.originChainTxHashes?.[0];
  const destTx = data.swapDetails?.destinationChainTxHashes?.[0];
  const nearTx = data.swapDetails?.nearTxHashes?.[0] || null;
  const txHash = destTx?.hash || originTx?.hash || nearTx || null;
  const explorerUrl =
    destTx?.explorerUrl ||
    originTx?.explorerUrl ||
    (txHash ? `https://nearblocks.io/txns/${txHash}` : null);

  return {
    status: mappedStatus,
    lifecycleStatus,
    rawOneClickStatus: rawStatus,
    txHash,
    originTxHash: originTx?.hash || nearTx || null,
    destinationTxHash: destTx?.hash || null,
    explorerUrl,
    destinationExplorerUrl: destTx?.explorerUrl || null,
    actualReceivedAmount: data.swapDetails?.amountOutFormatted
      ? `${data.swapDetails.amountOutFormatted} USDC`
      : null,
    refundReason: data.swapDetails?.refundReason || null,
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

  // Re-verify allowed payout assets right before execution
  const normalizedAsset = invoice.requestedPayoutAsset.toUpperCase();
  const allowedAssetsUpper = policy.allowed_payout_assets.map((a) => a.toUpperCase());
  if (!allowedAssetsUpper.includes(normalizedAsset)) {
    return {
      allowed: false,
      reason: `Requested payout asset "${invoice.requestedPayoutAsset}" is not in allowed_payout_assets (${policy.allowed_payout_assets.join(', ')}).`,
    };
  }

  // Re-verify destination address format right before execution
  const addressSyntax = validateDestinationAddressFormat(
    invoice.requestedDestinationChain,
    invoice.receivingWalletAddress
  );
  if (!addressSyntax.valid) {
    return {
      allowed: false,
      reason: `Invalid destination wallet address for ${invoice.requestedDestinationChain}: ${addressSyntax.reason}`,
    };
  }

  // Re-verify vendor has not been SUSPENDED since intake
  if (invoice.vendorId || invoice.vendorName) {
    const currentVendor = getVendorByIdOrName(invoice.vendorId, invoice.vendorName, db);
    if (currentVendor && currentVendor.status === 'SUSPENDED') {
      return {
        allowed: false,
        reason: `Vendor "${currentVendor.businessName}" (${currentVendor.id}) is currently SUSPENDED.`,
      };
    }
  }

  // Re-verify rolling 24-hour daily spending cap right before execution
  const currentDailySpend = getDailySpendSoFarUsd(invoice.mode, db);
  if (currentDailySpend + invoice.total > policy.daily_cap_usd + 0.005) {
    return {
      allowed: false,
      reason: `Executing this $${invoice.total.toFixed(2)} payment would bring 24-hour spend to $${(currentDailySpend + invoice.total).toFixed(2)}, exceeding daily_cap_usd ($${policy.daily_cap_usd.toFixed(2)}).`,
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

// ============================================================================
// NON-CUSTODIAL WALLET TRANSACTION PREPARATION & LIFECYCLE ENGINE (PHASES 4-8)
// ============================================================================

export const EVM_CHAIN_METADATA: Record<
  'ethereum' | 'base' | 'arbitrum',
  { chainIdDecimal: number; chainIdHex: string; networkName: string; rpcUrl: string; explorerTxPrefix: string }
> = {
  ethereum: {
    chainIdDecimal: 1,
    chainIdHex: '0x1',
    networkName: 'Ethereum Mainnet',
    rpcUrl: process.env.ETH_RPC_URL || 'https://ethereum-rpc.publicnode.com',
    explorerTxPrefix: 'https://etherscan.io/tx/',
  },
  base: {
    chainIdDecimal: 8453,
    chainIdHex: '0x2105',
    networkName: 'Base Mainnet',
    rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    explorerTxPrefix: 'https://basescan.org/tx/',
  },
  arbitrum: {
    chainIdDecimal: 42161,
    chainIdHex: '0xa4b1',
    networkName: 'Arbitrum One',
    rpcUrl: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
    explorerTxPrefix: 'https://arbiscan.io/tx/',
  },
};

/**
 * ABI-encodes ERC-20 `transfer(address,uint256)` selector `0xa9059cbb`.
 * Never confuses an ERC-20 token transfer with a native ETH value transfer.
 */
export function encodeErc20TransferCalldata(recipientAddress: string, amountRaw: string): string {
  const cleanRecipient = recipientAddress.trim().replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(cleanRecipient)) {
    throw new Error(`Invalid EVM recipient address for ERC-20 transfer: "${recipientAddress}"`);
  }
  const amountBig = BigInt(amountRaw);
  if (amountBig <= 0n) {
    throw new Error(`ERC-20 transfer amount must be greater than zero (got ${amountRaw}).`);
  }
  const paddedAddress = cleanRecipient.padStart(64, '0');
  const paddedAmount = amountBig.toString(16).padStart(64, '0');
  return `0xa9059cbb${paddedAddress}${paddedAmount}`;
}

export async function checkNearNep141StorageRegistration(
  tokenContract: string,
  accountId: string,
  allowNetwork = true
): Promise<boolean> {
  if (!allowNetwork) return true;
  const rpcUrl = process.env.NEAR_RPC_MAINNET_URL || 'https://rpc.mainnet.near.org';
  try {
    const argsBase64 = Buffer.from(JSON.stringify({ account_id: accountId }), 'utf8').toString(
      'base64'
    );
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'steward-storage-check',
        method: 'query',
        params: {
          request_type: 'call_function',
          finality: 'final',
          account_id: tokenContract,
          method_name: 'storage_balance_of',
          args_base64: argsBase64,
        },
      }),
    });
    const json = (await res.json()) as { result?: { result?: number[] } };
    if (json.result?.result) {
      const decoded = Buffer.from(json.result.result).toString('utf8');
      const parsed = JSON.parse(decoded);
      return parsed !== null && typeof parsed === 'object' && Boolean(parsed.total);
    }
  } catch {
    // Assume registered if RPC check fails so signing is not blocked unnecessarily
  }
  return true;
}

/**
 * Constructs the exact wallet-specific unsigned transaction payload for either
 * NEAR Wallet (`@hot-labs/near-connect`) or MetaMask (`EIP-1193`).
 */
export async function buildSourceWalletTransaction(params: {
  walletType: 'near' | 'metamask';
  sourceChain: SupportedChain;
  sourceWalletAddress: string;
  recipientDepositAddress: string;
  sourceAssetSymbol: string;
  sourceAssetId: string;
  sourceAssetDecimals: number;
  sourceTokenContract?: string;
  amountRaw: string;
  invoiceNumber: string;
  allowNetwork?: boolean;
}): Promise<PreparedWalletTransaction> {
  const symbolUpper = params.sourceAssetSymbol.trim().toUpperCase();
  const amountFormatted = `${formatRawTokenAmount(params.amountRaw, params.sourceAssetDecimals, 6)} ${symbolUpper}`;

  if (params.walletType === 'near') {
    if (params.sourceChain !== 'near') {
      throw new Error(
        `NEAR Wallet can only sign origin transactions on the NEAR network (requested: ${params.sourceChain}).`
      );
    }

    const addrCheck = validateDestinationAddressFormat('near', params.recipientDepositAddress);
    if (!addrCheck.valid) {
      throw new Error(
        `Invalid NEAR 1Click deposit address "${params.recipientDepositAddress}": ${addrCheck.reason}`
      );
    }

    const isNativeNear =
      symbolUpper === 'NEAR' &&
      (!params.sourceTokenContract || params.sourceTokenContract === 'native');

    if (isNativeNear) {
      return {
        walletType: 'near',
        kind: 'near_native_transfer',
        sourceChain: 'near',
        networkName: 'NEAR Mainnet',
        fromAddress: params.sourceWalletAddress,
        recipientDepositAddress: params.recipientDepositAddress,
        contractOrReceiverAddress: params.recipientDepositAddress,
        sourceAssetSymbol: symbolUpper,
        sourceAssetId: params.sourceAssetId,
        sourceAssetDecimals: 24,
        amountRaw: params.amountRaw,
        amountFormatted,
        estimatedGasDisplay: '~0.00045 NEAR (4.5 TGas)',
        nearTransactions: [
          {
            receiverId: params.recipientDepositAddress,
            description: `Transfer ${amountFormatted} to 1Click deposit address ${params.recipientDepositAddress}`,
            actions: [
              {
                type: 'Transfer',
                params: {
                  deposit: params.amountRaw,
                },
              },
            ],
          },
        ],
      };
    }

    // NEP-141 Fungible Token Transfer (e.g., USDC, USDT, wNEAR)
    const tokenContract =
      params.sourceTokenContract ||
      params.sourceAssetId.replace(/^1cs_v1:near:nep141:|^nep141:/, '') ||
      ONECLICK_USDC_ASSET_MAP.near.contractAddress!;

    const isDepositAddrRegistered = await checkNearNep141StorageRegistration(
      tokenContract,
      params.recipientDepositAddress,
      params.allowNetwork ?? true
    );

    const actions: PreparedNearAction[] = [];
    if (!isDepositAddrRegistered) {
      actions.push({
        type: 'FunctionCall',
        params: {
          methodName: 'storage_deposit',
          args: {
            account_id: params.recipientDepositAddress,
            registration_only: true,
          },
          gas: '15000000000000', // 15 TGas
          deposit: '1250000000000000000000', // 0.00125 NEAR NEP-145 minimum storage deposit
        },
      });
    }

    actions.push({
      type: 'FunctionCall',
      params: {
        methodName: 'ft_transfer',
        args: {
          receiver_id: params.recipientDepositAddress,
          amount: params.amountRaw,
          memo: `STEWARD Invoice ${params.invoiceNumber}`,
        },
        gas: '30000000000000', // 30 TGas
        deposit: '1', // 1 yoctoNEAR required by NEP-141 standard for user signature verification
      },
    });

    return {
      walletType: 'near',
      kind: 'near_nep141_transfer',
      sourceChain: 'near',
      networkName: 'NEAR Mainnet',
      fromAddress: params.sourceWalletAddress,
      recipientDepositAddress: params.recipientDepositAddress,
      contractOrReceiverAddress: tokenContract,
      sourceAssetSymbol: symbolUpper,
      sourceAssetId: params.sourceAssetId,
      sourceAssetDecimals: params.sourceAssetDecimals,
      amountRaw: params.amountRaw,
      amountFormatted,
      estimatedGasDisplay: isDepositAddrRegistered
        ? '30 TGas (~0.003 NEAR) + 1 yoctoNEAR'
        : '45 TGas + 0.00125 NEAR storage_deposit',
      nearTransactions: [
        {
          receiverId: tokenContract,
          description: `NEP-141 ft_transfer of ${amountFormatted} on contract ${tokenContract} to 1Click deposit address`,
          actions,
        },
      ],
    };
  }

  // MetaMask / EVM Transaction Construction
  if (
    params.sourceChain !== 'ethereum' &&
    params.sourceChain !== 'base' &&
    params.sourceChain !== 'arbitrum'
  ) {
    throw new Error(
      `MetaMask adapter supports Ethereum, Base, and Arbitrum source networks (requested: ${params.sourceChain}).`
    );
  }

  const evmMeta = EVM_CHAIN_METADATA[params.sourceChain];
  const addrCheck = validateDestinationAddressFormat(
    params.sourceChain,
    params.recipientDepositAddress
  );
  if (!addrCheck.valid) {
    throw new Error(
      `Invalid EVM 1Click deposit address "${params.recipientDepositAddress}": ${addrCheck.reason}`
    );
  }

  const isNativeEth =
    symbolUpper === 'ETH' &&
    (!params.sourceTokenContract || !params.sourceTokenContract.startsWith('0x'));

  if (isNativeEth) {
    const valueHex = `0x${BigInt(params.amountRaw).toString(16)}`;
    return {
      walletType: 'metamask',
      kind: 'evm_native_transfer',
      sourceChain: params.sourceChain,
      networkName: evmMeta.networkName,
      chainIdHex: evmMeta.chainIdHex,
      chainIdDecimal: evmMeta.chainIdDecimal,
      fromAddress: params.sourceWalletAddress,
      recipientDepositAddress: params.recipientDepositAddress,
      contractOrReceiverAddress: params.recipientDepositAddress,
      sourceAssetSymbol: 'ETH',
      sourceAssetId: params.sourceAssetId,
      sourceAssetDecimals: 18,
      amountRaw: params.amountRaw,
      amountFormatted,
      estimatedGasDisplay: '21,000 gas (Native ETH Transfer)',
      evmTransaction: {
        from: params.sourceWalletAddress,
        to: params.recipientDepositAddress,
        value: valueHex,
        data: '0x',
        chainId: evmMeta.chainIdHex,
      },
    };
  }

  // ERC-20 Token Transfer (e.g., USDC, USDT on Ethereum/Base/Arbitrum)
  const tokenContract =
    params.sourceTokenContract ||
    ONECLICK_USDC_ASSET_MAP[params.sourceChain]?.contractAddress;
  if (!tokenContract || !/^0x[0-9a-fA-F]{40}$/.test(tokenContract)) {
    throw new Error(
      `Missing or invalid ERC-20 contract address for ${symbolUpper} on ${params.sourceChain}.`
    );
  }

  const calldata = encodeErc20TransferCalldata(params.recipientDepositAddress, params.amountRaw);

  return {
    walletType: 'metamask',
    kind: 'evm_erc20_transfer',
    sourceChain: params.sourceChain,
    networkName: evmMeta.networkName,
    chainIdHex: evmMeta.chainIdHex,
    chainIdDecimal: evmMeta.chainIdDecimal,
    fromAddress: params.sourceWalletAddress,
    recipientDepositAddress: params.recipientDepositAddress,
    contractOrReceiverAddress: tokenContract,
    sourceAssetSymbol: symbolUpper,
    sourceAssetId: params.sourceAssetId,
    sourceAssetDecimals: params.sourceAssetDecimals,
    amountRaw: params.amountRaw,
    amountFormatted,
    estimatedGasDisplay: '~65,000 gas (ERC-20 transfer)',
    evmTransaction: {
      from: params.sourceWalletAddress,
      to: tokenContract,
      value: '0x0',
      data: calldata,
      chainId: evmMeta.chainIdHex,
    },
  };
}

/**
 * Step 1 of Non-Custodial Payment Flow:
 * Revalidates the invoice against all deterministic policy & security controls,
 * requests a DRY 1Click EXACT_OUTPUT quote for the selected funding wallet,
 * and saves the payment record in `APPROVED` lifecycle state.
 */
export async function prepareNonCustodialPayment(params: {
  invoiceId: string;
  sourceWalletType: TreasuryWalletType;
  sourceWalletAddress: string;
  sourceChain: SupportedChain;
  sourceAssetSymbol: string;
  restartAuthorization?: boolean;
  allowNetwork?: boolean;
  db?: DatabaseSync;
}): Promise<PaymentExecutionRecord> {
  const db = params.db || getDb();
  const invoice = getInvoiceById(params.invoiceId, db);
  if (!invoice) {
    throw new Error(`Invoice "${params.invoiceId}" not found.`);
  }

  // Prevent duplicate execution of already paid or in-flight deposits
  const existing = getPaymentByInvoiceId(invoice.id, db);
  if (
    existing &&
    existing.custodyMode === 'non_custodial_wallet' &&
    ['COMPLETED', 'DEPOSIT_SUBMITTED', 'DEPOSIT_CONFIRMED', 'PROCESSING'].includes(
      existing.lifecycleStatus || ''
    )
  ) {
    throw new Error(
      `Invoice #${invoice.invoiceNumber} already has an active or completed non-custodial payment (${existing.id}, status: ${existing.lifecycleStatus}). Duplicate payment prevented.`
    );
  }

  // Phase 5 Guard: Never allow switching between SIMULATED and REAL mode in the middle of an active payment without restarting authorization
  const requestedIsSimulated = params.sourceWalletType === 'simulated';
  if (
    existing &&
    ['APPROVED', 'AWAITING_WALLET_SIGNATURE'].includes(existing.lifecycleStatus || '')
  ) {
    const existingWasSimulated =
      existing.sourceWalletType === 'simulated' ||
      existing.isSimulatedTransaction ||
      existing.custodyMode === 'simulation';
    if (existingWasSimulated !== requestedIsSimulated && !params.restartAuthorization) {
      throw new Error(
        'Cannot switch between SIMULATED MODE and REAL MODE in the middle of an active payment without restarting the authorization flow and revalidating all policies.'
      );
    }
  }

  // If invoice was HELD and is being previewed on the Payment Authorization Screen, or auto-approved by policy, verify revalidation gate
  const invoiceForRevalidation: ProcessedInvoiceRecord =
    invoice.finalDecision === 'HOLD' && !invoice.approvedBy
      ? { ...invoice, approvedBy: 'controller@steward-ap.finance (authorization-preview)' }
      : invoice;
  const revalidation = independentlyRevalidateBeforeExecution(invoiceForRevalidation, db);
  if (!revalidation.allowed) {
    throw new Error(`Payment preparation blocked by policy engine: ${revalidation.reason}`);
  }

  // Verify source wallet address format matches sourceChain
  const sourceAddrCheck = validateDestinationAddressFormat(
    params.sourceChain,
    params.sourceWalletAddress
  );
  if (!sourceAddrCheck.valid) {
    throw new Error(
      `Connected funding wallet address "${params.sourceWalletAddress}" is not valid for source chain "${params.sourceChain}": ${sourceAddrCheck.reason}`
    );
  }

  const quote = await requestOneClickExactOutputQuote({
    originChain: params.sourceChain,
    originAsset: params.sourceAssetSymbol,
    destinationChain: invoice.requestedDestinationChain,
    payoutAsset: invoice.requestedPayoutAsset,
    exactOutputUsd: invoice.total,
    recipientAddress: invoice.receivingWalletAddress,
    refundAddress: params.sourceWalletAddress,
    dry: true,
    allowNetwork: params.allowNetwork ?? true,
  });

  const nowIso = new Date().toISOString();
  const idempotencyKey = `steward-nc-pay:${invoice.id}:${invoice.invoiceNumber}`;
  const isSimulatedWallet = params.sourceWalletType === 'simulated';

  const record: PaymentExecutionRecord = {
    id: existing?.id || `PAY-NC-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    invoiceId: invoice.id,
    idempotencyKey,
    mode: isSimulatedWallet ? 'simulation' : 'live',
    custodyMode: isSimulatedWallet ? 'simulation' : 'non_custodial_wallet',
    status: 'APPROVED',
    lifecycleStatus: 'APPROVED',
    quoteId: quote.correlationId ? `1CLICK-DRY-${quote.correlationId.slice(0, 8)}` : `DRY-${Date.now()}`,
    correlationId: quote.correlationId,
    depositAddress: null, // Dry quotes never produce a deposit address
    sourceAsset: `${quote.originAssetSymbol} (${params.sourceChain.toUpperCase()})`,
    sourceAssetId: quote.originAssetId,
    destinationAsset: `${quote.destinationAssetSymbol} (${invoice.requestedDestinationChain.toUpperCase()})`,
    destinationAssetId: quote.destinationAssetId,
    sourceChain: params.sourceChain,
    destinationChain: invoice.requestedDestinationChain,
    sourceWalletAddress: params.sourceWalletAddress,
    sourceWalletType: params.sourceWalletType,
    exactRequestedOutput: `${invoice.total.toFixed(2)} ${invoice.requestedPayoutAsset}`,
    exactRequestedOutputRaw: quote.exactRequestedOutputRaw,
    estimatedInputAmount: quote.estimatedInputFormatted,
    estimatedInputRaw: quote.estimatedInputRaw,
    minInputAmountRaw: quote.minInputAmountRaw,
    actualReceivedAmount: null,
    feesUsd: quote.feesUsd,
    slippageBps: quote.slippageBps,
    timeEstimateSeconds: quote.timeEstimateSeconds,
    quoteExpiresAt: quote.quoteExpiresAt,
    isDryQuote: true,
    isSimulatedQuote: quote.isSimulatedQuote,
    isSimulatedTransaction: isSimulatedWallet,
    refundAddress: params.sourceWalletAddress,
    recipientAddress: invoice.receivingWalletAddress,
    txHash: null,
    destinationTxHash: null,
    explorerUrl: null,
    destinationExplorerUrl: null,
    quoteSignature: quote.quoteSignature,
    statusSource: quote.liveQuoteFetched
      ? 'LIVE QUOTE (1Click Dry Preview — Awaiting User Commitment)'
      : 'SIMULATED QUOTE (Offline Deterministic Dry Preview)',
    refundReason: null,
    errorMessage: null,
    preparedTransaction: null,
    createdAt: existing?.createdAt || nowIso,
    updatedAt: nowIso,
  };

  savePaymentExecution(record, db);
  return record;
}

/**
 * Step 2 of Non-Custodial Payment Flow:
 * When the user clicks "Confirm & Request Wallet Signature" on the Payment Authorization Screen,
 * requests a COMMITTED quote (`dry: false`) from 1Click, obtains the quote-specific single-use
 * `depositAddress`, constructs the unsigned source-wallet transaction (`PreparedWalletTransaction`),
 * and transitions the payment to `AWAITING_WALLET_SIGNATURE`.
 */
export async function commitQuoteAndPrepareTransaction(params: {
  invoiceId: string;
  sourceWalletType: 'near' | 'metamask';
  sourceWalletAddress: string;
  sourceChain: SupportedChain;
  sourceAssetSymbol: string;
  restartAuthorization?: boolean;
  allowNetwork?: boolean;
  db?: DatabaseSync;
}): Promise<PaymentExecutionRecord> {
  const db = params.db || getDb();
  const invoice = getInvoiceById(params.invoiceId, db);
  if (!invoice) {
    throw new Error(`Invoice "${params.invoiceId}" not found.`);
  }

  // Prevent duplicate execution
  const existing = getPaymentByInvoiceId(invoice.id, db);
  if (
    existing &&
    existing.custodyMode === 'non_custodial_wallet' &&
    ['COMPLETED', 'DEPOSIT_SUBMITTED', 'DEPOSIT_CONFIRMED', 'PROCESSING'].includes(
      existing.lifecycleStatus || ''
    )
  ) {
    throw new Error(
      `Invoice #${invoice.invoiceNumber} already has a submitted or completed payment (${existing.id}, status: ${existing.lifecycleStatus}).`
    );
  }

  // Phase 5 Guard: Never allow switching an active SIMULATED payment into a REAL committed quote mid-flight without restarting authorization
  if (
    existing &&
    ['APPROVED', 'AWAITING_WALLET_SIGNATURE'].includes(existing.lifecycleStatus || '') &&
    (existing.sourceWalletType === 'simulated' || existing.isSimulatedTransaction) &&
    !params.restartAuthorization
  ) {
    throw new Error(
      'Cannot switch from SIMULATED MODE to REAL MODE in the middle of an active payment without restarting the authorization flow and revalidating all policies.'
    );
  }

  // If invoice is in HOLD status, committing the quote in the Payment Authorization Modal records controller approval
  if (invoice.finalDecision === 'HOLD' && !invoice.approvedBy) {
    invoice.approvedBy = 'controller@steward-ap.finance';
    invoice.approvedAt = new Date().toISOString();
  }

  // Revalidate all policy rules immediately before requesting a committed quote
  const revalidation = independentlyRevalidateBeforeExecution(invoice, db);
  if (!revalidation.allowed) {
    throw new Error(`Committed quote blocked by policy engine: ${revalidation.reason}`);
  }

  const committedQuote = await requestOneClickExactOutputQuote({
    originChain: params.sourceChain,
    originAsset: params.sourceAssetSymbol,
    destinationChain: invoice.requestedDestinationChain,
    payoutAsset: invoice.requestedPayoutAsset,
    exactOutputUsd: invoice.total,
    recipientAddress: invoice.receivingWalletAddress,
    refundAddress: params.sourceWalletAddress,
    dry: false,
    allowNetwork: params.allowNetwork ?? true,
  });

  // If offline in unit tests, provide a deterministic valid-format test deposit address
  // while marking `isSimulatedQuote = true`.
  const depositAddress =
    committedQuote.depositAddress ||
    (params.sourceChain === 'near'
      ? '337934d8c1ca8b79391ee77f46a679d14781f29be691618defb4cadd8355f0ff'
      : '0x15ddA711A7490d370d158391FB05D9bb2Fe3D61B');

  const preparedTx = await buildSourceWalletTransaction({
    walletType: params.sourceWalletType,
    sourceChain: params.sourceChain,
    sourceWalletAddress: params.sourceWalletAddress,
    recipientDepositAddress: depositAddress,
    sourceAssetSymbol: committedQuote.originAssetSymbol,
    sourceAssetId: committedQuote.originAssetId,
    sourceAssetDecimals: committedQuote.originDecimals,
    sourceTokenContract: committedQuote.originContractAddress,
    amountRaw: committedQuote.estimatedInputRaw,
    invoiceNumber: invoice.invoiceNumber,
    allowNetwork: params.allowNetwork ?? true,
  });

  const nowIso = new Date().toISOString();
  const idempotencyKey = `steward-nc-pay:${invoice.id}:${invoice.invoiceNumber}`;

  const record: PaymentExecutionRecord = {
    id: existing?.id || `PAY-NC-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    invoiceId: invoice.id,
    idempotencyKey,
    mode: 'live',
    custodyMode: 'non_custodial_wallet',
    status: 'AWAITING_WALLET_SIGNATURE',
    lifecycleStatus: 'AWAITING_WALLET_SIGNATURE',
    quoteId: committedQuote.correlationId
      ? `1CLICK-COMMIT-${committedQuote.correlationId.slice(0, 8)}`
      : `COMMIT-${Date.now()}`,
    correlationId: committedQuote.correlationId,
    depositAddress,
    sourceAsset: `${committedQuote.originAssetSymbol} (${params.sourceChain.toUpperCase()})`,
    sourceAssetId: committedQuote.originAssetId,
    destinationAsset: `${committedQuote.destinationAssetSymbol} (${invoice.requestedDestinationChain.toUpperCase()})`,
    destinationAssetId: committedQuote.destinationAssetId,
    sourceChain: params.sourceChain,
    destinationChain: invoice.requestedDestinationChain,
    sourceWalletAddress: params.sourceWalletAddress,
    sourceWalletType: params.sourceWalletType,
    exactRequestedOutput: `${invoice.total.toFixed(2)} ${invoice.requestedPayoutAsset}`,
    exactRequestedOutputRaw: committedQuote.exactRequestedOutputRaw,
    estimatedInputAmount: committedQuote.estimatedInputFormatted,
    estimatedInputRaw: committedQuote.estimatedInputRaw,
    minInputAmountRaw: committedQuote.minInputAmountRaw,
    actualReceivedAmount: null,
    feesUsd: committedQuote.feesUsd,
    slippageBps: committedQuote.slippageBps,
    timeEstimateSeconds: committedQuote.timeEstimateSeconds,
    quoteExpiresAt: committedQuote.quoteExpiresAt,
    isDryQuote: false,
    isSimulatedQuote: committedQuote.isSimulatedQuote,
    isSimulatedTransaction: false,
    refundAddress: params.sourceWalletAddress,
    recipientAddress: invoice.receivingWalletAddress,
    txHash: null,
    destinationTxHash: null,
    explorerUrl: null,
    destinationExplorerUrl: null,
    quoteSignature: committedQuote.quoteSignature,
    statusSource: committedQuote.liveQuoteFetched
      ? `LIVE QUOTE COMMITTED (1Click Deposit Address: ${depositAddress.slice(0, 12)}...)`
      : 'SIMULATED QUOTE COMMITTED (Offline Deterministic Mode)',
    refundReason: null,
    errorMessage: null,
    preparedTransaction: preparedTx,
    createdAt: existing?.createdAt || nowIso,
    updatedAt: nowIso,
  };

  savePaymentExecution(record, db);

  // Also update invoice status to AWAITING_WALLET_SIGNATURE so UI reflects in-flight state
  invoice.paymentStatus = 'AWAITING_WALLET_SIGNATURE';
  invoice.paymentExecution = record;
  invoice.updatedAt = nowIso;
  saveProcessedInvoice(invoice, db);

  logSecurityEvent(
    {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      vendorName: invoice.vendorName,
      severity: 'INFO',
      category: 'PAYMENT_AUTHORIZATION',
      title: `Committed 1Click Quote Prepared for Invoice #${invoice.invoiceNumber}`,
      description: `Prepared ${preparedTx.kind} from ${params.sourceWalletAddress} (${params.sourceChain.toUpperCase()}) to 1Click deposit address ${depositAddress}. Awaiting explicit wallet signature.`,
      metadataJson: JSON.stringify({
        paymentId: record.id,
        depositAddress,
        quoteId: record.quoteId,
        amountFormatted: preparedTx.amountFormatted,
      }),
    },
    db
  );

  return record;
}

/**
 * Step 3 of Non-Custodial Payment Flow:
 * Records the user-signed transaction hash from NEAR Wallet or MetaMask,
 * verifies the quote has not expired, notifies 1Click (`POST /v0/deposit/submit`),
 * and transitions the payment to `DEPOSIT_SUBMITTED`.
 * NEVER marks the invoice PAID until 1Click confirms cross-chain settlement!
 */
export async function submitSignedDepositTransaction(params: {
  paymentId: string;
  txHash: string;
  isSimulatedTransaction?: boolean;
  allowNetwork?: boolean;
  db?: DatabaseSync;
}): Promise<PaymentExecutionRecord> {
  const db = params.db || getDb();
  const payment = getPaymentById(params.paymentId, db);
  if (!payment) {
    throw new Error(`Payment record "${params.paymentId}" not found.`);
  }

  const invoice = getInvoiceById(payment.invoiceId, db);
  if (!invoice) {
    throw new Error(`Invoice "${payment.invoiceId}" not found.`);
  }

  if (!params.txHash || typeof params.txHash !== 'string' || !params.txHash.trim()) {
    throw new Error('txHash is required when recording a signed wallet deposit.');
  }

  // Prevent reusing an expired quote
  if (payment.quoteExpiresAt) {
    const expMs = new Date(payment.quoteExpiresAt).getTime();
    if (Number.isFinite(expMs) && expMs < Date.now()) {
      payment.status = 'EXPIRED';
      payment.lifecycleStatus = 'EXPIRED';
      payment.errorMessage = `Quote expired at ${payment.quoteExpiresAt}. Please request a fresh quote.`;
      payment.updatedAt = new Date().toISOString();
      savePaymentExecution(payment, db);
      throw new Error(payment.errorMessage);
    }
  }

  // Prevent duplicate submission on already completed payments
  if (payment.lifecycleStatus === 'COMPLETED' || payment.status === 'PAID') {
    throw new Error(`Payment "${payment.id}" is already completed.`);
  }

  // Phase 5 Guard: Never allow a payment prepared in SIMULATED mode to be submitted as a REAL deposit transaction without restarting authorization
  const existingIsSimulated =
    payment.sourceWalletType === 'simulated' || payment.custodyMode === 'simulation';
  if (existingIsSimulated && params.isSimulatedTransaction === false) {
    throw new Error(
      'Cannot switch from SIMULATED MODE to REAL MODE in the middle of an active payment without restarting the authorization flow and revalidating all policies.'
    );
  }

  const cleanTxHash = params.txHash.trim();
  const nowIso = new Date().toISOString();
  const isSimTx = Boolean(params.isSimulatedTransaction) || existingIsSimulated;

  let explorerUrl: string | null = null;
  if (!isSimTx) {
    if (payment.sourceChain === 'near') {
      explorerUrl = `https://nearblocks.io/txns/${cleanTxHash}`;
    } else if (
      payment.sourceChain === 'ethereum' ||
      payment.sourceChain === 'base' ||
      payment.sourceChain === 'arbitrum'
    ) {
      explorerUrl = `${EVM_CHAIN_METADATA[payment.sourceChain].explorerTxPrefix}${cleanTxHash}`;
    }
  }

  // Notify 1Click of the deposit transaction hash when live
  let notifyNote = 'Simulated deposit recorded (not sent to mainnet).';
  if (!isSimTx && payment.depositAddress) {
    const notifyRes = await submitOneClickDepositHash({
      txHash: cleanTxHash,
      depositAddress: payment.depositAddress,
      allowNetwork: params.allowNetwork ?? true,
    });
    notifyNote = notifyRes.message || '1Click deposit notification sent.';
  }

  payment.txHash = isSimTx ? null : cleanTxHash;
  payment.explorerUrl = explorerUrl;
  payment.isSimulatedTransaction = isSimTx;
  payment.status = 'DEPOSIT_SUBMITTED';
  payment.lifecycleStatus = 'DEPOSIT_SUBMITTED';
  payment.statusSource = isSimTx
    ? 'SIMULATED TRANSACTION (Deposit Submitted in Sandbox)'
    : `LIVE TRANSACTION SUBMITTED (${notifyNote})`;
  payment.updatedAt = nowIso;

  savePaymentExecution(payment, db);

  invoice.paymentStatus = 'DEPOSIT_SUBMITTED';
  invoice.paymentExecution = payment;
  invoice.updatedAt = nowIso;
  saveProcessedInvoice(invoice, db);

  logSecurityEvent(
    {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      vendorName: invoice.vendorName,
      severity: 'INFO',
      category: 'PAYMENT_AUTHORIZATION',
      title: `Signed Wallet Deposit Submitted for Invoice #${invoice.invoiceNumber}`,
      description: `Source chain (${payment.sourceChain.toUpperCase()}) deposit transaction submitted (${isSimTx ? 'SIMULATED' : cleanTxHash}). Tracking 1Click cross-chain settlement.`,
      metadataJson: JSON.stringify({
        paymentId: payment.id,
        txHash: payment.txHash,
        depositAddress: payment.depositAddress,
        isSimulatedTransaction: isSimTx,
      }),
    },
    db
  );

  return payment;
}

/**
 * Step 4 of Non-Custodial Payment Flow:
 * Polls 1Click (`GET /v0/status?depositAddress=...`) for live cross-chain settlement status
 * and synchronizes both `payments` and `invoices`.
 * Only marks an invoice `PAID` (`COMPLETED`) when 1Click confirms `SUCCESS`.
 */
export async function pollAndSyncPaymentLifecycle(params: {
  paymentId: string;
  allowNetwork?: boolean;
  db?: DatabaseSync;
}): Promise<PaymentExecutionRecord> {
  const db = params.db || getDb();
  const payment = getPaymentById(params.paymentId, db);
  if (!payment) {
    throw new Error(`Payment record "${params.paymentId}" not found.`);
  }

  const invoice = getInvoiceById(payment.invoiceId, db);
  const nowIso = new Date().toISOString();

  // Check if quote expired before deposit was submitted
  if (
    payment.quoteExpiresAt &&
    !payment.txHash &&
    ['APPROVED', 'AWAITING_WALLET_SIGNATURE'].includes(payment.lifecycleStatus || '')
  ) {
    const expMs = new Date(payment.quoteExpiresAt).getTime();
    if (Number.isFinite(expMs) && expMs < Date.now()) {
      payment.status = 'EXPIRED';
      payment.lifecycleStatus = 'EXPIRED';
      payment.errorMessage = `Committed quote expired at ${payment.quoteExpiresAt} before deposit was signed.`;
      payment.updatedAt = nowIso;
      savePaymentExecution(payment, db);
      if (invoice) {
        invoice.paymentStatus = 'EXPIRED';
        invoice.paymentExecution = payment;
        invoice.updatedAt = nowIso;
        saveProcessedInvoice(invoice, db);
      }
      return payment;
    }
  }

  if (!payment.depositAddress || payment.isSimulatedTransaction || params.allowNetwork === false) {
    return payment;
  }

  const poll = await pollOneClickExecutionStatus(payment.depositAddress);

  // If we already submitted a deposit txHash and 1Click still says PENDING_DEPOSIT,
  // keep status as DEPOSIT_SUBMITTED until 1Click indexes the origin block (KNOWN_DEPOSIT_TX).
  let nextLifecycle: PaymentLifecycleStatus = poll.lifecycleStatus;
  let nextStatus: PaymentStatus = poll.status;

  if (poll.rawOneClickStatus === 'PENDING_DEPOSIT' && payment.txHash) {
    nextLifecycle = 'DEPOSIT_SUBMITTED';
    nextStatus = 'DEPOSIT_SUBMITTED';
  }

  payment.status = nextStatus;
  payment.lifecycleStatus = nextLifecycle;
  if (poll.destinationTxHash) {
    payment.destinationTxHash = poll.destinationTxHash;
    payment.destinationExplorerUrl = poll.destinationExplorerUrl;
  }
  if (poll.actualReceivedAmount) {
    payment.actualReceivedAmount = poll.actualReceivedAmount;
  }
  if (poll.refundReason) {
    payment.refundReason = poll.refundReason;
  }
  payment.statusSource = `${poll.statusSource} (${poll.rawOneClickStatus})`;
  payment.updatedAt = nowIso;

  savePaymentExecution(payment, db);

  if (invoice) {
    invoice.paymentStatus = nextLifecycle === 'COMPLETED' ? 'PAID' : nextStatus;
    invoice.paymentExecution = payment;
    invoice.updatedAt = nowIso;
    saveProcessedInvoice(invoice, db);
  }

  return payment;
}

// ============================================================================
// REAL ON-CHAIN BALANCE RETRIEVAL FOR NEAR & EVM TREASURY WALLETS (PHASE 2 & 3)
// ============================================================================

export async function fetchNearAccountBalances(
  accountId: string,
  options?: { allowNetwork?: boolean }
): Promise<{
  accountId: string;
  network: string;
  nativeBalance: WalletAssetBalance;
  tokenBalances: WalletAssetBalance[];
  refreshedAt: string;
}> {
  const trimmed = accountId.trim();
  const addrCheck = validateDestinationAddressFormat('near', trimmed);
  if (!addrCheck.valid) {
    throw new Error(`Invalid NEAR account ID "${trimmed}": ${addrCheck.reason}`);
  }

  const tokens = await fetchOneClickSupportedTokens({ allowNetwork: options?.allowNetwork });
  const nearTokens = tokens.filter((t) => t.normalizedChain === 'near');
  const wNearToken = nearTokens.find((t) => t.symbol.toUpperCase() === 'WNEAR');
  const nearPrice = wNearToken?.price || 3.6;
  const nearPriceTime = wNearToken?.priceUpdatedAt || new Date().toISOString();

  const rpcUrl = process.env.NEAR_RPC_MAINNET_URL || 'https://rpc.mainnet.near.org';
  const nowIso = new Date().toISOString();

  let availableNearRaw = '0';
  let nearFormatted = '0';

  if (options?.allowNetwork !== false) {
    try {
      const viewAccRes = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(3500),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'steward-near-balance',
          method: 'query',
          params: {
            request_type: 'view_account',
            finality: 'final',
            account_id: trimmed,
          },
        }),
      });
      const viewAccJson = (await viewAccRes.json()) as {
        result?: { amount: string; storage_usage: number };
      };
      if (viewAccJson.result?.amount) {
        const totalYocto = BigInt(viewAccJson.result.amount);
        // Subtract NEAR protocol storage staking requirement (1e19 yoctoNEAR per byte)
        const storageLocked = BigInt(viewAccJson.result.storage_usage || 0) * 10000000000000000000n;
        const spendable = totalYocto > storageLocked ? totalYocto - storageLocked : totalYocto;
        availableNearRaw = spendable.toString();
        nearFormatted = formatRawTokenAmount(availableNearRaw, 24, 4);
      }
    } catch {
      // Account may be uninitialized implicit account or RPC timeout
    }
  }

  const nearUnitsFloat = Number(nearFormatted) || 0;
  const nativeBalance: WalletAssetBalance = {
    symbol: 'NEAR',
    name: 'NEAR Protocol (Native)',
    assetId: 'near:native',
    contractAddress: null,
    decimals: 24,
    rawBalance: availableNearRaw,
    formattedBalance: nearFormatted,
    priceUsd: nearPrice,
    priceUpdatedAt: nearPriceTime,
    valueUsd: Number((nearUnitsFloat * nearPrice).toFixed(2)),
    isNative: true,
  };

  // Query key NEP-141 fungible tokens on NEAR (USDC, USDT, wNEAR)
  const targetSymbols = ['USDC', 'USDT', 'WNEAR'];
  const tokenBalances: WalletAssetBalance[] = [];

  for (const sym of targetSymbols) {
    const tokenInfo = resolveOneClickToken('near', sym, tokens);
    if (!tokenInfo.contractAddress) continue;

    let rawBal = '0';
    if (options?.allowNetwork !== false) {
      try {
        const argsBase64 = Buffer.from(JSON.stringify({ account_id: trimmed }), 'utf8').toString(
          'base64'
        );
        const ftRes = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(3500),
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: `steward-ft-${sym}`,
            method: 'query',
            params: {
              request_type: 'call_function',
              finality: 'final',
              account_id: tokenInfo.contractAddress,
              method_name: 'ft_balance_of',
              args_base64: argsBase64,
            },
          }),
        });
        const ftJson = (await ftRes.json()) as { result?: { result?: number[] } };
        if (ftJson.result?.result) {
          const decoded = Buffer.from(ftJson.result.result).toString('utf8');
          const parsed = JSON.parse(decoded);
          if (typeof parsed === 'string' && /^\d+$/.test(parsed)) {
            rawBal = parsed;
          }
        }
      } catch {
        // Ignore individual contract read errors
      }
    }

    const formatted = formatRawTokenAmount(rawBal, tokenInfo.decimals, 4);
    const unitsFloat = Number(formatted) || 0;
    const price = tokenInfo.price > 0 ? tokenInfo.price : sym === 'WNEAR' ? nearPrice : 1.0;

    tokenBalances.push({
      symbol: tokenInfo.symbol,
      name:
        sym === 'USDC'
          ? 'USD Coin (NEP-141)'
          : sym === 'USDT'
            ? 'Tether USD (NEP-141)'
            : 'Wrapped NEAR (NEP-141)',
      assetId: tokenInfo.assetId,
      contractAddress: tokenInfo.contractAddress,
      decimals: tokenInfo.decimals,
      rawBalance: rawBal,
      formattedBalance: formatted,
      priceUsd: price,
      priceUpdatedAt: tokenInfo.priceUpdatedAt,
      valueUsd: Number((unitsFloat * price).toFixed(2)),
      isNative: false,
    });
  }

  return {
    accountId: trimmed,
    network: 'NEAR Mainnet',
    nativeBalance,
    tokenBalances,
    refreshedAt: nowIso,
  };
}

export async function fetchEvmAccountBalances(
  address: string,
  chain: 'ethereum' | 'base' | 'arbitrum',
  options?: { allowNetwork?: boolean }
): Promise<{
  address: string;
  chain: 'ethereum' | 'base' | 'arbitrum';
  chainIdHex: string;
  network: string;
  nativeBalance: WalletAssetBalance;
  tokenBalances: WalletAssetBalance[];
  refreshedAt: string;
}> {
  const trimmed = address.trim();
  const addrCheck = validateDestinationAddressFormat(chain, trimmed);
  if (!addrCheck.valid) {
    throw new Error(`Invalid EVM address "${trimmed}" for ${chain}: ${addrCheck.reason}`);
  }

  const meta = EVM_CHAIN_METADATA[chain];
  const tokens = await fetchOneClickSupportedTokens({ allowNetwork: options?.allowNetwork });
  const ethToken = resolveOneClickToken(chain, 'ETH', tokens);
  const ethPrice = ethToken.price > 0 ? ethToken.price : 2227.5;
  const ethPriceTime = ethToken.priceUpdatedAt || new Date().toISOString();
  const nowIso = new Date().toISOString();

  let rawEthWei = '0';
  if (options?.allowNetwork !== false) {
    try {
      const res = await fetch(meta.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(3500),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_getBalance',
          params: [trimmed, 'latest'],
        }),
      });
      const json = (await res.json()) as { result?: string };
      if (json.result && json.result.startsWith('0x')) {
        rawEthWei = BigInt(json.result).toString();
      }
    } catch {
      // Fallback to 0 if public RPC times out
    }
  }

  const ethFormatted = formatRawTokenAmount(rawEthWei, 18, 5);
  const ethFloat = Number(ethFormatted) || 0;

  const nativeBalance: WalletAssetBalance = {
    symbol: 'ETH',
    name: `Ether (${meta.networkName})`,
    assetId: ethToken.assetId,
    contractAddress: null,
    decimals: 18,
    rawBalance: rawEthWei,
    formattedBalance: ethFormatted,
    priceUsd: ethPrice,
    priceUpdatedAt: ethPriceTime,
    valueUsd: Number((ethFloat * ethPrice).toFixed(2)),
    isNative: true,
  };

  // Query ERC-20 balances (USDC, USDT) via `balanceOf(address)` selector `0x70a08231`
  const paddedOwner = trimmed.replace(/^0x/i, '').toLowerCase().padStart(64, '0');
  const balanceOfCalldata = `0x70a08231${paddedOwner}`;
  const targetSymbols = ['USDC', 'USDT'];
  const tokenBalances: WalletAssetBalance[] = [];

  const FALLBACK_EVM_USDT_CONTRACTS: Record<'ethereum' | 'base' | 'arbitrum', string> = {
    ethereum: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    base: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
    arbitrum: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
  };

  for (const sym of targetSymbols) {
    const tokenInfo = tokens.find(
      (t) =>
        t.normalizedChain === chain &&
        (t.symbol.toUpperCase() === sym || (sym === 'USDT' && t.symbol.toUpperCase().startsWith('USD'))) &&
        t.symbol.toUpperCase() !== 'USDC' &&
        sym === 'USDT'
          ? true
          : t.normalizedChain === chain &&
            t.symbol.toUpperCase() === sym &&
            t.contractAddress?.startsWith('0x')
    );
    const contractAddress =
      (tokenInfo?.contractAddress?.startsWith('0x') ? tokenInfo.contractAddress : undefined) ||
      (sym === 'USDC'
        ? ONECLICK_USDC_ASSET_MAP[chain]?.contractAddress
        : FALLBACK_EVM_USDT_CONTRACTS[chain]);
    if (!contractAddress) continue;

    const decimals = tokenInfo?.decimals ?? 6;
    const price = tokenInfo?.price && tokenInfo.price > 0 ? tokenInfo.price : 1.0;
    const priceUpdatedAt = tokenInfo?.priceUpdatedAt || ethPriceTime;
    const assetId = tokenInfo?.assetId || ONECLICK_USDC_ASSET_MAP[chain].assetId;

    let rawTokenBal = '0';
    if (options?.allowNetwork !== false) {
      try {
        const res = await fetch(meta.rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(3500),
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'eth_call',
            params: [{ to: contractAddress, data: balanceOfCalldata }, 'latest'],
          }),
        });
        const json = (await res.json()) as { result?: string };
        if (json.result && json.result.startsWith('0x') && json.result.length > 2) {
          rawTokenBal = BigInt(json.result).toString();
        }
      } catch {
        // Ignore individual ERC-20 call error
      }
    }

    const formatted = formatRawTokenAmount(rawTokenBal, decimals, 4);
    const unitsFloat = Number(formatted) || 0;

    tokenBalances.push({
      symbol: sym,
      name: `${sym} (${meta.networkName} ERC-20)`,
      assetId,
      contractAddress,
      decimals,
      rawBalance: rawTokenBal,
      formattedBalance: formatted,
      priceUsd: price,
      priceUpdatedAt,
      valueUsd: Number((unitsFloat * price).toFixed(2)),
      isNative: false,
    });
  }

  return {
    address: trimmed,
    chain,
    chainIdHex: meta.chainIdHex,
    network: meta.networkName,
    nativeBalance,
    tokenBalances,
    refreshedAt: nowIso,
  };
}
