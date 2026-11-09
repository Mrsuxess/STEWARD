import { NearConnector } from '@hot-labs/near-connect';
import type {
  ConnectedWalletRecord,
  PreparedWalletTransaction,
} from '../../shared/types.js';
import type {
  DiscoveredNearWallet,
  TreasuryWalletAdapter,
  WalletBalanceSnapshot,
  WalletNetworkInfo,
  WalletTransactionSignResult,
  WalletTransactionStatusResult,
} from './types.js';

export class NearConnectWalletAdapter implements TreasuryWalletAdapter {
  public readonly walletType = 'near' as const;
  private connector: NearConnector | null = null;
  private currentAccountId: string | null = null;
  private currentWalletId: string | null = null;
  private currentWalletName: string = 'NEAR Wallet';
  private accountSubscribers = new Set<(accounts: string[]) => void>();
  private networkSubscribers = new Set<(network: WalletNetworkInfo) => void>();

  private ensureConnector(): NearConnector {
    if (!this.connector) {
      this.connector = new NearConnector({
        network: 'mainnet',
        autoConnect: true,
        footerBranding: null,
      });

      this.connector.on('wallet:signIn', (payload) => {
        const accounts = (payload.accounts || []).map((a) => a.accountId).filter(Boolean);
        if (accounts.length > 0) {
          this.currentAccountId = accounts[0];
          this.currentWalletId = payload.wallet?.manifest?.id || 'near-wallet';
          this.currentWalletName = payload.wallet?.manifest?.name || 'NEAR Wallet';
          this.notifyAccountSubscribers(accounts);
        }
      });

      this.connector.on('wallet:signOut', () => {
        this.currentAccountId = null;
        this.currentWalletId = null;
        this.notifyAccountSubscribers([]);
      });
    }
    return this.connector;
  }

  private notifyAccountSubscribers(accounts: string[]) {
    for (const cb of this.accountSubscribers) {
      try {
        cb(accounts);
      } catch {
        // Ignore subscriber error
      }
    }
  }

  /**
   * Discovers available NEAR wallets from the @hot-labs/near-connect manifest
   * and inspects each wallet's supported and unsupported capabilities.
   */
  public async discoverWallets(): Promise<DiscoveredNearWallet[]> {
    const connector = this.ensureConnector();
    try {
      await connector.whenManifestLoaded;
    } catch {
      // Manifest load fallback if offline
    }

    const rawWallets = connector.availableWallets || [];
    return rawWallets.map((w) => {
      const m = w.manifest;
      const f = m.features || ({} as Record<string, boolean>);
      const capabilities: Record<string, boolean> = {
        signAndSendTransaction: Boolean(f.signAndSendTransaction),
        signAndSendTransactions: Boolean(f.signAndSendTransactions),
        signMessage: Boolean(f.signMessage),
        signInWithoutAddKey: Boolean(f.signInWithoutAddKey),
        signDelegateActions: Boolean(f.signDelegateActions),
        mainnet: f.mainnet !== false,
        testnet: Boolean(f.testnet),
      };

      const unsupportedCapabilities: string[] = [];
      if (!capabilities.signAndSendTransaction) {
        unsupportedCapabilities.push(
          'Does not support single-transaction signing (signAndSendTransaction)'
        );
      }
      if (!capabilities.signAndSendTransactions) {
        unsupportedCapabilities.push(
          'Does not support multi-transaction batching (signAndSendTransactions)'
        );
      }
      if (!capabilities.signMessage) {
        unsupportedCapabilities.push('Does not support NEP-413 off-chain message signing');
      }
      if (!capabilities.signDelegateActions) {
        unsupportedCapabilities.push('Does not support NEP-366 meta-transaction delegate actions');
      }
      if (!capabilities.testnet) {
        unsupportedCapabilities.push('Mainnet-only wallet (Testnet switching unsupported)');
      }

      return {
        id: m.id,
        name: m.name,
        icon: m.icon,
        description: m.description,
        website: m.website,
        type: m.type,
        capabilities,
        unsupportedCapabilities,
      };
    });
  }

  /**
   * Checks if a wallet session was previously connected in IndexedDB/storage.
   */
  public async restoreSessionIfConnected(): Promise<ConnectedWalletRecord | null> {
    try {
      const connector = this.ensureConnector();
      await connector.whenManifestLoaded;
      const { wallet, accounts } = await connector.getConnectedWallet();
      if (!wallet || !accounts || accounts.length === 0) {
        return null;
      }
      const accountId = accounts[0].accountId;
      this.currentAccountId = accountId;
      this.currentWalletId = wallet.manifest.id;
      this.currentWalletName = wallet.manifest.name;

      const balanceSnap = await this.getBalance(accountId);
      const discovered = await this.discoverWallets();
      const matchedManifest = discovered.find((d) => d.id === wallet.manifest.id);

      const nowIso = new Date().toISOString();
      return {
        id: `WLT-NEAR-${accountId}`,
        walletType: 'near',
        walletId: wallet.manifest.id,
        walletName: wallet.manifest.name,
        address: accountId,
        network: 'NEAR Mainnet',
        chain: 'near',
        chainIdHex: null,
        isSimulated: false,
        status: 'connected',
        nativeBalance: balanceSnap.nativeBalance,
        tokenBalances: balanceSnap.tokenBalances,
        capabilities: matchedManifest?.capabilities || {
          signAndSendTransaction: Boolean(wallet.manifest.features?.signAndSendTransaction),
          mainnet: true,
        },
        unsupportedCapabilities: matchedManifest?.unsupportedCapabilities || [],
        lastRefreshedAt: balanceSnap.refreshedAt,
        connectedAt: nowIso,
      };
    } catch {
      return null;
    }
  }

  public async connect(options?: { walletId?: string }): Promise<ConnectedWalletRecord> {
    const connector = this.ensureConnector();
    await connector.whenManifestLoaded;

    const wallet = await connector.connect(
      options?.walletId ? { walletId: options.walletId } : undefined
    );
    const accounts = await wallet.getAccounts();
    if (!accounts || accounts.length === 0 || !accounts[0].accountId) {
      throw new Error(
        `No NEAR account returned from ${wallet.manifest?.name || 'selected wallet'}. Please unlock your wallet and approve the connection.`
      );
    }

    const accountId = accounts[0].accountId;
    this.currentAccountId = accountId;
    this.currentWalletId = wallet.manifest.id;
    this.currentWalletName = wallet.manifest.name;

    const discovered = await this.discoverWallets();
    const matchedManifest = discovered.find((d) => d.id === wallet.manifest.id);

    if (matchedManifest && !matchedManifest.capabilities.signAndSendTransaction) {
      throw new Error(
        `${wallet.manifest.name} does not support signAndSendTransaction required for treasury deposits.`
      );
    }

    const balanceSnap = await this.getBalance(accountId);
    const nowIso = new Date().toISOString();

    const record: ConnectedWalletRecord = {
      id: `WLT-NEAR-${accountId}`,
      walletType: 'near',
      walletId: wallet.manifest.id,
      walletName: wallet.manifest.name,
      address: accountId,
      network: 'NEAR Mainnet',
      chain: 'near',
      chainIdHex: null,
      isSimulated: false,
      status: 'connected',
      nativeBalance: balanceSnap.nativeBalance,
      tokenBalances: balanceSnap.tokenBalances,
      capabilities: matchedManifest?.capabilities || {
        signAndSendTransaction: true,
        mainnet: true,
      },
      unsupportedCapabilities: matchedManifest?.unsupportedCapabilities || [],
      lastRefreshedAt: balanceSnap.refreshedAt,
      connectedAt: nowIso,
    };

    // Sync public wallet metadata & balances with backend treasury state
    await fetch('/api/treasury/wallets/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    }).catch(() => {});

    this.notifyAccountSubscribers(accounts.map((a) => a.accountId));
    return record;
  }

  public async disconnect(): Promise<void> {
    const prevAccount = this.currentAccountId;
    const connector = this.ensureConnector();
    try {
      await connector.disconnect();
    } catch {
      // Ignore if already signed out
    }
    this.currentAccountId = null;
    this.currentWalletId = null;
    if (prevAccount) {
      await fetch(`/api/treasury/wallets/${encodeURIComponent(prevAccount)}`, {
        method: 'DELETE',
      }).catch(() => {});
    }
    this.notifyAccountSubscribers([]);
  }

  public async getAccount(): Promise<string | null> {
    if (this.currentAccountId) return this.currentAccountId;
    try {
      const connector = this.ensureConnector();
      await connector.whenManifestLoaded;
      const { accounts } = await connector.getConnectedWallet();
      if (accounts && accounts.length > 0) {
        this.currentAccountId = accounts[0].accountId;
        return this.currentAccountId;
      }
    } catch {
      // Not connected
    }
    return null;
  }

  public async getNetwork(): Promise<WalletNetworkInfo> {
    const connector = this.ensureConnector();
    const net = connector.network || 'mainnet';
    return {
      chain: 'near',
      networkName: net === 'mainnet' ? 'NEAR Mainnet' : 'NEAR Testnet',
      chainIdHex: null,
      chainIdDecimal: null,
      isSupportedSourceNetwork: net === 'mainnet',
    };
  }

  public async getBalance(addressOverride?: string): Promise<WalletBalanceSnapshot> {
    const accountId = addressOverride || (await this.getAccount());
    if (!accountId) {
      throw new Error('No NEAR account connected to query balances.');
    }

    const res = await fetch('/api/treasury/balances/near', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Failed to query NEAR balances for ${accountId}`);
    }

    const nativeUsd = Number(data.nativeBalance?.valueUsd || 0);
    const tokensUsd = (data.tokenBalances || []).reduce(
      (sum: number, t: { valueUsd?: number | null }) => sum + Number(t.valueUsd || 0),
      0
    );

    return {
      address: accountId,
      chain: 'near',
      networkName: 'NEAR Mainnet',
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
    if (tx.walletType !== 'near' || !tx.nearTransactions || tx.nearTransactions.length === 0) {
      throw new Error('Invalid NEAR transaction payload passed to NearConnectWalletAdapter.');
    }

    const connector = this.ensureConnector();
    await connector.whenManifestLoaded;
    const wallet = await connector.wallet();
    if (!wallet) {
      throw new Error('NEAR Wallet is not connected. Please connect your NEAR wallet first.');
    }

    if (!wallet.manifest.features?.signAndSendTransaction) {
      throw new Error(
        `Connected wallet (${wallet.manifest.name}) does not support signAndSendTransaction.`
      );
    }

    const accounts = await wallet.getAccounts();
    const activeAccount = accounts?.[0]?.accountId || this.currentAccountId;
    if (!activeAccount) {
      throw new Error('No active NEAR account found in connected wallet.');
    }

    if (activeAccount.toLowerCase() !== tx.fromAddress.toLowerCase()) {
      throw new Error(
        `Connected NEAR account (${activeAccount}) does not match the prepared funding wallet (${tx.fromAddress}).`
      );
    }

    const firstTx = tx.nearTransactions[0];
    try {
      const outcome = await wallet.signAndSendTransaction({
        signerId: activeAccount,
        receiverId: firstTx.receiverId,
        actions: firstTx.actions as unknown as Parameters<
          typeof wallet.signAndSendTransaction
        >[0]['actions'],
      });

      const outcomeObj = outcome as unknown as {
        transaction?: { hash?: string };
        transaction_outcome?: { id?: string };
        status?: { Failure?: unknown };
      };

      if (outcomeObj?.status?.Failure) {
        throw new Error(
          `NEAR transaction execution failed on-chain: ${JSON.stringify(outcomeObj.status.Failure)}`
        );
      }

      const txHash =
        outcomeObj?.transaction?.hash || outcomeObj?.transaction_outcome?.id || '';
      if (!txHash) {
        throw new Error('Wallet did not return a valid NEAR transaction hash.');
      }

      return {
        txHash,
        explorerUrl: `https://nearblocks.io/txns/${txHash}`,
        signerAddress: activeAccount,
        chain: 'near',
        isSimulated: false,
        rawOutcome: outcome,
      };
    } catch (err) {
      const msg = (err as Error).message || String(err);
      if (/reject|cancel|denied|closed|user/i.test(msg)) {
        throw new Error(`Transaction signature rejected by user in ${this.currentWalletName}.`);
      }
      throw err;
    }
  }

  public async getTransactionStatus(
    txHash: string,
    signerAccountId?: string
  ): Promise<WalletTransactionStatusResult> {
    const sender = signerAccountId || this.currentAccountId || 'system.near';
    try {
      const res = await fetch('https://rpc.mainnet.near.org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'steward-near-tx-status',
          method: 'tx',
          params: [txHash, sender],
        }),
      });
      const json = (await res.json()) as {
        result?: {
          status?: { SuccessValue?: string; Failure?: unknown };
          transaction_outcome?: { block_hash?: string };
        };
      };
      if (json.result?.status) {
        if (json.result.status.Failure) {
          return {
            txHash,
            chain: 'near',
            status: 'FAILED',
            errorMessage: JSON.stringify(json.result.status.Failure),
            checkedAt: new Date().toISOString(),
          };
        }
        if (json.result.status.SuccessValue !== undefined) {
          return {
            txHash,
            chain: 'near',
            status: 'CONFIRMED',
            blockNumberOrHeight: json.result.transaction_outcome?.block_hash || null,
            checkedAt: new Date().toISOString(),
          };
        }
      }
    } catch {
      // Fall through to PENDING
    }
    return {
      txHash,
      chain: 'near',
      status: 'PENDING',
      checkedAt: new Date().toISOString(),
    };
  }

  public subscribeToAccountChanges(callback: (accounts: string[]) => void): () => void {
    this.ensureConnector();
    this.accountSubscribers.add(callback);
    return () => {
      this.accountSubscribers.delete(callback);
    };
  }

  public subscribeToNetworkChanges(
    callback: (network: WalletNetworkInfo) => void
  ): () => void {
    this.ensureConnector();
    this.networkSubscribers.add(callback);
    return () => {
      this.networkSubscribers.delete(callback);
    };
  }
}

export const nearWalletAdapter = new NearConnectWalletAdapter();
