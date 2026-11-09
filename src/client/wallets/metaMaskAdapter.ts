import type {
  ConnectedWalletRecord,
  PreparedWalletTransaction,
  SupportedChain,
} from '../../shared/types.js';
import type {
  TreasuryWalletAdapter,
  WalletBalanceSnapshot,
  WalletNetworkInfo,
  WalletTransactionSignResult,
  WalletTransactionStatusResult,
} from './types.js';

export interface Eip1193Provider {
  isMetaMask?: boolean;
  providers?: Eip1193Provider[];
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export const EVM_NETWORK_CONFIGS: Record<
  'ethereum' | 'base' | 'arbitrum',
  {
    chainIdHex: string;
    chainIdDecimal: number;
    chainName: string;
    rpcUrls: string[];
    blockExplorerUrls: string[];
    nativeCurrency: { name: string; symbol: string; decimals: number };
  }
> = {
  ethereum: {
    chainIdHex: '0x1',
    chainIdDecimal: 1,
    chainName: 'Ethereum Mainnet',
    rpcUrls: ['https://ethereum-rpc.publicnode.com'],
    blockExplorerUrls: ['https://etherscan.io'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  base: {
    chainIdHex: '0x2105',
    chainIdDecimal: 8453,
    chainName: 'Base Mainnet',
    rpcUrls: ['https://mainnet.base.org'],
    blockExplorerUrls: ['https://basescan.org'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  arbitrum: {
    chainIdHex: '0xa4b1',
    chainIdDecimal: 42161,
    chainName: 'Arbitrum One',
    rpcUrls: ['https://arb1.arbitrum.io/rpc'],
    blockExplorerUrls: ['https://arbiscan.io'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
};

export function mapChainIdToNetworkInfo(chainIdHexRaw: string): WalletNetworkInfo {
  const cleanHex = `0x${parseInt(chainIdHexRaw, 16).toString(16)}`.toLowerCase();
  const decimal = parseInt(cleanHex, 16);

  if (cleanHex === '0x1') {
    return {
      chain: 'ethereum',
      networkName: 'Ethereum Mainnet',
      chainIdHex: '0x1',
      chainIdDecimal: 1,
      isSupportedSourceNetwork: true,
    };
  }
  if (cleanHex === '0x2105') {
    return {
      chain: 'base',
      networkName: 'Base Mainnet',
      chainIdHex: '0x2105',
      chainIdDecimal: 8453,
      isSupportedSourceNetwork: true,
    };
  }
  if (cleanHex === '0xa4b1') {
    return {
      chain: 'arbitrum',
      networkName: 'Arbitrum One',
      chainIdHex: '0xa4b1',
      chainIdDecimal: 42161,
      isSupportedSourceNetwork: true,
    };
  }

  return {
    chain: 'ethereum',
    networkName: `Unsupported EVM Chain (Chain ID ${decimal || chainIdHexRaw})`,
    chainIdHex: cleanHex,
    chainIdDecimal: Number.isFinite(decimal) ? decimal : null,
    isSupportedSourceNetwork: false,
  };
}

export class MetaMaskWalletAdapter implements TreasuryWalletAdapter {
  public readonly walletType = 'metamask' as const;
  private currentAddress: string | null = null;
  private currentChainIdHex: string | null = null;
  private listenersBound = false;
  private accountSubscribers = new Set<(accounts: string[]) => void>();
  private networkSubscribers = new Set<(network: WalletNetworkInfo) => void>();

  public getProvider(): Eip1193Provider | null {
    if (typeof window === 'undefined' || !window.ethereum) {
      return null;
    }
    if (Array.isArray(window.ethereum.providers) && window.ethereum.providers.length > 0) {
      const mm = window.ethereum.providers.find((p) => p.isMetaMask);
      if (mm) return mm;
    }
    return window.ethereum;
  }

  public isMetaMaskDetected(): boolean {
    const provider = this.getProvider();
    return Boolean(provider);
  }

  private ensureProviderEventsBound(provider: Eip1193Provider) {
    if (this.listenersBound || !provider.on) return;
    this.listenersBound = true;

    provider.on('accountsChanged', (accountsUnknown: unknown) => {
      const accounts = Array.isArray(accountsUnknown)
        ? accountsUnknown.map((a) => String(a))
        : [];
      this.currentAddress = accounts[0] || null;
      for (const cb of this.accountSubscribers) {
        try {
          cb(accounts);
        } catch {
          // Ignore subscriber error
        }
      }
    });

    provider.on('chainChanged', (chainIdUnknown: unknown) => {
      const chainIdHex = String(chainIdUnknown || '0x1');
      this.currentChainIdHex = chainIdHex;
      const netInfo = mapChainIdToNetworkInfo(chainIdHex);
      for (const cb of this.networkSubscribers) {
        try {
          cb(netInfo);
        } catch {
          // Ignore subscriber error
        }
      }
    });

    provider.on('disconnect', () => {
      this.currentAddress = null;
      for (const cb of this.accountSubscribers) {
        try {
          cb([]);
        } catch {
          // Ignore
        }
      }
    });
  }

  public async connect(options?: {
    preferredChain?: SupportedChain;
  }): Promise<ConnectedWalletRecord> {
    const provider = this.getProvider();
    if (!provider) {
      throw new Error(
        'MetaMask (or an EIP-1193 EVM browser wallet) was not detected in this browser. Install the MetaMask extension or use the Read-Only / Simulated Wallet tools below.'
      );
    }

    this.ensureProviderEventsBound(provider);

    let accounts: string[] = [];
    try {
      const res = await provider.request({ method: 'eth_requestAccounts' });
      accounts = Array.isArray(res) ? res.map((a) => String(a)) : [];
    } catch (err) {
      const code = (err as { code?: number })?.code;
      if (code === 4001) {
        throw new Error('MetaMask connection request was rejected by the user.');
      }
      throw new Error(`MetaMask connection error: ${(err as Error).message}`);
    }

    if (accounts.length === 0 || !accounts[0]) {
      throw new Error('MetaMask returned no active accounts. Please unlock MetaMask.');
    }

    const address = accounts[0];
    this.currentAddress = address;

    // Switch network if user requested a specific supported EVM chain
    if (
      options?.preferredChain &&
      ['ethereum', 'base', 'arbitrum'].includes(options.preferredChain)
    ) {
      try {
        await this.switchNetwork(options.preferredChain as 'ethereum' | 'base' | 'arbitrum');
      } catch {
        // Non-fatal if user declines chain switch during initial connection
      }
    }

    const netInfo = await this.getNetwork();
    const effectiveChain = netInfo.isSupportedSourceNetwork ? netInfo.chain : 'ethereum';
    const balanceSnap = await this.getBalance(address, effectiveChain);
    const nowIso = new Date().toISOString();

    const record: ConnectedWalletRecord = {
      id: `WLT-METAMASK-${address.toLowerCase()}`,
      walletType: 'metamask',
      walletId: provider.isMetaMask ? 'metamask' : 'eip1193-evm',
      walletName: provider.isMetaMask ? 'MetaMask' : 'EVM Browser Wallet',
      address,
      network: netInfo.networkName,
      chain: effectiveChain,
      chainIdHex: netInfo.chainIdHex || '0x1',
      isSimulated: false,
      status: 'connected',
      nativeBalance: balanceSnap.nativeBalance,
      tokenBalances: balanceSnap.tokenBalances,
      capabilities: {
        eth_requestAccounts: true,
        eth_sendTransaction: true,
        wallet_switchEthereumChain: true,
        erc20_transfer: true,
      },
      unsupportedCapabilities: netInfo.isSupportedSourceNetwork
        ? []
        : [
            `Connected chain (${netInfo.networkName}) is not in STEWARD's supported EVM source networks (Ethereum, Base, Arbitrum). Switch network to sign deposits.`,
          ],
      lastRefreshedAt: balanceSnap.refreshedAt,
      connectedAt: nowIso,
    };

    await fetch('/api/treasury/wallets/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    }).catch(() => {});

    return record;
  }

  public async switchNetwork(targetChain: 'ethereum' | 'base' | 'arbitrum'): Promise<WalletNetworkInfo> {
    const provider = this.getProvider();
    if (!provider) {
      throw new Error('MetaMask provider is not available.');
    }

    const cfg = EVM_NETWORK_CONFIGS[targetChain];
    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: cfg.chainIdHex }],
      });
    } catch (err) {
      const code = (err as { code?: number })?.code;
      // Error code 4902 indicates the chain has not been added to MetaMask yet
      if (code === 4902) {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: cfg.chainIdHex,
              chainName: cfg.chainName,
              rpcUrls: cfg.rpcUrls,
              blockExplorerUrls: cfg.blockExplorerUrls,
              nativeCurrency: cfg.nativeCurrency,
            },
          ],
        });
      } else {
        throw new Error(
          `Failed to switch MetaMask network to ${cfg.chainName}: ${(err as Error).message}`
        );
      }
    }

    this.currentChainIdHex = cfg.chainIdHex;
    return mapChainIdToNetworkInfo(cfg.chainIdHex);
  }

  public async disconnect(): Promise<void> {
    const prevAddress = this.currentAddress;
    const provider = this.getProvider();
    if (provider) {
      try {
        await provider.request({
          method: 'wallet_revokePermissions',
          params: [{ eth_accounts: {} }],
        });
      } catch {
        // Older MetaMask versions or non-MetaMask EIP-1193 wallets may not support wallet_revokePermissions
      }
    }
    this.currentAddress = null;
    if (prevAddress) {
      await fetch(`/api/treasury/wallets/${encodeURIComponent(prevAddress)}`, {
        method: 'DELETE',
      }).catch(() => {});
    }
    for (const cb of this.accountSubscribers) {
      try {
        cb([]);
      } catch {
        // Ignore
      }
    }
  }

  public async getAccount(): Promise<string | null> {
    if (this.currentAddress) return this.currentAddress;
    const provider = this.getProvider();
    if (!provider) return null;
    try {
      const res = await provider.request({ method: 'eth_accounts' });
      const accounts = Array.isArray(res) ? res.map((a) => String(a)) : [];
      if (accounts.length > 0 && accounts[0]) {
        this.currentAddress = accounts[0];
        this.ensureProviderEventsBound(provider);
        return this.currentAddress;
      }
    } catch {
      // Ignore
    }
    return null;
  }

  public async getNetwork(): Promise<WalletNetworkInfo> {
    const provider = this.getProvider();
    if (!provider) {
      return {
        chain: 'ethereum',
        networkName: 'Disconnected',
        chainIdHex: null,
        chainIdDecimal: null,
        isSupportedSourceNetwork: false,
      };
    }
    try {
      const chainIdHex = String(await provider.request({ method: 'eth_chainId' }));
      this.currentChainIdHex = chainIdHex;
      return mapChainIdToNetworkInfo(chainIdHex);
    } catch {
      return mapChainIdToNetworkInfo(this.currentChainIdHex || '0x1');
    }
  }

  public async getBalance(
    addressOverride?: string,
    chainOverride?: SupportedChain
  ): Promise<WalletBalanceSnapshot> {
    const address = addressOverride || (await this.getAccount());
    if (!address) {
      throw new Error('No EVM wallet address connected to query balances.');
    }

    let chain: 'ethereum' | 'base' | 'arbitrum' = 'base';
    if (chainOverride && ['ethereum', 'base', 'arbitrum'].includes(chainOverride)) {
      chain = chainOverride as 'ethereum' | 'base' | 'arbitrum';
    } else {
      const net = await this.getNetwork();
      if (['ethereum', 'base', 'arbitrum'].includes(net.chain)) {
        chain = net.chain as 'ethereum' | 'base' | 'arbitrum';
      }
    }

    const res = await fetch('/api/treasury/balances/evm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, chain }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Failed to query EVM balances for ${address}`);
    }

    const nativeUsd = Number(data.nativeBalance?.valueUsd || 0);
    const tokensUsd = (data.tokenBalances || []).reduce(
      (sum: number, t: { valueUsd?: number | null }) => sum + Number(t.valueUsd || 0),
      0
    );

    return {
      address,
      chain,
      networkName: data.network || EVM_NETWORK_CONFIGS[chain].chainName,
      nativeBalance: data.nativeBalance,
      tokenBalances: data.tokenBalances || [],
      totalKnownUsdValue: Number((nativeUsd + tokensUsd).toFixed(2)),
      priceSource: 'NEAR Intents 1Click Live Token Feed',
      refreshedAt: data.refreshedAt || new Date().toISOString(),
    };
  }

  public async signAndSendTransaction(
    tx: PreparedWalletTransaction
  ): Promise<WalletTransactionSignResult> {
    if (tx.walletType !== 'metamask' || !tx.evmTransaction) {
      throw new Error('Invalid EVM transaction payload passed to MetaMaskWalletAdapter.');
    }

    const provider = this.getProvider();
    if (!provider) {
      throw new Error('MetaMask provider is not available in this browser.');
    }

    const activeAccount = await this.getAccount();
    if (!activeAccount) {
      throw new Error('MetaMask is not connected. Please connect MetaMask first.');
    }

    if (activeAccount.toLowerCase() !== tx.evmTransaction.from.toLowerCase()) {
      throw new Error(
        `Connected MetaMask account (${activeAccount}) does not match the prepared funding wallet (${tx.evmTransaction.from}).`
      );
    }

    // Verify connected chain matches the quote's origin chain
    const currentNet = await this.getNetwork();
    if (
      !currentNet.chainIdHex ||
      currentNet.chainIdHex.toLowerCase() !== tx.evmTransaction.chainId.toLowerCase()
    ) {
      if (['ethereum', 'base', 'arbitrum'].includes(tx.sourceChain)) {
        await this.switchNetwork(tx.sourceChain as 'ethereum' | 'base' | 'arbitrum');
      } else {
        throw new Error(
          `MetaMask is connected to ${currentNet.networkName}, but the payment quote requires ${tx.networkName} (${tx.evmTransaction.chainId}).`
        );
      }
    }

    const txParams: Record<string, string> = {
      from: activeAccount,
      to: tx.evmTransaction.to,
      value: tx.evmTransaction.value,
      data: tx.evmTransaction.data,
    };

    // Estimate gas if possible to catch insufficient balance / revert before opening popup
    try {
      const gasHex = await provider.request({
        method: 'eth_estimateGas',
        params: [txParams],
      });
      if (typeof gasHex === 'string' && gasHex.startsWith('0x')) {
        txParams.gas = gasHex;
      }
    } catch {
      // Allow MetaMask's internal gas estimator to display details if RPC estimate fails
    }

    try {
      const txHashRaw = await provider.request({
        method: 'eth_sendTransaction',
        params: [txParams],
      });
      const txHash = String(txHashRaw || '');
      if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
        throw new Error('MetaMask did not return a valid 32-byte transaction hash.');
      }

      const cfg =
        EVM_NETWORK_CONFIGS[tx.sourceChain as 'ethereum' | 'base' | 'arbitrum'] ||
        EVM_NETWORK_CONFIGS.base;

      return {
        txHash,
        explorerUrl: `${cfg.blockExplorerUrls[0]}/tx/${txHash}`,
        signerAddress: activeAccount,
        chain: tx.sourceChain,
        isSimulated: false,
      };
    } catch (err) {
      const code = (err as { code?: number })?.code;
      if (code === 4001) {
        throw new Error('Transaction signature was rejected by the user in MetaMask.');
      }
      throw new Error(`MetaMask transaction failed: ${(err as Error).message}`);
    }
  }

  public async getTransactionStatus(
    txHash: string,
    chainOverride?: string
  ): Promise<WalletTransactionStatusResult> {
    const provider = this.getProvider();
    const chain = (chainOverride || 'base') as SupportedChain;
    if (provider) {
      try {
        const receipt = (await provider.request({
          method: 'eth_getTransactionReceipt',
          params: [txHash],
        })) as { status?: string; blockNumber?: string } | null;

        if (receipt) {
          const confirmed = receipt.status === '0x1';
          return {
            txHash,
            chain,
            status: confirmed ? 'CONFIRMED' : 'FAILED',
            blockNumberOrHeight: receipt.blockNumber
              ? parseInt(receipt.blockNumber, 16)
              : null,
            errorMessage: confirmed ? null : 'EVM transaction reverted on-chain (status 0x0).',
            checkedAt: new Date().toISOString(),
          };
        }
      } catch {
        // Fall through to PENDING
      }
    }
    return {
      txHash,
      chain,
      status: 'PENDING',
      checkedAt: new Date().toISOString(),
    };
  }

  public subscribeToAccountChanges(callback: (accounts: string[]) => void): () => void {
    const provider = this.getProvider();
    if (provider) this.ensureProviderEventsBound(provider);
    this.accountSubscribers.add(callback);
    return () => {
      this.accountSubscribers.delete(callback);
    };
  }

  public subscribeToNetworkChanges(
    callback: (network: WalletNetworkInfo) => void
  ): () => void {
    const provider = this.getProvider();
    if (provider) this.ensureProviderEventsBound(provider);
    this.networkSubscribers.add(callback);
    return () => {
      this.networkSubscribers.delete(callback);
    };
  }
}

export const metaMaskAdapter = new MetaMaskWalletAdapter();
