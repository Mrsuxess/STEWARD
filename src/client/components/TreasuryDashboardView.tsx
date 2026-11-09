import React, { useState, useEffect, useCallback } from 'react';
import {
  Wallet,
  RefreshCw,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Unplug,
  SlidersHorizontal,
  ArrowUpRight,
  Coins,
  Layers,
  Clock,
  Lock,
  Search,
  Sparkles,
} from 'lucide-react';
import type {
  ConnectedWalletRecord,
  OneClickTokenInfo,
  PaymentExecutionRecord,
  ProcessedInvoiceRecord,
  SupportedChain,
  TreasurySettings,
  WalletAssetBalance,
} from '../../shared/types.js';
import type { DiscoveredNearWallet } from '../wallets/types.js';
import { nearWalletAdapter } from '../wallets/nearWalletAdapter.js';
import { metaMaskAdapter } from '../wallets/metaMaskAdapter.js';
import { ChainBadge, PaymentStatusBadge } from './StewardLogo.js';

interface TreasuryDashboardViewProps {
  invoices: ProcessedInvoiceRecord[];
  payments: PaymentExecutionRecord[];
  onAuthorizeInvoicePayment: (invoice: ProcessedInvoiceRecord) => void;
  onRefreshGlobalData: () => Promise<void>;
}

const ALL_SOURCE_CHAINS: SupportedChain[] = ['near', 'base', 'arbitrum', 'ethereum'];
const ALL_DEST_CHAINS: SupportedChain[] = [
  'near',
  'arbitrum',
  'base',
  'ethereum',
  'solana',
  'bitcoin',
];

export const TreasuryDashboardView: React.FC<TreasuryDashboardViewProps> = ({
  invoices,
  payments,
  onAuthorizeInvoicePayment,
  onRefreshGlobalData,
}) => {
  const [wallets, setWallets] = useState<ConnectedWalletRecord[]>([]);
  const [settings, setSettings] = useState<TreasurySettings | null>(null);
  const [supportedTokens, setSupportedTokens] = useState<OneClickTokenInfo[]>([]);
  const [discoveredNearWallets, setDiscoveredNearWallets] = useState<DiscoveredNearWallet[]>([]);
  const [selectedNearWalletId, setSelectedNearWalletId] = useState<string>('');
  const [preferredEvmConnectChain, setPreferredEvmConnectChain] = useState<
    'base' | 'arbitrum' | 'ethereum'
  >('base');

  const [loadingTreasury, setLoadingTreasury] = useState(false);
  const [connectingNear, setConnectingNear] = useState(false);
  const [connectingMetaMask, setConnectingMetaMask] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [walletFeedback, setWalletFeedback] = useState<string | null>(null);
  const [lastBalanceRefresh, setLastBalanceRefresh] = useState<string>(new Date().toISOString());

  // Public On-Chain Balance Inspector (works even without browser wallet popup)
  const [inspectNearInput, setInspectNearInput] = useState('wrap.near');
  const [inspectEvmInput, setInspectEvmInput] = useState(
    '0x742d35Cc6634C0532925a3b844Bc454e4438f44e'
  );
  const [inspectEvmChain, setInspectEvmChain] = useState<'base' | 'arbitrum' | 'ethereum'>('arbitrum');
  const [inspectedBalances, setInspectedBalances] = useState<{
    label: string;
    network: string;
    nativeBalance: WalletAssetBalance;
    tokenBalances: WalletAssetBalance[];
    refreshedAt: string;
  } | null>(null);
  const [inspectingOnChain, setInspectingOnChain] = useState(false);

  const fetchTreasuryState = useCallback(async () => {
    setLoadingTreasury(true);
    try {
      const res = await fetch('/api/treasury/overview');
      if (res.ok) {
        const data = await res.json();
        setWallets(data.wallets || []);
        setSettings(data.settings || null);
        setSupportedTokens(data.supportedTokens || []);
        setLastBalanceRefresh(new Date().toISOString());
      }
    } catch {
      // Ignore network error
    } finally {
      setLoadingTreasury(false);
    }
  }, []);

  useEffect(() => {
    void fetchTreasuryState();
    void nearWalletAdapter.discoverWallets().then((list) => {
      setDiscoveredNearWallets(list);
    });
    void nearWalletAdapter.restoreSessionIfConnected().then((restored) => {
      if (restored) {
        void fetchTreasuryState();
      }
    });
  }, [fetchTreasuryState]);

  // Subscribe to account & network changes from both adapters
  useEffect(() => {
    const unsubNearAcc = nearWalletAdapter.subscribeToAccountChanges(() => {
      void fetchTreasuryState();
    });
    const unsubMmAcc = metaMaskAdapter.subscribeToAccountChanges((accounts) => {
      if (accounts.length > 0) {
        void metaMaskAdapter.connect().then(() => fetchTreasuryState()).catch(() => {});
      } else {
        void fetchTreasuryState();
      }
    });
    const unsubMmNet = metaMaskAdapter.subscribeToNetworkChanges((net) => {
      setWalletFeedback(`MetaMask network switched to ${net.networkName}`);
      void fetchTreasuryState();
    });

    return () => {
      unsubNearAcc();
      unsubMmAcc();
      unsubMmNet();
    };
  }, [fetchTreasuryState]);

  const handleConnectNearWallet = async () => {
    setConnectingNear(true);
    setWalletError(null);
    setWalletFeedback(null);
    try {
      const connected = await nearWalletAdapter.connect(
        selectedNearWalletId ? { walletId: selectedNearWalletId } : undefined
      );
      setWalletFeedback(
        `Connected NEAR Wallet (${connected.walletName}): ${connected.address} on ${connected.network}`
      );
      await fetchTreasuryState();
      await onRefreshGlobalData();
    } catch (err) {
      setWalletError((err as Error).message);
    } finally {
      setConnectingNear(false);
    }
  };

  const handleConnectMetaMask = async () => {
    setConnectingMetaMask(true);
    setWalletError(null);
    setWalletFeedback(null);
    try {
      const connected = await metaMaskAdapter.connect({
        preferredChain: preferredEvmConnectChain,
      });
      setWalletFeedback(
        `Connected ${connected.walletName}: ${connected.address} on ${connected.network}`
      );
      await fetchTreasuryState();
      await onRefreshGlobalData();
    } catch (err) {
      setWalletError((err as Error).message);
    } finally {
      setConnectingMetaMask(false);
    }
  };

  const handleConnectSimulatedWallet = async (kind: 'near' | 'evm') => {
    setWalletError(null);
    setWalletFeedback(null);
    const nowIso = new Date().toISOString();
    const payload =
      kind === 'near'
        ? {
            walletType: 'simulated',
            walletId: 'simulated-near-sandbox',
            walletName: 'Simulated NEAR Treasury (Sandbox)',
            address: 'treasury-sandbox.near',
            network: 'NEAR Sandbox (Simulated)',
            chain: 'near',
            isSimulated: true,
            nativeBalance: {
              symbol: 'NEAR',
              name: 'NEAR (Simulated Sandbox)',
              assetId: 'near:native',
              contractAddress: null,
              decimals: 24,
              rawBalance: '125000000000000000000000000',
              formattedBalance: '125.0000',
              priceUsd: 3.6,
              priceUpdatedAt: nowIso,
              valueUsd: 450.0,
              isNative: true,
            },
            tokenBalances: [
              {
                symbol: 'USDC',
                name: 'USD Coin (Simulated Sandbox)',
                assetId:
                  'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
                contractAddress:
                  '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
                decimals: 6,
                rawBalance: '5000000000',
                formattedBalance: '5000.0000',
                priceUsd: 1.0,
                priceUpdatedAt: nowIso,
                valueUsd: 5000.0,
                isNative: false,
              },
            ],
            capabilities: { signAndSendTransaction: true },
            unsupportedCapabilities: ['Simulated wallet: cannot broadcast real mainnet transactions'],
          }
        : {
            walletType: 'simulated',
            walletId: 'simulated-evm-sandbox',
            walletName: 'Simulated EVM Treasury (Sandbox)',
            address: '0x71C95911E9a5D330f4D621842EC243EE13432921',
            network: 'Base Sandbox (Simulated)',
            chain: 'base',
            chainIdHex: '0x2105',
            isSimulated: true,
            nativeBalance: {
              symbol: 'ETH',
              name: 'Ether (Simulated Sandbox)',
              assetId: 'nep141:base.omft.near',
              contractAddress: null,
              decimals: 18,
              rawBalance: '1500000000000000000',
              formattedBalance: '1.5000',
              priceUsd: 2227.5,
              priceUpdatedAt: nowIso,
              valueUsd: 3341.25,
              isNative: true,
            },
            tokenBalances: [
              {
                symbol: 'USDC',
                name: 'USD Coin (Simulated Base Sandbox)',
                assetId: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
                contractAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
                decimals: 6,
                rawBalance: '4200000000',
                formattedBalance: '4200.0000',
                priceUsd: 1.0,
                priceUpdatedAt: nowIso,
                valueUsd: 4200.0,
                isNative: false,
              },
            ],
            capabilities: { eth_sendTransaction: true },
            unsupportedCapabilities: ['Simulated wallet: cannot broadcast real mainnet transactions'],
          };

    await fetch('/api/treasury/wallets/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setWalletFeedback(
      `Connected ${payload.walletName} (${payload.address}). Explicitly labeled SIMULATED WALLET.`
    );
    await fetchTreasuryState();
    await onRefreshGlobalData();
  };

  const handleDisconnectWallet = async (w: ConnectedWalletRecord) => {
    setWalletError(null);
    if (w.walletType === 'near') {
      await nearWalletAdapter.disconnect();
    } else if (w.walletType === 'metamask') {
      await metaMaskAdapter.disconnect();
    }
    await fetch(`/api/treasury/wallets/${encodeURIComponent(w.id)}`, {
      method: 'DELETE',
    });
    setWalletFeedback(`Disconnected wallet ${w.address}`);
    await fetchTreasuryState();
    await onRefreshGlobalData();
  };

  const handleRefreshSingleWalletBalance = async (w: ConnectedWalletRecord) => {
    if (w.isSimulated) return;
    setWalletError(null);
    try {
      await fetch('/api/treasury/wallets/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...w,
          fetchLiveBalances: true,
        }),
      });
      setWalletFeedback(`Refreshed live on-chain balances for ${w.address}`);
      await fetchTreasuryState();
    } catch (err) {
      setWalletError((err as Error).message);
    }
  };

  const handleSwitchMetaMaskChain = async (target: 'ethereum' | 'base' | 'arbitrum') => {
    setWalletError(null);
    try {
      const net = await metaMaskAdapter.switchNetwork(target);
      setWalletFeedback(`Switched MetaMask to ${net.networkName} (${net.chainIdHex})`);
      await handleConnectMetaMask();
    } catch (err) {
      setWalletError((err as Error).message);
    }
  };

  const handleInspectOnChainBalance = async (type: 'near' | 'evm') => {
    setInspectingOnChain(true);
    setWalletError(null);
    try {
      if (type === 'near') {
        const res = await fetch('/api/treasury/balances/near', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId: inspectNearInput.trim() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to inspect NEAR account balances.');
        setInspectedBalances({
          label: data.accountId,
          network: data.network,
          nativeBalance: data.nativeBalance,
          tokenBalances: data.tokenBalances || [],
          refreshedAt: data.refreshedAt,
        });
      } else {
        const res = await fetch('/api/treasury/balances/evm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            address: inspectEvmInput.trim(),
            chain: inspectEvmChain,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to inspect EVM account balances.');
        setInspectedBalances({
          label: data.address,
          network: data.network,
          nativeBalance: data.nativeBalance,
          tokenBalances: data.tokenBalances || [],
          refreshedAt: data.refreshedAt,
        });
      }
    } catch (err) {
      setWalletError((err as Error).message);
    } finally {
      setInspectingOnChain(false);
    }
  };

  const handleSaveSettings = async (patch: Partial<TreasurySettings>) => {
    setSavingSettings(true);
    setWalletError(null);
    try {
      const res = await fetch('/api/treasury/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save treasury settings.');
      setSettings(data.settings);
      setWalletFeedback('Treasury settings saved.');
    } catch (err) {
      setWalletError((err as Error).message);
    } finally {
      setSavingSettings(false);
    }
  };

  // Compute strictly separated LIVE vs SIMULATED balances (Never combine or invent portfolio values!)
  const liveWallets = wallets.filter((w) => !w.isSimulated);
  const simulatedWallets = wallets.filter((w) => w.isSimulated);

  const liveTotalUsd = liveWallets.reduce((sum, w) => {
    const nat = Number(w.nativeBalance?.valueUsd || 0);
    const tok = (w.tokenBalances || []).reduce((s, t) => s + Number(t.valueUsd || 0), 0);
    return sum + nat + tok;
  }, 0);

  const payableInvoices = invoices.filter(
    (inv) =>
      inv.finalDecision === 'PAY' ||
      inv.paymentStatus === 'AWAITING_WALLET_SIGNATURE' ||
      inv.paymentStatus === 'APPROVED'
  );

  const metaMaskDetected = metaMaskAdapter.isMetaMaskDetected();

  return (
    <div className="space-y-6">
      {/* Page Title & Treasury Status Header */}
      <div
        className="p-6 rounded-2xl border bg-white flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4"
        style={{ borderColor: 'var(--border)' }}
      >
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span
              className="text-xs font-bold px-2.5 py-0.5 rounded-full uppercase"
              style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--primary)' }}
            >
              Non-Custodial Treasury
            </span>
            <span className="text-xs text-slate-500">
              Last balance refresh: {new Date(lastBalanceRefresh).toLocaleTimeString()}
            </span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">
            Treasury Wallets & Cross-Chain Funding
          </h2>
          <p className="text-sm text-slate-600 mt-0.5">
            Connect your corporate NEAR Wallet (`@hot-labs/near-connect`) or MetaMask (`EIP-1193`).
            STEWARD never takes custody of private keys or seed phrases.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => void fetchTreasuryState()}
            disabled={loadingTreasury}
            className="px-4 py-2.5 rounded-xl border text-xs font-bold bg-white hover:bg-slate-50 flex items-center gap-2"
            style={{ borderColor: 'var(--border)' }}
          >
            <RefreshCw className={`w-4 h-4 ${loadingTreasury ? 'animate-spin' : ''}`} />
            Refresh Balances & 1Click Prices
          </button>
        </div>
      </div>

      {/* Feedback & Error Alerts */}
      {walletError && (
        <div
          className="p-4 rounded-xl border flex items-center justify-between gap-3 text-xs font-medium"
          style={{ backgroundColor: 'var(--danger-soft)', color: 'var(--danger)', borderColor: '#F5C2C0' }}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{walletError}</span>
          </div>
          <button onClick={() => setWalletError(null)} className="underline text-xs">
            Dismiss
          </button>
        </div>
      )}

      {walletFeedback && (
        <div
          className="p-4 rounded-xl border flex items-center justify-between gap-3 text-xs font-medium"
          style={{ backgroundColor: 'var(--success-soft)', color: 'var(--success)', borderColor: '#B7E1C4' }}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{walletFeedback}</span>
          </div>
          <button onClick={() => setWalletFeedback(null)} className="underline text-xs">
            Dismiss
          </button>
        </div>
      )}

      {/* 1. TREASURY OVERVIEW KPI CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div
          className="p-5 rounded-2xl bg-white border"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 mb-1">
            <span>Verified Live Wallet Balance</span>
            <span
              className="px-2 py-0.5 rounded-full text-[10px] font-bold"
              style={{ backgroundColor: '#E8F5EC', color: '#23845B' }}
            >
              LIVE WALLET ONLY
            </span>
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900">
            {liveWallets.length > 0 ? `$${liveTotalUsd.toFixed(2)}` : '$0.00'}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            {liveWallets.length > 0
              ? `Priced via 1Click live token feed (${liveWallets.length} live wallet${liveWallets.length > 1 ? 's' : ''})`
              : 'Connect a live NEAR or MetaMask wallet to display on-chain value'}
          </p>
        </div>

        <div
          className="p-5 rounded-2xl bg-white border"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 mb-1">
            <span>Connected Wallets</span>
            <Wallet className="w-4 h-4 text-emerald-800" />
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900">
            {liveWallets.length} Live{' '}
            {simulatedWallets.length > 0 && (
              <span className="text-sm font-medium text-amber-700">
                (+{simulatedWallets.length} Simulated)
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-500 mt-1 truncate">
            {wallets.length > 0
              ? wallets.map((w) => w.address).join(', ')
              : 'No wallets connected yet'}
          </p>
        </div>

        <div
          className="p-5 rounded-2xl bg-white border"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 mb-1">
            <span>Preferred Funding Source</span>
            <Layers className="w-4 h-4 text-emerald-800" />
          </div>
          <div className="text-lg font-bold text-slate-900 truncate">
            {settings?.preferredSourceAsset || 'USDC'} on{' '}
            {(settings?.preferredSourceChain || 'near').toUpperCase()}
          </div>
          <p className="text-[11px] text-slate-500 mt-1 truncate">
            {settings?.preferredFundingWalletAddress
              ? `Pinned: ${settings.preferredFundingWalletAddress}`
              : `Adapter preference: ${(settings?.preferredFundingWalletType || 'near').toUpperCase()}`}
          </p>
        </div>

        <div
          className="p-5 rounded-2xl bg-white border"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 mb-1">
            <span>1Click Live Token Feed</span>
            <Coins className="w-4 h-4 text-emerald-800" />
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900">
            {supportedTokens.length} Assets
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            NEAR, Base, Arbitrum, Ethereum, Solana, Bitcoin
          </p>
        </div>
      </div>

      {/* 2. CONNECT WALLET SECTION (NEAR CONNECT + METAMASK EIP-1193) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Card A: NEAR Wallet (@hot-labs/near-connect) */}
        <div
          className="p-6 rounded-2xl bg-white border flex flex-col justify-between space-y-4"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm"
                  style={{ backgroundColor: 'var(--primary)', color: '#FFFFFF' }}
                >
                  NEAR
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Connect NEAR Wallet
                  </h3>
                  <p className="text-xs text-slate-500">
                    Powered by <code className="font-mono">@hot-labs/near-connect</code> (Mainnet)
                  </p>
                </div>
              </div>
              <ChainBadge chain="near" />
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Connect HOT Wallet, Meteor Wallet, MyNearWallet, Intear, Nightly, or any NEAR
              manifest wallet. Supports native NEAR transfers and NEP-141 fungible tokens (USDC,
              USDT, wNEAR) with automatic NEP-145 storage registration checks.
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Discovered NEAR Wallets ({discoveredNearWallets.length} in manifest)
              </label>
              <select
                value={selectedNearWalletId}
                onChange={(e) => setSelectedNearWalletId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border text-xs bg-white"
                style={{ borderColor: 'var(--border)' }}
              >
                <option value="">
                  Open NEAR Connect Wallet Selector Popup (All Compatible Wallets)
                </option>
                {discoveredNearWallets.map((dw) => (
                  <option key={dw.id} value={dw.id}>
                    {dw.name} ({dw.type}) — {dw.capabilities.signAndSendTransaction ? 'Tx Signing Supported' : 'Read Only'}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="pt-2 flex flex-wrap items-center gap-2.5">
            <button
              onClick={handleConnectNearWallet}
              disabled={connectingNear}
              className="px-4 py-2.5 rounded-xl text-xs font-bold text-white flex items-center gap-2"
              style={{ backgroundColor: 'var(--primary)' }}
            >
              <Wallet className="w-4 h-4" />
              {connectingNear ? 'Opening NEAR Connect...' : 'Connect NEAR Wallet'}
            </button>

            <button
              onClick={() => void handleConnectSimulatedWallet('near')}
              className="px-3.5 py-2.5 rounded-xl border text-xs font-semibold bg-amber-50 hover:bg-amber-100 text-amber-900"
              style={{ borderColor: '#F3D299' }}
            >
              + Connect Simulated NEAR Sandbox
            </button>
          </div>
        </div>

        {/* Card B: MetaMask (EIP-1193 Provider) */}
        <div
          className="p-6 rounded-2xl bg-white border flex flex-col justify-between space-y-4"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm"
                  style={{ backgroundColor: '#F6851B', color: '#FFFFFF' }}
                >
                  EVM
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900">
                      Connect MetaMask
                    </h3>
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{
                        backgroundColor: metaMaskDetected ? '#E8F5EC' : '#FFF5DF',
                        color: metaMaskDetected ? '#23845B' : '#9A6700',
                      }}
                    >
                      {metaMaskDetected ? 'EIP-1193 Provider Detected' : 'Extension Not Detected'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Supports Ethereum (`0x1`), Base (`0x2105`), and Arbitrum One (`0xa4b1`)
                  </p>
                </div>
              </div>
              <ChainBadge chain={preferredEvmConnectChain} />
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Connect your EVM corporate treasury via <code className="font-mono">eth_requestAccounts</code>.
              Supports native ETH transfers and ABI-encoded ERC-20 token transfers (<code className="font-mono">0xa9059cbb</code>)
              with live gas estimation and chain switching.
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Target EVM Source Network
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['base', 'arbitrum', 'ethereum'] as const).map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => {
                      setPreferredEvmConnectChain(ch);
                      if (metaMaskDetected) {
                        void handleSwitchMetaMaskChain(ch);
                      }
                    }}
                    className="px-3 py-2 rounded-xl border text-xs font-semibold uppercase transition-colors"
                    style={{
                      backgroundColor:
                        preferredEvmConnectChain === ch ? 'var(--accent-soft)' : '#FFFFFF',
                      borderColor:
                        preferredEvmConnectChain === ch ? 'var(--primary)' : 'var(--border)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {ch}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="pt-2 flex flex-wrap items-center gap-2.5">
            <button
              onClick={handleConnectMetaMask}
              disabled={connectingMetaMask}
              className="px-4 py-2.5 rounded-xl text-xs font-bold text-white flex items-center gap-2"
              style={{ backgroundColor: 'var(--primary)' }}
            >
              <Wallet className="w-4 h-4" />
              {connectingMetaMask ? 'Requesting Accounts...' : 'Connect MetaMask'}
            </button>

            <button
              onClick={() => void handleConnectSimulatedWallet('evm')}
              className="px-3.5 py-2.5 rounded-xl border text-xs font-semibold bg-amber-50 hover:bg-amber-100 text-amber-900"
              style={{ borderColor: '#F3D299' }}
            >
              + Connect Simulated Base Sandbox
            </button>
          </div>
        </div>
      </div>

      {/* 3. CONNECTED WALLET CARDS */}
      <div
        className="p-6 rounded-2xl bg-white border space-y-4"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Connected Treasury Wallets ({wallets.length})
            </h3>
            <p className="text-xs text-slate-500">
              Each card displays live native balances, NEP-141 / ERC-20 token balances, and
              capability inspection.
            </p>
          </div>
        </div>

        {wallets.length === 0 ? (
          <div
            className="p-8 rounded-xl border text-center space-y-2"
            style={{ backgroundColor: 'var(--surface-secondary)', borderColor: 'var(--border)' }}
          >
            <Wallet className="w-8 h-8 mx-auto text-emerald-900 opacity-75" />
            <div className="text-sm font-bold text-slate-900">
              No Treasury Wallets Connected
            </div>
            <p className="text-xs text-slate-600 max-w-md mx-auto">
              Use the Connect NEAR Wallet or Connect MetaMask buttons above to link a live
              non-custodial wallet, or add a Simulated Sandbox wallet to test the end-to-end
              authorization screen.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {wallets.map((w) => {
              const isPreferred =
                settings?.preferredFundingWalletAddress?.toLowerCase() ===
                w.address.toLowerCase();

              return (
                <div
                  key={w.id}
                  className="p-5 rounded-xl border space-y-3.5"
                  style={{
                    backgroundColor: isPreferred ? '#FAFDF6' : '#FFFFFF',
                    borderColor: isPreferred ? 'var(--primary)' : 'var(--border)',
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-bold text-slate-900">{w.walletName}</span>
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase"
                          style={{
                            backgroundColor: w.isSimulated ? '#FFF5DF' : '#E8F5EC',
                            color: w.isSimulated ? '#9A6700' : '#23845B',
                          }}
                        >
                          {w.isSimulated ? 'SIMULATED WALLET' : 'LIVE WALLET'}
                        </span>
                        {isPreferred && (
                          <span
                            className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase"
                            style={{ backgroundColor: 'var(--accent)', color: 'var(--primary)' }}
                          >
                            Preferred Funding Wallet
                          </span>
                        )}
                      </div>
                      <div className="text-xs font-mono font-semibold text-slate-700 mt-1 break-all">
                        {w.address}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Network: <strong>{w.network}</strong>{' '}
                        {w.chainIdHex ? `(${w.chainIdHex})` : ''} • Status:{' '}
                        <span className="text-emerald-700 font-semibold uppercase">{w.status}</span>
                      </div>
                    </div>
                    <ChainBadge chain={w.chain} />
                  </div>

                  {/* Native & Supported Token Balances */}
                  <div
                    className="p-3 rounded-xl border space-y-2 text-xs"
                    style={{ backgroundColor: 'var(--surface-secondary)', borderColor: 'var(--border)' }}
                  >
                    <div className="flex items-center justify-between font-semibold text-slate-800 border-b border-slate-200 pb-1.5">
                      <span>Asset</span>
                      <span>On-Chain Balance (USD Value)</span>
                    </div>
                    {w.nativeBalance && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-700 font-medium">
                          {w.nativeBalance.symbol} <span className="text-[10px] text-slate-500">(Native)</span>
                        </span>
                        <span className="font-mono font-bold text-slate-900">
                          {w.nativeBalance.formattedBalance} {w.nativeBalance.symbol}{' '}
                          {w.nativeBalance.valueUsd !== null && (
                            <span className="text-slate-500 font-normal">
                              (${w.nativeBalance.valueUsd.toFixed(2)})
                            </span>
                          )}
                        </span>
                      </div>
                    )}
                    {(w.tokenBalances || []).map((tb) => (
                      <div key={tb.assetId} className="flex items-center justify-between">
                        <span className="text-slate-700 font-medium">
                          {tb.symbol}{' '}
                          <span className="text-[10px] text-slate-500 font-mono">
                            ({tb.contractAddress ? `${tb.contractAddress.slice(0, 10)}...` : 'Token'})
                          </span>
                        </span>
                        <span className="font-mono font-bold text-slate-900">
                          {tb.formattedBalance} {tb.symbol}{' '}
                          {tb.valueUsd !== null && (
                            <span className="text-slate-500 font-normal">
                              (${tb.valueUsd.toFixed(2)})
                            </span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Capability Warnings */}
                  {w.unsupportedCapabilities && w.unsupportedCapabilities.length > 0 && (
                    <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                      <strong>Capability Note:</strong> {w.unsupportedCapabilities.join(' • ')}
                    </div>
                  )}

                  {/* Card Actions */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <div className="flex items-center gap-2">
                      {!isPreferred && (
                        <button
                          onClick={() =>
                            void handleSaveSettings({
                              preferredFundingWalletAddress: w.address,
                              preferredFundingWalletType:
                                w.walletType === 'metamask' ? 'metamask' : 'near',
                              preferredSourceChain: w.chain,
                            })
                          }
                          className="px-2.5 py-1.5 rounded-lg border text-xs font-semibold bg-white hover:bg-slate-50"
                          style={{ borderColor: 'var(--border)' }}
                        >
                          Set Preferred
                        </button>
                      )}
                      {!w.isSimulated && (
                        <button
                          onClick={() => void handleRefreshSingleWalletBalance(w)}
                          className="px-2.5 py-1.5 rounded-lg border text-xs font-semibold bg-white hover:bg-slate-50 flex items-center gap-1"
                          style={{ borderColor: 'var(--border)' }}
                        >
                          <RefreshCw className="w-3 h-3" />
                          Refresh
                        </button>
                      )}
                    </div>

                    <button
                      onClick={() => void handleDisconnectWallet(w)}
                      className="px-2.5 py-1.5 rounded-lg border text-xs font-semibold text-red-700 hover:bg-red-50 flex items-center gap-1"
                      style={{ borderColor: '#F5C2C0' }}
                    >
                      <Unplug className="w-3.5 h-3.5" />
                      Disconnect
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 4. APPROVED INVOICES READY FOR WALLET AUTHORIZATION */}
      <div
        className="p-6 rounded-2xl bg-white border space-y-4"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Invoices Ready for Non-Custodial Wallet Authorization ({payableInvoices.length})
            </h3>
            <p className="text-xs text-slate-500">
              Invoices that have passed STEWARD&apos;s 7-stage security & policy checks. Click
              Authorize & Pay to preview the 1Click quote, commit a deposit address, and sign in
              your wallet.
            </p>
          </div>
        </div>

        {payableInvoices.length === 0 ? (
          <div className="p-4 rounded-xl border text-xs text-slate-600 bg-slate-50">
            No approved invoices awaiting payment. Upload an invoice in the Invoices tab or approve
            a held bill in the Approvals tab.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b text-slate-500" style={{ borderColor: 'var(--border)' }}>
                  <th className="py-2.5 px-3 font-semibold">Invoice</th>
                  <th className="py-2.5 px-3 font-semibold">Vendor</th>
                  <th className="py-2.5 px-3 font-semibold">Amount</th>
                  <th className="py-2.5 px-3 font-semibold">Destination</th>
                  <th className="py-2.5 px-3 font-semibold">Status</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Wallet Action</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {payableInvoices.slice(0, 6).map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-3 font-mono font-bold text-slate-900">
                      #{inv.invoiceNumber}
                    </td>
                    <td className="py-3 px-3 font-medium text-slate-800">{inv.vendorName}</td>
                    <td className="py-3 px-3 font-mono font-bold text-slate-900">
                      ${inv.total.toFixed(2)} {inv.requestedPayoutAsset}
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-1.5">
                        <ChainBadge chain={inv.requestedDestinationChain} />
                        <span className="font-mono text-slate-600 truncate max-w-[140px]">
                          {inv.receivingWalletAddress}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <PaymentStatusBadge status={inv.paymentStatus} />
                    </td>
                    <td className="py-3 px-3 text-right">
                      <button
                        onClick={() => onAuthorizeInvoicePayment(inv)}
                        className="px-3 py-1.5 rounded-xl text-xs font-bold text-white inline-flex items-center gap-1.5"
                        style={{ backgroundColor: 'var(--primary)' }}
                      >
                        <Wallet className="w-3.5 h-3.5" />
                        Authorize & Pay with Wallet
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 5. PUBLIC ON-CHAIN BALANCE INSPECTOR & TREASURY SETTINGS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Live Public On-Chain Balance Inspector */}
        <div
          className="p-6 rounded-2xl bg-white border space-y-4"
          style={{ borderColor: 'var(--border)' }}
        >
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Live On-Chain Balance Inspector (NEAR & EVM)
            </h3>
            <p className="text-xs text-slate-500">
              Verify live native and NEP-141 / ERC-20 token balances on NEAR Mainnet, Ethereum,
              Base, or Arbitrum One via RPC + 1Click live price feed.
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Inspect NEAR Mainnet Account (Native NEAR + USDC / USDT / wNEAR)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={inspectNearInput}
                  onChange={(e) => setInspectNearInput(e.target.value)}
                  placeholder="e.g. wrap.near or your-account.near"
                  className="flex-1 px-3 py-2 rounded-xl border text-xs font-mono"
                  style={{ borderColor: 'var(--border)' }}
                />
                <button
                  onClick={() => void handleInspectOnChainBalance('near')}
                  disabled={inspectingOnChain}
                  className="px-3.5 py-2 rounded-xl text-xs font-bold text-white"
                  style={{ backgroundColor: 'var(--primary)' }}
                >
                  Query NEAR
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Inspect EVM Address (Native ETH + ERC-20 USDC / USDT)
              </label>
              <div className="flex flex-wrap sm:flex-nowrap gap-2">
                <input
                  type="text"
                  value={inspectEvmInput}
                  onChange={(e) => setInspectEvmInput(e.target.value)}
                  placeholder="0x..."
                  className="flex-1 px-3 py-2 rounded-xl border text-xs font-mono"
                  style={{ borderColor: 'var(--border)' }}
                />
                <select
                  value={inspectEvmChain}
                  onChange={(e) =>
                    setInspectEvmChain(e.target.value as 'base' | 'arbitrum' | 'ethereum')
                  }
                  className="px-2.5 py-2 rounded-xl border text-xs font-semibold bg-white"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <option value="arbitrum">Arbitrum</option>
                  <option value="base">Base</option>
                  <option value="ethereum">Ethereum</option>
                </select>
                <button
                  onClick={() => void handleInspectOnChainBalance('evm')}
                  disabled={inspectingOnChain}
                  className="px-3.5 py-2 rounded-xl text-xs font-bold text-white"
                  style={{ backgroundColor: 'var(--secondary)' }}
                >
                  Query EVM
                </button>
              </div>
            </div>
          </div>

          {inspectedBalances && (
            <div
              className="p-3.5 rounded-xl border space-y-2 text-xs"
              style={{ backgroundColor: 'var(--surface-secondary)', borderColor: 'var(--border)' }}
            >
              <div className="flex items-center justify-between font-bold text-slate-900">
                <span className="truncate max-w-[240px] font-mono">{inspectedBalances.label}</span>
                <span className="text-[11px] text-emerald-800">{inspectedBalances.network}</span>
              </div>
              <div className="space-y-1 pt-1 border-t border-slate-200">
                <div className="flex justify-between">
                  <span>{inspectedBalances.nativeBalance.symbol} (Native):</span>
                  <span className="font-mono font-bold">
                    {inspectedBalances.nativeBalance.formattedBalance}{' '}
                    {inspectedBalances.nativeBalance.symbol} ($
                    {Number(inspectedBalances.nativeBalance.valueUsd || 0).toFixed(2)})
                  </span>
                </div>
                {inspectedBalances.tokenBalances.map((tb) => (
                  <div key={tb.assetId} className="flex justify-between">
                    <span>{tb.symbol}:</span>
                    <span className="font-mono font-bold">
                      {tb.formattedBalance} {tb.symbol} ($
                      {Number(tb.valueUsd || 0).toFixed(2)})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 6. TREASURY SETTINGS */}
        <div
          className="p-6 rounded-2xl bg-white border space-y-4"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Treasury Funding & Routing Settings
              </h3>
              <p className="text-xs text-slate-500">
                Configure preferred funding wallet, source asset, and approved networks. STEWARD
                never changes your selected funding wallet silently.
              </p>
            </div>
            <SlidersHorizontal className="w-5 h-5 text-emerald-900" />
          </div>

          {settings && (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Preferred Funding Wallet Type
                  </label>
                  <select
                    value={settings.preferredFundingWalletType}
                    onChange={(e) =>
                      void handleSaveSettings({
                        preferredFundingWalletType: e.target.value as 'near' | 'metamask' | 'auto',
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border bg-white font-medium"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <option value="near">NEAR Wallet (@hot-labs/near-connect)</option>
                    <option value="metamask">MetaMask (EIP-1193 EVM)</option>
                    <option value="auto">Match Connected Active Wallet</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Preferred Source Asset
                  </label>
                  <select
                    value={settings.preferredSourceAsset}
                    onChange={(e) =>
                      void handleSaveSettings({ preferredSourceAsset: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-xl border bg-white font-medium"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <option value="USDC">USDC (USD Coin)</option>
                    <option value="USDT">USDT (Tether USD)</option>
                    <option value="WNEAR">wNEAR (Wrapped NEAR)</option>
                    <option value="NEAR">NEAR (Native)</option>
                    <option value="ETH">ETH (Native Ether)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Allowed Source Networks
                </label>
                <div className="flex flex-wrap gap-2">
                  {ALL_SOURCE_CHAINS.map((ch) => {
                    const active = settings.allowedSourceNetworks.includes(ch);
                    return (
                      <button
                        key={ch}
                        type="button"
                        onClick={() => {
                          const next = active
                            ? settings.allowedSourceNetworks.filter((c) => c !== ch)
                            : [...settings.allowedSourceNetworks, ch];
                          if (next.length > 0) {
                            void handleSaveSettings({ allowedSourceNetworks: next });
                          }
                        }}
                        className="px-3 py-1.5 rounded-lg border font-semibold uppercase"
                        style={{
                          backgroundColor: active ? 'var(--primary)' : '#FFFFFF',
                          color: active ? '#FFFFFF' : 'var(--text-secondary)',
                          borderColor: active ? 'var(--primary)' : 'var(--border)',
                        }}
                      >
                        {ch}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Approved Destination Networks (1Click Settlement)
                </label>
                <div className="flex flex-wrap gap-2">
                  {ALL_DEST_CHAINS.map((ch) => {
                    const active = settings.approvedDestinationNetworks.includes(ch);
                    return (
                      <button
                        key={ch}
                        type="button"
                        onClick={() => {
                          const next = active
                            ? settings.approvedDestinationNetworks.filter((c) => c !== ch)
                            : [...settings.approvedDestinationNetworks, ch];
                          if (next.length > 0) {
                            void handleSaveSettings({ approvedDestinationNetworks: next });
                          }
                        }}
                        className="px-3 py-1.5 rounded-lg border font-semibold uppercase"
                        style={{
                          backgroundColor: active ? 'var(--accent-soft)' : '#FFFFFF',
                          color: active ? 'var(--primary)' : 'var(--text-secondary)',
                          borderColor: active ? 'var(--primary)' : 'var(--border)',
                        }}
                      >
                        {ch}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                <span>
                  Approved Destination Assets: {settings.approvedDestinationAssets.join(', ')}
                </span>
                <span>{savingSettings ? 'Saving...' : 'Synced with SQLite'}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
