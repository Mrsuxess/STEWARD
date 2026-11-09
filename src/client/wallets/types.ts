import type {
  ConnectedWalletRecord,
  PreparedWalletTransaction,
  SupportedChain,
  TreasuryWalletType,
  WalletAssetBalance,
} from '../../shared/types.js';

export interface WalletNetworkInfo {
  chain: SupportedChain;
  networkName: string;
  chainIdHex?: string | null;
  chainIdDecimal?: number | null;
  isSupportedSourceNetwork: boolean;
}

export interface WalletBalanceSnapshot {
  address: string;
  chain: SupportedChain;
  networkName: string;
  nativeBalance: WalletAssetBalance;
  tokenBalances: WalletAssetBalance[];
  totalKnownUsdValue: number;
  priceSource: string;
  refreshedAt: string;
}

export interface WalletTransactionSignResult {
  txHash: string;
  explorerUrl: string | null;
  signerAddress: string;
  chain: SupportedChain;
  isSimulated: boolean;
  rawOutcome?: unknown;
}

export interface WalletTransactionStatusResult {
  txHash: string;
  chain: SupportedChain;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED';
  blockNumberOrHeight?: number | string | null;
  errorMessage?: string | null;
  checkedAt: string;
}

export interface DiscoveredNearWallet {
  id: string;
  name: string;
  icon: string;
  description: string;
  website: string;
  type: 'sandbox' | 'injected';
  capabilities: Record<string, boolean>;
  unsupportedCapabilities: string[];
}

/**
 * Phase 2 — Unified Treasury Wallet Adapter Interface
 * Enforces strict non-custodial separation between wallet connection,
 * balance inspection, transaction signing, and on-chain status verification.
 */
export interface TreasuryWalletAdapter {
  readonly walletType: TreasuryWalletType;

  connect(options?: {
    walletId?: string;
    preferredChain?: SupportedChain;
  }): Promise<ConnectedWalletRecord>;

  disconnect(): Promise<void>;

  getAccount(): Promise<string | null>;

  getNetwork(): Promise<WalletNetworkInfo>;

  getBalance(addressOverride?: string): Promise<WalletBalanceSnapshot>;

  signAndSendTransaction(
    tx: PreparedWalletTransaction
  ): Promise<WalletTransactionSignResult>;

  getTransactionStatus(
    txHash: string,
    signerOrChain?: string
  ): Promise<WalletTransactionStatusResult>;

  subscribeToAccountChanges(callback: (accounts: string[]) => void): () => void;

  subscribeToNetworkChanges(
    callback: (network: WalletNetworkInfo) => void
  ): () => void;
}
