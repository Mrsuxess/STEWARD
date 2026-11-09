import React, { useState } from 'react';
import {
  Wallet,
  ShieldCheck,
  Sparkles,
  Eye,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Lock,
  Building2,
  AlertCircle,
  Layers,
  Globe,
} from 'lucide-react';
import { StewardLogo } from './StewardLogo.js';
import { nearWalletAdapter } from '../wallets/nearWalletAdapter.js';
import { metaMaskAdapter } from '../wallets/metaMaskAdapter.js';
import type { ConnectedWalletRecord, ExperienceMode } from '../../shared/types.js';

interface LaunchGatewayViewProps {
  connectedWallets: ConnectedWalletRecord[];
  onBackToLanding: () => void;
  onEnterWorkspace: (mode: ExperienceMode, initialTab?: string) => void;
  onStartOnboarding: () => void;
  onWalletsUpdated: () => Promise<void>;
}

export const LaunchGatewayView: React.FC<LaunchGatewayViewProps> = ({
  connectedWallets,
  onBackToLanding,
  onEnterWorkspace,
  onStartOnboarding,
  onWalletsUpdated,
}) => {
  const [selectedEvmChain, setSelectedEvmChain] = useState<'base' | 'arbitrum' | 'ethereum'>('base');
  const [manualNearInput, setManualNearInput] = useState('');
  const [showManualNearInput, setShowManualNearInput] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  const realWallets = connectedWallets.filter((w) => !w.isSimulated);

  const handleConnectNearWallet = async () => {
    setBusyAction('near');
    setStatusBanner(null);
    try {
      const account = await nearWalletAdapter.connect();
      const balances = await nearWalletAdapter.getBalance(account.address);
      const res = await fetch('/api/treasury/wallets/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletType: 'near',
          walletId: account.walletId,
          walletName: account.walletName,
          address: account.address,
          network: account.network,
          chain: 'near',
          isSimulated: false,
          nativeBalance: balances.nativeBalance,
          tokenBalances: balances.tokenBalances,
          capabilities: account.capabilities,
          unsupportedCapabilities: account.unsupportedCapabilities,
          fetchLiveBalances: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to sync NEAR wallet');

      await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          experienceMode: 'real',
          checklistState: { treasuryConnected: true },
        }),
      });
      await onWalletsUpdated();
      setStatusBanner({
        type: 'success',
        message: `Connected NEAR Wallet (${account.address}). Entering Real Mode workspace...`,
      });
      setTimeout(() => onEnterWorkspace('real', 'treasury'), 600);
    } catch (err) {
      setShowManualNearInput(true);
      setStatusBanner({
        type: 'info',
        message: `${(err as Error).message} You can also link your NEAR Mainnet account ID below to inspect live RPC balances and prepare non-custodial transactions.`,
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleLinkNearAccountById = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualNearInput.trim()) return;
    setBusyAction('near-manual');
    setStatusBanner(null);
    try {
      const address = manualNearInput.trim().toLowerCase();
      const res = await fetch('/api/treasury/wallets/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletType: 'near',
          walletId: 'near-non-custodial',
          walletName: 'NEAR Wallet (Mainnet)',
          address,
          network: 'NEAR Mainnet',
          chain: 'near',
          isSimulated: false,
          fetchLiveBalances: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invalid NEAR account ID');

      await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          experienceMode: 'real',
          checklistState: { treasuryConnected: true },
        }),
      });
      await onWalletsUpdated();
      onEnterWorkspace('real', 'treasury');
    } catch (err) {
      setStatusBanner({ type: 'error', message: (err as Error).message });
    } finally {
      setBusyAction(null);
    }
  };

  const handleConnectMetaMask = async () => {
    setBusyAction('metamask');
    setStatusBanner(null);
    try {
      const account = await metaMaskAdapter.connect({ preferredChain: selectedEvmChain });
      const balances = await metaMaskAdapter.getBalance(account.address);
      const res = await fetch('/api/treasury/wallets/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletType: 'metamask',
          walletId: account.walletId,
          walletName: account.walletName,
          address: account.address,
          network: account.network,
          chain: account.chain,
          chainIdHex: account.chainIdHex,
          isSimulated: false,
          nativeBalance: balances.nativeBalance,
          tokenBalances: balances.tokenBalances,
          capabilities: account.capabilities,
          unsupportedCapabilities: account.unsupportedCapabilities,
          fetchLiveBalances: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to sync MetaMask wallet');

      await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          experienceMode: 'real',
          checklistState: { treasuryConnected: true },
        }),
      });
      await onWalletsUpdated();
      setStatusBanner({
        type: 'success',
        message: `Connected MetaMask (${account.address}) on ${account.network}. Entering Real Mode...`,
      });
      setTimeout(() => onEnterWorkspace('real', 'treasury'), 600);
    } catch (err) {
      setStatusBanner({
        type: 'error',
        message: (err as Error).message,
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleLaunchSimulatedTreasury = async () => {
    setBusyAction('simulated');
    setStatusBanner(null);
    try {
      const res = await fetch('/api/treasury/seed-demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to launch simulated treasury');
      await onWalletsUpdated();
      onEnterWorkspace('simulated', 'overview');
    } catch (err) {
      setStatusBanner({ type: 'error', message: (err as Error).message });
    } finally {
      setBusyAction(null);
    }
  };

  const handleExploreWithoutConnecting = async () => {
    setBusyAction('explore');
    try {
      await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ experienceMode: 'explore' }),
      });
      onEnterWorkspace('explore', 'overview');
    } catch {
      onEnterWorkspace('explore', 'overview');
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F8F3] text-[#18251F] flex flex-col">
      {/* Top Gateway Header */}
      <header className="border-b border-[#E6EAE2] bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={onBackToLanding}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#E6EAE2] bg-[#F7F8F3] px-3 py-1.5 text-xs font-semibold text-[#18251F] hover:bg-[#F0F3EC] transition-colors cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to Landing Page</span>
            </button>
            <StewardLogo size="sm" />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onStartOnboarding}
              className="inline-flex items-center gap-2 rounded-xl bg-[#EDF8D8] border border-[#C7F36B] px-4 py-2 text-xs sm:text-sm font-bold text-[#123D32] hover:bg-[#e2f4c5] transition-colors cursor-pointer"
            >
              <Building2 className="h-4 w-4" />
              <span>Business Onboarding Wizard (6 Steps)</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Gateway Container */}
      <main className="flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
        <div className="mx-auto max-w-3xl text-center space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full bg-[#EDF8D8] px-3.5 py-1 text-xs font-bold text-[#123D32] border border-[#C7F36B]">
            <ShieldCheck className="h-3.5 w-3.5 text-[#23845B]" />
            <span>Non-Custodial Treasury Architecture • Zero Private Key Custody</span>
          </div>
          <h1 className="font-display text-3xl sm:text-5xl font-extrabold tracking-tight text-[#123D32]">
            Welcome to STEWARD.
          </h1>
          <p className="text-base sm:text-lg text-[#78847C]">
            Choose how you want to experience secure business payments.
          </p>
        </div>

        {statusBanner && (
          <div
            className={`mt-6 mx-auto max-w-4xl rounded-xl border p-4 flex items-start gap-3 text-xs sm:text-sm ${
              statusBanner.type === 'success'
                ? 'bg-[#E8F5EC] border-[#23845B]/30 text-[#123D32]'
                : statusBanner.type === 'error'
                ? 'bg-[#FCEDEC] border-[#D9534F]/40 text-[#B8322E]'
                : 'bg-[#FFF5DF] border-[#D99A32]/40 text-[#8A5A00]'
            }`}
          >
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="flex-1">{statusBanner.message}</div>
          </div>
        )}

        {/* Three Distinct Entry Options */}
        <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-3 items-stretch">
          {/* =================================================================
              OPTION A — CONNECT REAL WALLET
             ================================================================= */}
          <div className="steward-card p-6 sm:p-7 flex flex-col justify-between border-2 border-[#123D32] bg-white shadow-sm">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#123D32] px-3 py-1 text-[11px] font-bold text-[#C7F36B]">
                  <Wallet className="h-3.5 w-3.5" />
                  OPTION A • REAL MODE
                </span>
                <span className="font-mono text-xs font-semibold text-[#23845B]">
                  Non-Custodial
                </span>
              </div>

              <div>
                <h2 className="font-display text-xl font-extrabold text-[#18251F]">
                  Connect Real Wallet
                </h2>
                <p className="mt-1.5 text-xs sm:text-sm text-[#78847C] leading-relaxed">
                  Connect your company&apos;s live NEAR Wallet or MetaMask treasury. View live RPC
                  token balances, prepare 1Click cross-chain quotes, and sign transactions in your
                  own wallet.
                </p>
              </div>

              {/* NEAR Wallet Connection Block */}
              <div className="rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-[#123D32] flex items-center gap-1.5">
                    <Globe className="h-3.5 w-3.5 text-[#237A57]" />
                    <span>1. NEAR Protocol Treasury</span>
                  </div>
                  <span className="text-[11px] font-mono text-[#78847C]">Mainnet</span>
                </div>

                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={handleConnectNearWallet}
                  className="w-full inline-flex items-center justify-between rounded-xl bg-[#123D32] px-4 py-2.5 text-xs sm:text-sm font-bold text-white hover:bg-[#1B5545] transition-colors cursor-pointer disabled:opacity-50"
                >
                  <span>
                    {busyAction === 'near' ? 'Opening NEAR Connect...' : 'Connect NEAR Wallet'}
                  </span>
                  <ArrowRight className="h-4 w-4 text-[#C7F36B]" />
                </button>

                <button
                  type="button"
                  onClick={() => setShowManualNearInput((v) => !v)}
                  className="text-[11px] font-semibold text-[#237A57] hover:underline cursor-pointer"
                >
                  {showManualNearInput
                    ? 'Hide NEAR Account ID input'
                    : 'Or link a NEAR Mainnet Account ID directly →'}
                </button>

                {showManualNearInput && (
                  <form onSubmit={handleLinkNearAccountById} className="flex gap-2 pt-1">
                    <input
                      type="text"
                      value={manualNearInput}
                      onChange={(e) => setManualNearInput(e.target.value)}
                      placeholder="e.g. vitalik.near"
                      className="flex-1 rounded-lg border border-[#E6EAE2] bg-white px-3 py-1.5 text-xs font-mono text-[#18251F] focus:border-[#123D32] focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={busyAction !== null}
                      className="rounded-lg bg-[#237A57] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#123D32] cursor-pointer"
                    >
                      Link
                    </button>
                  </form>
                )}
              </div>

              {/* MetaMask EVM Connection Block */}
              <div className="rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-[#123D32] flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5 text-[#237A57]" />
                    <span>2. MetaMask (EVM Networks)</span>
                  </div>
                  <select
                    aria-label="Select EVM Network"
                    value={selectedEvmChain}
                    onChange={(e) =>
                      setSelectedEvmChain(e.target.value as 'base' | 'arbitrum' | 'ethereum')
                    }
                    className="rounded-md border border-[#E6EAE2] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#18251F]"
                  >
                    <option value="base">Base Mainnet</option>
                    <option value="arbitrum">Arbitrum One</option>
                    <option value="ethereum">Ethereum Mainnet</option>
                  </select>
                </div>

                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={handleConnectMetaMask}
                  className="w-full inline-flex items-center justify-between rounded-xl border border-[#123D32] bg-white px-4 py-2.5 text-xs sm:text-sm font-bold text-[#123D32] hover:bg-[#EDF8D8] transition-colors cursor-pointer disabled:opacity-50"
                >
                  <span>
                    {busyAction === 'metamask' ? 'Requesting MetaMask...' : 'Connect MetaMask'}
                  </span>
                  <ArrowRight className="h-4 w-4 text-[#123D32]" />
                </button>
              </div>

              {realWallets.length > 0 && (
                <div className="rounded-xl bg-[#E8F5EC] border border-[#23845B]/30 p-3 text-xs text-[#123D32] space-y-1.5">
                  <div className="font-bold flex items-center justify-between">
                    <span>Active Real Wallet Session</span>
                    <button
                      type="button"
                      onClick={() => onEnterWorkspace('real', 'treasury')}
                      className="underline font-bold text-[#23845B] cursor-pointer"
                    >
                      Continue to Treasury →
                    </button>
                  </div>
                  {realWallets.map((w) => (
                    <div key={w.id} className="font-mono text-[11px] truncate">
                      • {w.walletName}: {w.address} ({w.chain.toUpperCase()})
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-5 pt-4 border-t border-[#E6EAE2] space-y-1.5 text-[11px] text-[#78847C]">
              <div className="flex items-center gap-1.5 font-semibold text-[#18251F]">
                <Lock className="h-3.5 w-3.5 text-[#23845B]" />
                <span>Connecting a wallet never authorizes automatic spending.</span>
              </div>
              <p>
                STEWARD never requests private keys or seed phrases. Every payment requires a
                separate human review and explicit wallet signature.
              </p>
            </div>
          </div>

          {/* =================================================================
              OPTION B — LAUNCH SIMULATED TREASURY
             ================================================================= */}
          <div className="steward-card p-6 sm:p-7 flex flex-col justify-between bg-white border border-[#E6EAE2]">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EDF8D8] px-3 py-1 text-[11px] font-bold text-[#123D32] border border-[#C7F36B]">
                  <Sparkles className="h-3.5 w-3.5 text-[#23845B]" />
                  OPTION B • SIMULATED MODE
                </span>
                <span className="rounded-md bg-[#FFF5DF] px-2 py-0.5 font-mono text-[10px] font-bold text-[#8A5A00] border border-[#D99A32]/30">
                  SIMULATED / DEMO
                </span>
              </div>

              <div>
                <h2 className="font-display text-xl font-extrabold text-[#18251F]">
                  Launch Simulated Treasury
                </h2>
                <p className="mt-1.5 text-xs sm:text-sm text-[#78847C] leading-relaxed">
                  Open a complete, interactive demonstration environment preloaded with clearly
                  labelled simulated corporate wallets, sample invoices, verified vendors, and
                  red-team attack scenarios.
                </p>
              </div>

              <div className="rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] p-4 space-y-2.5 text-xs">
                <div className="font-bold text-[#123D32]">
                  Preloaded Simulated Environment Includes:
                </div>
                <ul className="space-y-2 text-[#78847C]">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-[#23845B] shrink-0 mt-0.5" />
                    <span>
                      <strong>Simulated NEAR Wallet:</strong>{' '}
                      <code className="font-mono text-[11px] text-[#18251F]">
                        demo-treasury.steward.near
                      </code>{' '}
                      (1,450 NEAR • 48,500 USDC • 15,250 USDT)
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-[#23845B] shrink-0 mt-0.5" />
                    <span>
                      <strong>Simulated EVM Vault:</strong>{' '}
                      <code className="font-mono text-[11px] text-[#18251F]">
                        0x71C0...089A
                      </code>{' '}
                      on Base (4.25 ETH • 32,000 USDC)
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-[#23845B] shrink-0 mt-0.5" />
                    <span>
                      <strong>Sample AP Operations:</strong> Verified vendors, held approval
                      requests, live 1Click dry quotes, security events, and audit records.
                    </span>
                  </li>
                </ul>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={handleLaunchSimulatedTreasury}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#123D32] px-5 py-3.5 text-sm font-bold text-white shadow-xs hover:bg-[#1B5545] transition-colors cursor-pointer disabled:opacity-50"
              >
                <span>
                  {busyAction === 'simulated'
                    ? 'Preparing Demo Treasury...'
                    : 'Launch Demo Treasury'}
                </span>
                <ArrowRight className="h-4 w-4 text-[#C7F36B]" />
              </button>

              <p className="text-[11px] text-[#78847C] text-center">
                Explicitly labelled <strong>SIMULATED</strong>. Never fabricates blockchain
                transaction hashes or submits simulated deposits to mainnet.
              </p>
            </div>
          </div>

          {/* =================================================================
              OPTION C — EXPLORE WITHOUT CONNECTING
             ================================================================= */}
          <div className="steward-card p-6 sm:p-7 flex flex-col justify-between bg-white border border-[#E6EAE2]">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F0F3EC] px-3 py-1 text-[11px] font-bold text-[#18251F] border border-[#E6EAE2]">
                  <Eye className="h-3.5 w-3.5 text-[#78847C]" />
                  OPTION C • READ-ONLY
                </span>
                <span className="font-mono text-xs font-semibold text-[#78847C]">
                  No Wallet Needed
                </span>
              </div>

              <div>
                <h2 className="font-display text-xl font-extrabold text-[#18251F]">
                  Explore Without Connecting
                </h2>
                <p className="mt-1.5 text-xs sm:text-sm text-[#78847C] leading-relaxed">
                  Inspect the entire STEWARD platform in a read-only demonstration mode before
                  connecting a treasury wallet or registering your company workspace.
                </p>
              </div>

              <div className="rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] p-4 space-y-2.5 text-xs">
                <div className="font-bold text-[#123D32]">Available to Inspect in Explore Mode:</div>
                <ul className="space-y-2 text-[#78847C]">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-[#23845B] shrink-0" />
                    <span>Overview Dashboard & AP Financial Metrics</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-[#23845B] shrink-0" />
                    <span>Invoices, 5-Stage Journey & TEE Hardware Proofs</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-[#23845B] shrink-0" />
                    <span>Verified Vendor Registry & 48h Cooling-Off Logs</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-[#23845B] shrink-0" />
                    <span>Security Center, Payment Lifecycle & Audit Ledger</span>
                  </li>
                </ul>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={handleExploreWithoutConnecting}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-[#123D32] bg-white px-5 py-3.5 text-sm font-bold text-[#123D32] hover:bg-[#F0F3EC] transition-colors cursor-pointer disabled:opacity-50"
              >
                <span>Explore Without Connecting</span>
                <ArrowRight className="h-4 w-4 text-[#123D32]" />
              </button>

              <p className="text-[11px] text-[#78847C] text-center">
                State-changing actions (approving bills, modifying policies, signing payouts)
                clearly explain when wallet connection is required.
              </p>
            </div>
          </div>
        </div>

        {/* Bottom Guided Business Onboarding Banner */}
        <div className="mt-10 rounded-2xl bg-[#123D32] p-6 sm:p-8 text-white flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-1.5 max-w-2xl">
            <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#C7F36B]">
              <Building2 className="h-4 w-4" />
              <span>Setting Up STEWARD for Your Company?</span>
            </div>
            <h3 className="font-display text-xl sm:text-2xl font-extrabold">
              Complete the 6-Step Business Onboarding Flow
            </h3>
            <p className="text-xs sm:text-sm text-white/80">
              Create your company workspace, assign finance team roles (Owner, Finance
              Administrator, Approver, Auditor), connect your treasury, configure spending caps,
              register verified vendors, and process your first protected invoice.
            </p>
          </div>

          <button
            type="button"
            onClick={onStartOnboarding}
            className="shrink-0 inline-flex items-center gap-2 rounded-xl bg-[#C7F36B] px-6 py-3.5 text-sm font-extrabold text-[#123D32] hover:bg-[#d4f788] transition-colors cursor-pointer"
          >
            <span>Start Business Onboarding</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </main>
    </div>
  );
};
