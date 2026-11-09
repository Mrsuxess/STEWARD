import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck,
  Wallet,
  ArrowRight,
  Clock,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ExternalLink,
  Lock,
  X,
  FileCode2,
  Info,
} from 'lucide-react';
import type {
  ConnectedWalletRecord,
  PaymentExecutionRecord,
  PaymentLifecycleStatus,
  ProcessedInvoiceRecord,
  SupportedChain,
  TreasurySettings,
} from '../../shared/types.js';
import { nearWalletAdapter } from '../wallets/nearWalletAdapter.js';
import { metaMaskAdapter } from '../wallets/metaMaskAdapter.js';
import { ChainBadge } from './StewardLogo.js';

interface PaymentAuthorizationModalProps {
  open: boolean;
  invoice: ProcessedInvoiceRecord | null;
  connectedWallets: ConnectedWalletRecord[];
  treasurySettings: TreasurySettings | null;
  onClose: () => void;
  onPaymentUpdated: () => Promise<void>;
  onNavigateToTreasury: () => void;
}

const LIFECYCLE_STEPS: Array<{ key: PaymentLifecycleStatus; label: string }> = [
  { key: 'APPROVED', label: 'Policy Approved' },
  { key: 'AWAITING_WALLET_SIGNATURE', label: 'Awaiting Wallet Signature' },
  { key: 'DEPOSIT_SUBMITTED', label: 'Deposit Submitted' },
  { key: 'DEPOSIT_CONFIRMED', label: 'Deposit Confirmed' },
  { key: 'PROCESSING', label: '1Click Cross-Chain Swap' },
  { key: 'COMPLETED', label: 'Settlement Completed' },
];

export const PaymentAuthorizationModal: React.FC<PaymentAuthorizationModalProps> = ({
  open,
  invoice,
  connectedWallets,
  treasurySettings,
  onClose,
  onPaymentUpdated,
  onNavigateToTreasury,
}) => {
  const [selectedWalletId, setSelectedWalletId] = useState<string>('');
  const [selectedSourceAsset, setSelectedSourceAsset] = useState<string>('USDC');
  const [preparedPayment, setPreparedPayment] = useState<PaymentExecutionRecord | null>(null);
  const [loadingDryQuote, setLoadingDryQuote] = useState(false);
  const [committingQuote, setCommittingQuote] = useState(false);
  const [signingWallet, setSigningWallet] = useState(false);
  const [pollingStatus, setPollingStatus] = useState(false);
  const [userConfirmedTerms, setUserConfirmedTerms] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Select default funding wallet from treasurySettings without silently overriding user choice
  useEffect(() => {
    if (!open || !invoice) return;
    setErrorMsg(null);
    setStatusMessage(null);
    setUserConfirmedTerms(false);

    if (invoice.paymentExecution && invoice.paymentExecution.custodyMode === 'non_custodial_wallet') {
      setPreparedPayment(invoice.paymentExecution);
    } else {
      setPreparedPayment(null);
    }

    if (connectedWallets.length > 0 && !selectedWalletId) {
      const prefAddr = treasurySettings?.preferredFundingWalletAddress;
      const prefType = treasurySettings?.preferredFundingWalletType;
      const matched =
        connectedWallets.find(
          (w) => prefAddr && w.address.toLowerCase() === prefAddr.toLowerCase()
        ) ||
        connectedWallets.find((w) => prefType && w.walletType === prefType) ||
        connectedWallets[0];
      if (matched) {
        setSelectedWalletId(matched.id);
      }
    }
    if (treasurySettings?.preferredSourceAsset) {
      setSelectedSourceAsset(treasurySettings.preferredSourceAsset);
    }
  }, [open, invoice, connectedWallets, treasurySettings, selectedWalletId]);

  const activeWallet =
    connectedWallets.find((w) => w.id === selectedWalletId) || connectedWallets[0] || null;

  const fetchDryQuotePreview = useCallback(async () => {
    if (!invoice || !activeWallet) return;
    setLoadingDryQuote(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/payments/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: invoice.id,
          sourceWalletType: activeWallet.walletType,
          sourceWalletAddress: activeWallet.address,
          sourceChain: activeWallet.chain,
          sourceAssetSymbol: selectedSourceAsset,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to prepare dry payment quote.');
      }
      setPreparedPayment(data.payment);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setLoadingDryQuote(false);
    }
  }, [invoice, activeWallet, selectedSourceAsset]);

  useEffect(() => {
    if (
      open &&
      invoice &&
      activeWallet &&
      (!preparedPayment || preparedPayment.invoiceId !== invoice.id)
    ) {
      void fetchDryQuotePreview();
    }
  }, [open, invoice, activeWallet, preparedPayment, fetchDryQuotePreview]);

  if (!open || !invoice) return null;

  const handleCommitQuote = async () => {
    if (!activeWallet) {
      setErrorMsg('Please connect a NEAR or MetaMask treasury wallet first.');
      return;
    }
    if (!userConfirmedTerms) {
      setErrorMsg('Please check the explicit payment confirmation box before committing a quote.');
      return;
    }

    setCommittingQuote(true);
    setErrorMsg(null);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/payments/commit-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: invoice.id,
          sourceWalletType: activeWallet.walletType === 'simulated' ? 'near' : activeWallet.walletType,
          sourceWalletAddress: activeWallet.address,
          sourceChain: activeWallet.chain,
          sourceAssetSymbol: selectedSourceAsset,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to request committed 1Click quote.');
      }
      setPreparedPayment(data.payment);
      setStatusMessage(
        'Committed 1Click quote locked and single-use deposit address generated. Ready for explicit wallet signature.'
      );
      await onPaymentUpdated();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setCommittingQuote(false);
    }
  };

  const handleSignWithWallet = async () => {
    if (!preparedPayment || !preparedPayment.preparedTransaction || !activeWallet) {
      setErrorMsg('Please commit the quote first to generate the transaction payload.');
      return;
    }

    // Check quote expiration before invoking wallet signature
    if (preparedPayment.quoteExpiresAt) {
      const expMs = new Date(preparedPayment.quoteExpiresAt).getTime();
      if (Number.isFinite(expMs) && expMs < Date.now()) {
        setErrorMsg('This committed quote has expired. Please refresh and commit a new quote.');
        return;
      }
    }

    setSigningWallet(true);
    setErrorMsg(null);
    setStatusMessage(null);

    try {
      if (activeWallet.isSimulated) {
        // Explicit simulated sandbox signature — never fabricates a real-looking mainnet hash
        const submitRes = await fetch(`/api/payments/${preparedPayment.id}/submit-deposit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            txHash: `SIMULATED_SANDBOX_DEPOSIT_${Date.now()}`,
            isSimulatedTransaction: true,
          }),
        });
        const submitData = await submitRes.json();
        if (!submitRes.ok) {
          throw new Error(submitData.error || 'Failed to record simulated deposit.');
        }
        setPreparedPayment(submitData.payment);
        setStatusMessage(
          'Simulated deposit recorded in sandbox mode (no real mainnet funds transferred).'
        );
        await onPaymentUpdated();
        return;
      }

      // Real Non-Custodial Wallet Signature (NEAR Connect or MetaMask EIP-1193)
      const txPayload = preparedPayment.preparedTransaction;
      const signResult =
        txPayload.walletType === 'near'
          ? await nearWalletAdapter.signAndSendTransaction(txPayload)
          : await metaMaskAdapter.signAndSendTransaction(txPayload);

      const submitRes = await fetch(`/api/payments/${preparedPayment.id}/submit-deposit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txHash: signResult.txHash,
          isSimulatedTransaction: false,
        }),
      });
      const submitData = await submitRes.json();
      if (!submitRes.ok) {
        throw new Error(submitData.error || 'Failed to notify 1Click of signed deposit hash.');
      }

      setPreparedPayment(submitData.payment);
      setStatusMessage(
        `Transaction signed and broadcast (${signResult.txHash.slice(0, 14)}...). 1Click notified — tracking cross-chain settlement.`
      );
      await onPaymentUpdated();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setSigningWallet(false);
    }
  };

  const handlePollStatus = async () => {
    if (!preparedPayment) return;
    setPollingStatus(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/payments/${preparedPayment.id}/poll-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to poll 1Click status.');
      }
      setPreparedPayment(data.payment);
      setStatusMessage(
        `Latest 1Click status: ${data.payment.lifecycleStatus} (${data.payment.statusSource})`
      );
      await onPaymentUpdated();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setPollingStatus(false);
    }
  };

  const currentLifecycle: PaymentLifecycleStatus =
    preparedPayment?.lifecycleStatus || 'APPROVED';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(18, 61, 50, 0.55)', backdropFilter: 'blur(4px)' }}
    >
      <div
        className="w-full max-w-3xl rounded-2xl bg-white shadow-2xl border overflow-hidden flex flex-col max-h-[92vh]"
        style={{ borderColor: 'var(--border)' }}
      >
        {/* Header */}
        <div
          className="px-6 py-4 flex items-center justify-between border-b"
          style={{ backgroundColor: 'var(--primary)', color: '#FFFFFF', borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center font-bold"
              style={{ backgroundColor: 'var(--accent)', color: 'var(--primary)' }}
            >
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold tracking-tight">
                  Non-Custodial Payment Authorization
                </h3>
                <span
                  className="text-[11px] font-bold px-2 py-0.5 rounded-full uppercase"
                  style={{
                    backgroundColor: activeWallet?.isSimulated ? '#FFF5DF' : '#EDF8D8',
                    color: activeWallet?.isSimulated ? '#9A6700' : '#123D32',
                  }}
                >
                  {activeWallet?.isSimulated ? 'SIMULATED WALLET' : 'LIVE WALLET'}
                </span>
                {preparedPayment && (
                  <span
                    className="text-[11px] font-bold px-2 py-0.5 rounded-full uppercase"
                    style={{
                      backgroundColor: preparedPayment.isSimulatedQuote ? '#FFF5DF' : '#E8F5EC',
                      color: preparedPayment.isSimulatedQuote ? '#9A6700' : '#23845B',
                    }}
                  >
                    {preparedPayment.isSimulatedQuote ? 'SIMULATED QUOTE' : 'LIVE QUOTE'}
                  </span>
                )}
              </div>
              <p className="text-xs opacity-80">
                STEWARD never holds your private keys. Review quote details and authorize in your wallet.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-white"
            aria-label="Close Payment Authorization Modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-6 overflow-y-auto space-y-5">
          {/* Lifecycle Progress Bar */}
          <div
            className="p-3.5 rounded-xl border"
            style={{ backgroundColor: 'var(--surface-secondary)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                Payment Lifecycle Status
              </span>
              <span
                className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-full"
                style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--primary)' }}
              >
                {currentLifecycle}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-1.5">
              {LIFECYCLE_STEPS.map((step, idx) => {
                const activeIdx = LIFECYCLE_STEPS.findIndex((s) => s.key === currentLifecycle);
                const isDone = activeIdx >= idx;
                return (
                  <div
                    key={step.key}
                    className="px-2 py-1.5 rounded-lg text-[11px] font-semibold text-center border"
                    style={{
                      backgroundColor: isDone ? 'var(--primary)' : '#FFFFFF',
                      color: isDone ? '#FFFFFF' : 'var(--text-secondary)',
                      borderColor: isDone ? 'var(--primary)' : 'var(--border)',
                    }}
                  >
                    {idx + 1}. {step.label}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Connected Wallet Selection */}
          {connectedWallets.length === 0 ? (
            <div
              className="p-4 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
              style={{ backgroundColor: 'var(--warning-soft)', borderColor: '#F3D299' }}
            >
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--warning)' }} />
                <div>
                  <div className="text-sm font-bold text-slate-900">
                    No Treasury Wallet Connected
                  </div>
                  <p className="text-xs text-slate-700 mt-0.5">
                    Connect your NEAR Wallet or MetaMask on the Treasury page to authorize and sign this payment.
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  onClose();
                  onNavigateToTreasury();
                }}
                className="px-3.5 py-2 rounded-xl text-xs font-bold text-white shrink-0"
                style={{ backgroundColor: 'var(--primary)' }}
              >
                Open Treasury & Connect Wallet
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Source Funding Wallet (Never Changed Silently)
                </label>
                <select
                  value={activeWallet?.id || ''}
                  onChange={(e) => {
                    setSelectedWalletId(e.target.value);
                    setPreparedPayment(null);
                  }}
                  className="w-full px-3 py-2 rounded-xl border text-xs font-medium bg-white"
                  style={{ borderColor: 'var(--border)' }}
                >
                  {connectedWallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.walletName} — {w.address} ({w.network}) [{w.isSimulated ? 'SIMULATED' : 'LIVE'}]
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Source Funding Asset
                </label>
                <div className="flex items-center gap-1.5">
                  <select
                    value={selectedSourceAsset}
                    onChange={(e) => {
                      setSelectedSourceAsset(e.target.value);
                      setPreparedPayment(null);
                    }}
                    className="w-full px-3 py-2 rounded-xl border text-xs font-medium bg-white"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <option value="USDC">USDC</option>
                    <option value="USDT">USDT</option>
                    {activeWallet?.chain === 'near' && <option value="WNEAR">wNEAR</option>}
                    {activeWallet?.chain === 'near' && <option value="NEAR">NEAR (Native)</option>}
                    {activeWallet?.chain !== 'near' && <option value="ETH">ETH (Native)</option>}
                  </select>
                  <button
                    onClick={() => void fetchDryQuotePreview()}
                    disabled={loadingDryQuote}
                    className="p-2 rounded-xl border hover:bg-slate-50"
                    style={{ borderColor: 'var(--border)' }}
                    title="Refresh 1Click Quote"
                  >
                    <RefreshCw className={`w-4 h-4 ${loadingDryQuote ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Invoice & Counterparty Summary Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left: Source Treasury Details */}
            <div
              className="p-4 rounded-xl border space-y-2.5"
              style={{ backgroundColor: '#FFFFFF', borderColor: 'var(--border)' }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  1. Source Treasury (Origin)
                </span>
                {activeWallet && <ChainBadge chain={activeWallet.chain} />}
              </div>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Funding Wallet:</span>
                  <span className="font-mono font-semibold text-slate-900 truncate max-w-[210px]">
                    {activeWallet?.address || 'Not connected'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Source Network:</span>
                  <span className="font-semibold text-slate-900">
                    {activeWallet?.network || '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Source Asset:</span>
                  <span className="font-semibold text-slate-900">
                    {preparedPayment?.sourceAsset || selectedSourceAsset}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Exact Source Amount:</span>
                  <span className="font-mono font-bold text-emerald-900">
                    {loadingDryQuote
                      ? 'Calculating...'
                      : preparedPayment?.estimatedInputAmount || `${invoice.total.toFixed(2)} ${selectedSourceAsset}`}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Refund Address:</span>
                  <span className="font-mono text-slate-700 truncate max-w-[210px]">
                    {preparedPayment?.refundAddress || activeWallet?.address || '—'}
                  </span>
                </div>
              </div>
            </div>

            {/* Right: Destination Vendor Details */}
            <div
              className="p-4 rounded-xl border space-y-2.5"
              style={{ backgroundColor: '#FFFFFF', borderColor: 'var(--border)' }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  2. Verified Recipient (Destination)
                </span>
                <ChainBadge chain={invoice.requestedDestinationChain} />
              </div>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Invoice / Vendor:</span>
                  <span className="font-semibold text-slate-900">
                    #{invoice.invoiceNumber} • {invoice.vendorName}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Invoice Amount:</span>
                  <span className="font-mono font-bold text-slate-900">
                    ${invoice.total.toFixed(2)} {invoice.currency}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Expected Destination Output:</span>
                  <span className="font-mono font-bold text-emerald-700">
                    {invoice.total.toFixed(2)} {invoice.requestedPayoutAsset} (EXACT_OUTPUT)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Destination Network:</span>
                  <span className="font-semibold uppercase text-slate-900">
                    {invoice.requestedDestinationChain}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Destination Wallet:</span>
                  <span className="font-mono font-semibold text-slate-900 truncate max-w-[210px]">
                    {invoice.receivingWalletAddress}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* 1Click Quote Telemetry & Fees */}
          {preparedPayment && (
            <div
              className="p-4 rounded-xl border space-y-2"
              style={{ backgroundColor: 'var(--surface-secondary)', borderColor: 'var(--border)' }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-800">
                  NEAR Intents 1Click Quote Details ({preparedPayment.isDryQuote ? 'Dry Preview' : 'Committed Quote'})
                </span>
                <span className="text-[11px] font-mono text-slate-600">
                  Quote ID: {preparedPayment.quoteId || '—'}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1 text-xs">
                <div>
                  <span className="text-slate-500 block">Protocol / Solver Fee</span>
                  <span className="font-mono font-semibold text-slate-900">
                    ${preparedPayment.feesUsd.toFixed(4)} USD
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Max Slippage Buffer</span>
                  <span className="font-mono font-semibold text-slate-900">
                    {((preparedPayment.slippageBps || 100) / 100).toFixed(2)}% (Unused refunded)
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Estimated Settlement</span>
                  <span className="font-mono font-semibold text-slate-900">
                    ~{preparedPayment.timeEstimateSeconds ?? 25} seconds
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Quote Expiration</span>
                  <span className="font-mono font-semibold text-slate-900">
                    {preparedPayment.quoteExpiresAt
                      ? new Date(preparedPayment.quoteExpiresAt).toLocaleTimeString()
                      : '15m window'}
                  </span>
                </div>
              </div>

              {preparedPayment.depositAddress && !preparedPayment.isDryQuote && (
                <div className="mt-3 pt-3 border-t border-slate-200 space-y-1.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-emerald-950">
                      Committed Single-Use 1Click Deposit Address:
                    </span>
                    <span className="font-mono font-bold px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-900 break-all">
                      {preparedPayment.depositAddress}
                    </span>
                  </div>
                  {preparedPayment.preparedTransaction && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-[11px] text-slate-600">
                      <div>
                        <span className="font-semibold text-slate-800">Tx Type:</span>{' '}
                        <span className="font-mono">{preparedPayment.preparedTransaction.kind}</span>
                      </div>
                      <div>
                        <span className="font-semibold text-slate-800">Target Contract:</span>{' '}
                        <span className="font-mono truncate">
                          {preparedPayment.preparedTransaction.contractOrReceiverAddress}
                        </span>
                      </div>
                      <div>
                        <span className="font-semibold text-slate-800">Estimated Gas:</span>{' '}
                        <span className="font-mono">
                          {preparedPayment.preparedTransaction.estimatedGasDisplay}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {preparedPayment.txHash && (
                <div className="mt-2 pt-2 border-t border-slate-200 flex items-center justify-between text-xs">
                  <span className="font-bold text-emerald-900">Source Chain Deposit TxHash:</span>
                  {preparedPayment.explorerUrl ? (
                    <a
                      href={preparedPayment.explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono font-semibold text-emerald-800 underline flex items-center gap-1"
                    >
                      {preparedPayment.txHash.slice(0, 18)}...
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  ) : (
                    <span className="font-mono text-slate-800">{preparedPayment.txHash}</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Architectural Security Notice */}
          <div
            className="p-3.5 rounded-xl border flex items-start gap-2.5 text-xs"
            style={{ backgroundColor: '#F7F8F3', borderColor: 'var(--border)' }}
          >
            <Info className="w-4 h-4 shrink-0 mt-0.5 text-emerald-800" />
            <div className="text-slate-700 leading-relaxed">
              <strong className="text-slate-900">Non-Custodial Signing Architecture:</strong> Every real
              deposit requires your explicit confirmation here and interactive signature inside your
              connected wallet—even for invoices under the automatic policy threshold. Unattended
              autonomous payouts without wallet popups require a separate delegated-signing or TEE
              vault architecture.
            </div>
          </div>

          {/* Explicit Confirmation Checkbox */}
          <label className="flex items-start gap-2.5 p-3 rounded-xl border bg-white cursor-pointer text-xs">
            <input
              type="checkbox"
              checked={userConfirmedTerms}
              onChange={(e) => setUserConfirmedTerms(e.target.checked)}
              className="mt-0.5 rounded"
            />
            <span className="text-slate-800 font-medium">
              I have verified that Invoice <strong>#{invoice.invoiceNumber}</strong> from{' '}
              <strong>{invoice.vendorName}</strong> for{' '}
              <strong>
                ${invoice.total.toFixed(2)} {invoice.requestedPayoutAsset}
              </strong>{' '}
              on <strong>{invoice.requestedDestinationChain.toUpperCase()}</strong> ({invoice.receivingWalletAddress}) is
              authentic and authorize preparing a deposit from my connected wallet.
            </span>
          </label>

          {errorMsg && (
            <div
              className="p-3 rounded-xl border text-xs font-medium flex items-center gap-2"
              style={{ backgroundColor: 'var(--danger-soft)', color: 'var(--danger)', borderColor: '#F5C2C0' }}
            >
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {statusMessage && (
            <div
              className="p-3 rounded-xl border text-xs font-medium flex items-center gap-2"
              style={{ backgroundColor: 'var(--success-soft)', color: 'var(--success)', borderColor: '#B7E1C4' }}
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{statusMessage}</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div
          className="px-6 py-4 border-t flex flex-wrap items-center justify-between gap-3 bg-slate-50"
          style={{ borderColor: 'var(--border)' }}
        >
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl border text-xs font-semibold bg-white hover:bg-slate-100"
            style={{ borderColor: 'var(--border)' }}
          >
            Close
          </button>

          <div className="flex flex-wrap items-center gap-2.5">
            {preparedPayment && !preparedPayment.isDryQuote && (
              <button
                onClick={handlePollStatus}
                disabled={pollingStatus}
                className="px-3.5 py-2 rounded-xl border text-xs font-semibold bg-white hover:bg-slate-100 flex items-center gap-1.5"
                style={{ borderColor: 'var(--border)' }}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${pollingStatus ? 'animate-spin' : ''}`} />
                {pollingStatus ? 'Polling 1Click...' : 'Poll 1Click Status'}
              </button>
            )}

            <button
              onClick={handleCommitQuote}
              disabled={committingQuote || !activeWallet || !userConfirmedTerms}
              className="px-4 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-50 flex items-center gap-1.5"
              style={{ backgroundColor: 'var(--secondary)' }}
            >
              <FileCode2 className="w-4 h-4" />
              {committingQuote
                ? 'Requesting Committed Quote...'
                : preparedPayment && !preparedPayment.isDryQuote
                  ? 'Refresh Committed Quote'
                  : '1. Commit Quote & Prepare Tx'}
            </button>

            <button
              onClick={handleSignWithWallet}
              disabled={
                signingWallet ||
                !preparedPayment ||
                preparedPayment.isDryQuote ||
                !preparedPayment.preparedTransaction ||
                currentLifecycle === 'COMPLETED'
              }
              className="px-4 py-2 rounded-xl text-xs font-bold disabled:opacity-50 flex items-center gap-1.5"
              style={{ backgroundColor: 'var(--primary)', color: '#FFFFFF' }}
            >
              <Wallet className="w-4 h-4" />
              {signingWallet
                ? 'Awaiting Wallet Signature...'
                : activeWallet?.isSimulated
                  ? '2. Authorize Simulated Deposit'
                  : `2. Sign & Send in ${activeWallet?.walletName || 'Wallet'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
