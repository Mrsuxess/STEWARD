import React, { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard,
  FileText,
  CheckSquare,
  Building2,
  ArrowLeftRight,
  ShieldAlert,
  Swords,
  BookOpenCheck,
  Settings as SettingsIcon,
  ShieldCheck,
  Upload,
  Play,
  Download,
  Search,
  AlertOctagon,
  CheckCircle2,
  Clock,
  Lock,
  RefreshCw,
  Eye,
  Sun,
  Moon,
  Terminal,
  Plus,
} from 'lucide-react';
import type {
  AttestationVerificationResult,
  NearAccountIntelligence,
  OperatingMode,
  PaymentExecutionRecord,
  PolicyConfig,
  ProcessedInvoiceRecord,
  SecurityEventRecord,
  SupportedChain,
  VendorAddressHistoryEntry,
  VendorRecord,
} from '../shared/types.js';
import type {
  AttackEvaluationSuiteReport,
  SyntheticInvoiceScenario,
} from '../evaluation/redTeamAndSuite.js';
import { PrivateAiVerifiedPanel } from './components/PrivateAiVerifiedPanel.js';
import { PipelineTraceModal } from './components/PipelineTraceModal.js';

type NavTab =
  | 'overview'
  | 'invoices'
  | 'approvals'
  | 'vendors'
  | 'transactions'
  | 'security'
  | 'redteam'
  | 'ledger'
  | 'settings';

interface OverviewResponse {
  mode: OperatingMode;
  nearAiKeyConfigured: boolean;
  nearAiModel: string;
  custodyMode: string;
  treasuryAccount: string;
  allowMainnetExecution: boolean;
  metrics: {
    totalInvoicesProcessed: number;
    totalAmountPaidUsd: number;
    pendingApprovalsCount: number;
    totalAmountHeldUsd: number;
    blockedSuspiciousCount: number;
    totalAmountBlockedUsd: number;
    paymentSuccessRate: number;
    verifiedVendorsCount: number;
  };
  policy: PolicyConfig;
  recentInvoices: ProcessedInvoiceRecord[];
  recentTransactions: PaymentExecutionRecord[];
  recentSecurityEvents: SecurityEventRecord[];
}

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [lightMode, setLightMode] = useState(false);

  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [invoices, setInvoices] = useState<ProcessedInvoiceRecord[]>([]);
  const [vendors, setVendors] = useState<VendorRecord[]>([]);
  const [vendorHistory, setVendorHistory] = useState<VendorAddressHistoryEntry[]>([]);
  const [payments, setPayments] = useState<PaymentExecutionRecord[]>([]);
  const [securityEvents, setSecurityEvents] = useState<SecurityEventRecord[]>([]);
  const [blocklist, setBlocklist] = useState<
    Array<{ address: string; chain: string; reason: string; source: string; addedAt: string }>
  >([]);
  const [redTeamScenarios, setRedTeamScenarios] = useState<SyntheticInvoiceScenario[]>([]);
  const [evalReport, setEvalReport] = useState<AttackEvaluationSuiteReport | null>(null);

  // Invoice Workspace state
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('RT-01-LEGIT-LAGOS');
  const [rawInvoiceInput, setRawInvoiceInput] = useState<string>('');
  const [processingInvoice, setProcessingInvoice] = useState(false);
  const [latestProcessed, setLatestProcessed] = useState<ProcessedInvoiceRecord | null>(null);
  const [inspectedInvoice, setInspectedInvoice] = useState<ProcessedInvoiceRecord | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );

  // Live Attestation Verifier state
  const [liveAttestation, setLiveAttestation] = useState<AttestationVerificationResult | null>(
    null
  );
  const [verifyingAttestation, setVerifyingAttestation] = useState(false);

  // Live NEAR RPC Account Inspector state
  const [rpcAccountInput, setRpcAccountInput] = useState('wrap.near');
  const [rpcIntel, setRpcIntel] = useState<NearAccountIntelligence | null>(null);
  const [inspectingRpc, setInspectingRpc] = useState(false);

  // 1Click Quote Preview state
  const [quoteChain, setQuoteChain] = useState<SupportedChain>('near');
  const [quoteAmount, setQuoteAmount] = useState('185');
  const [quoteRecipient, setQuoteRecipient] = useState('vitalik.near');
  const [quotePreview, setQuotePreview] = useState<Record<string, unknown> | null>(null);
  const [loadingQuote, setLoadingQuote] = useState(false);

  // Ledger filters
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [ledgerStatusFilter, setLedgerStatusFilter] = useState('ALL');
  const [ledgerModeFilter, setLedgerModeFilter] = useState('ALL');

  // Vendor Onboarding & Address Change state
  const [newVendorName, setNewVendorName] = useState('');
  const [newVendorWallet, setNewVendorWallet] = useState('');
  const [newVendorChain, setNewVendorChain] = useState<SupportedChain>('near');
  const [rotateVendorId, setRotateVendorId] = useState('VND-LAGOS-01');
  const [rotateNewAddress, setRotateNewAddress] = useState('');
  const [rotateReason, setRotateReason] = useState('Corporate wallet rotation');

  // Evaluation suite runner state
  const [runningSuite, setRunningSuite] = useState(false);

  const refreshAllData = useCallback(async () => {
    try {
      const [ovRes, invRes, vndRes, payRes, secRes, rtRes] = await Promise.all([
        fetch('/api/overview'),
        fetch('/api/invoices'),
        fetch('/api/vendors'),
        fetch('/api/payments'),
        fetch('/api/security/events'),
        fetch('/api/red-team/scenarios'),
      ]);

      if (ovRes.ok) {
        const ovData = (await ovRes.json()) as OverviewResponse;
        setOverview(ovData);
        if (!liveAttestation && ovData.recentInvoices[0]?.attestation) {
          setLiveAttestation(ovData.recentInvoices[0].attestation);
        }
      }
      if (invRes.ok) {
        const d = await invRes.json();
        setInvoices(d.invoices || []);
      }
      if (vndRes.ok) {
        const d = await vndRes.json();
        setVendors(d.vendors || []);
        setVendorHistory(d.addressHistory || []);
      }
      if (payRes.ok) {
        const d = await payRes.json();
        setPayments(d.payments || []);
      }
      if (secRes.ok) {
        const d = await secRes.json();
        setSecurityEvents(d.events || []);
        setBlocklist(d.blocklist || []);
      }
      if (rtRes.ok) {
        const d = await rtRes.json();
        const scenarios: SyntheticInvoiceScenario[] = d.featuredScenarios || [];
        setRedTeamScenarios(scenarios);
        if (scenarios.length > 0 && !rawInvoiceInput) {
          setRawInvoiceInput(scenarios[0].rawInvoiceText);
        }
      }
    } catch (err) {
      console.error('Failed to refresh STEWARD data:', err);
    }
  }, [liveAttestation, rawInvoiceInput]);

  useEffect(() => {
    refreshAllData();
  }, [refreshAllData]);

  const handleSelectScenario = (scenarioId: string) => {
    setSelectedScenarioId(scenarioId);
    const found = redTeamScenarios.find((s) => s.id === scenarioId);
    if (found) {
      setRawInvoiceInput(found.rawInvoiceText);
    }
  };

  const handleProcessInvoice = async (overrideScenarioId?: string) => {
    setProcessingInvoice(true);
    setStatusMessage(null);
    try {
      const targetScenario = overrideScenarioId
        ? redTeamScenarios.find((s) => s.id === overrideScenarioId)
        : redTeamScenarios.find(
            (s) => s.id === selectedScenarioId && s.rawInvoiceText.trim() === rawInvoiceInput.trim()
          );

      const res = await fetch('/api/invoices/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          targetScenario
            ? { scenarioId: targetScenario.id, mode: overview?.mode || 'simulation' }
            : { rawText: rawInvoiceInput, mode: overview?.mode || 'simulation' }
        ),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Invoice processing failed');
      }

      setLatestProcessed(data.invoice);
      setLiveAttestation(data.invoice.attestation);
      setStatusMessage({
        type: data.invoice.finalDecision === 'BLOCK' ? 'err' : 'ok',
        text: `Processed Invoice #${data.invoice.invoiceNumber} → Decision: ${data.invoice.finalDecision} (${data.invoice.paymentStatus})`,
      });
      await refreshAllData();
    } catch (err) {
      setStatusMessage({ type: 'err', text: (err as Error).message });
    } finally {
      setProcessingInvoice(false);
    }
  };

  const handleUploadPdf = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setProcessingInvoice(true);
    setStatusMessage(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mode', overview?.mode || 'simulation');

      const res = await fetch('/api/invoices/upload-pdf', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'PDF extraction failed');

      setLatestProcessed(data.invoice);
      setLiveAttestation(data.invoice.attestation);
      setStatusMessage({
        type: 'ok',
        text: `${data.privacyGuarantee} Decision: ${data.invoice.finalDecision}`,
      });
      await refreshAllData();
    } catch (err) {
      setStatusMessage({ type: 'err', text: (err as Error).message });
    } finally {
      setProcessingInvoice(false);
      e.target.value = '';
    }
  };

  const handleApproveInvoice = async (invoiceId: string) => {
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approvedBy: 'controller@steward-ap.finance',
          notes: 'Verified vendor exception via STEWARD Approval Queue',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Approval failed');
      setStatusMessage({
        type: 'ok',
        text: `Approved Invoice #${data.invoice.invoiceNumber} → Status: ${data.invoice.paymentStatus}`,
      });
      await refreshAllData();
    } catch (err) {
      setStatusMessage({ type: 'err', text: (err as Error).message });
    }
  };

  const handleRejectInvoice = async (invoiceId: string) => {
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rejectedBy: 'controller@steward-ap.finance',
          reason: 'Rejected during human AP exception review',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Rejection failed');
      setStatusMessage({
        type: 'err',
        text: `Rejected Invoice #${data.invoice.invoiceNumber} → Status: BLOCKED`,
      });
      await refreshAllData();
    } catch (err) {
      setStatusMessage({ type: 'err', text: (err as Error).message });
    }
  };

  const handleRunLiveAttestation = async (opts?: {
    tamperQuote?: boolean;
    tamperNonce?: boolean;
  }) => {
    setVerifyingAttestation(true);
    try {
      const res = await fetch('/api/attestation/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts || {}),
      });
      const data = await res.json();
      if (data.attestation) {
        setLiveAttestation(data.attestation);
      }
      await refreshAllData();
    } catch (err) {
      console.error(err);
    } finally {
      setVerifyingAttestation(false);
    }
  };

  const handleInspectNearAccount = async () => {
    setInspectingRpc(true);
    try {
      const res = await fetch('/api/risk/inspect-near-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: rpcAccountInput }),
      });
      const data = await res.json();
      setRpcIntel(data.intelligence || null);
    } catch (err) {
      console.error(err);
    } finally {
      setInspectingRpc(false);
    }
  };

  const handleFetch1ClickQuote = async () => {
    setLoadingQuote(true);
    try {
      const res = await fetch('/api/payments/quote-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destinationChain: quoteChain,
          payoutAsset: 'USDC',
          amountUsd: Number(quoteAmount || 100),
          recipientAddress: quoteRecipient,
        }),
      });
      const data = await res.json();
      setQuotePreview(data.quote || null);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingQuote(false);
    }
  };

  const handleRunEvaluationSuite = async () => {
    setRunningSuite(true);
    try {
      const res = await fetch('/api/red-team/run-evaluation-suite', {
        method: 'POST',
      });
      const data = await res.json();
      setEvalReport(data.report || null);
    } catch (err) {
      console.error(err);
    } finally {
      setRunningSuite(false);
    }
  };

  const handleToggleKillSwitch = async () => {
    if (!overview?.policy) return;
    await fetch('/api/policy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kill_switch: !overview.policy.kill_switch }),
    });
    await refreshAllData();
  };

  const handleCreateVendor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVendorName || !newVendorWallet) return;
    await fetch('/api/vendors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessName: newVendorName,
        walletAddress: newVendorWallet,
        preferredPayoutAsset: 'USDC',
        preferredDestinationChain: newVendorChain,
        autoVerify: false,
      }),
    });
    setNewVendorName('');
    setNewVendorWallet('');
    await refreshAllData();
  };

  const handleRotateVendorAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rotateVendorId || !rotateNewAddress) return;
    await fetch(`/api/vendors/${rotateVendorId}/change-address`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        newWalletAddress: rotateNewAddress,
        changedBy: 'ap-controller@steward-ap.finance',
        reason: rotateReason,
      }),
    });
    setRotateNewAddress('');
    await refreshAllData();
  };

  const heldInvoices = invoices.filter((i) => i.paymentStatus === 'HELD');

  const filteredLedger = invoices.filter((inv) => {
    if (ledgerStatusFilter !== 'ALL' && inv.paymentStatus !== ledgerStatusFilter) return false;
    if (ledgerModeFilter !== 'ALL' && inv.mode.toUpperCase() !== ledgerModeFilter) return false;
    if (ledgerSearch.trim()) {
      const q = ledgerSearch.toLowerCase();
      return (
        inv.invoiceNumber.toLowerCase().includes(q) ||
        inv.vendorName.toLowerCase().includes(q) ||
        inv.receivingWalletAddress.toLowerCase().includes(q) ||
        inv.decisionReasonSummary.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const navItems: Array<{ id: NavTab; label: string; icon: React.ReactNode; badge?: number }> = [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard className="h-4 w-4" /> },
    { id: 'invoices', label: 'Invoices', icon: <FileText className="h-4 w-4" /> },
    {
      id: 'approvals',
      label: 'Approvals',
      icon: <CheckSquare className="h-4 w-4" />,
      badge: heldInvoices.length,
    },
    { id: 'vendors', label: 'Vendors', icon: <Building2 className="h-4 w-4" /> },
    { id: 'transactions', label: 'Transactions', icon: <ArrowLeftRight className="h-4 w-4" /> },
    { id: 'security', label: 'Risk & Security', icon: <ShieldAlert className="h-4 w-4" /> },
    { id: 'redteam', label: 'Red Team', icon: <Swords className="h-4 w-4" /> },
    { id: 'ledger', label: 'Audit Ledger', icon: <BookOpenCheck className="h-4 w-4" /> },
    { id: 'settings', label: 'Settings', icon: <SettingsIcon className="h-4 w-4" /> },
  ];

  return (
    <div
      className={`min-h-screen flex flex-col ${
        lightMode ? 'bg-slate-50 text-slate-900' : 'bg-slate-950 text-slate-100'
      }`}
    >
      {/* Top Institutional Operational Bar */}
      <header
        className={`sticky top-0 z-30 border-b px-6 py-3 backdrop-blur-md ${
          lightMode
            ? 'border-slate-200 bg-white/95'
            : 'border-slate-800/90 bg-slate-950/90'
        }`}
      >
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-500/40 bg-emerald-500/15 text-emerald-400 font-mono font-bold text-lg">
              S
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold tracking-tight text-base">STEWARD</span>
                <span className="rounded border border-slate-700 bg-slate-800/90 px-2 py-0.5 font-mono text-[11px] text-slate-300">
                  The AP Clerk That Can&apos;t Be Tricked
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                AI extracts and explains. Code decides. Humans authorize exceptions.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Prominent DEMO / SIMULATION MODE Indicator */}
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs">
              <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="font-bold uppercase tracking-wider text-amber-300">
                {overview?.mode === 'live' ? 'LIVE MODE' : 'DEMO / SIMULATION MODE'}
              </span>
              <span className="hidden sm:inline text-[11px] text-amber-200/80">
                (No wallet funding required)
              </span>
            </div>

            {/* Emergency Kill Switch Status */}
            <button
              type="button"
              onClick={handleToggleKillSwitch}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer ${
                overview?.policy.kill_switch
                  ? 'border-rose-500 bg-rose-600 text-white'
                  : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-rose-500/50'
              }`}
            >
              <AlertOctagon className="h-3.5 w-3.5" />
              {overview?.policy.kill_switch ? 'KILL SWITCH: ACTIVE' : 'Kill Switch: Armed'}
            </button>

            <button
              type="button"
              onClick={() => setLightMode(!lightMode)}
              className="rounded-lg border border-slate-700 bg-slate-900 p-2 text-slate-300 hover:text-white cursor-pointer"
              title="Toggle Dark / Light Financial Operations Theme"
            >
              {lightMode ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* Main Layout */}
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col lg:flex-row gap-6 px-6 py-6">
        {/* Left Navigation Rail */}
        <aside className="w-full lg:w-60 shrink-0">
          <nav className="flex lg:flex-col gap-1 overflow-x-auto rounded-xl border border-slate-800/90 bg-slate-900/70 p-2">
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`flex items-center justify-between gap-2.5 rounded-lg px-3 py-2.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                      : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    {item.icon}
                    <span>{item.label}</span>
                  </div>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="rounded-full bg-amber-500/25 border border-amber-500/40 px-2 py-0.5 font-mono text-[10px] font-bold text-amber-300">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Policy Summary Card */}
          {overview?.policy && (
            <div className="mt-4 hidden lg:block rounded-xl border border-slate-800/90 bg-slate-900/60 p-4 text-xs">
              <div className="flex items-center gap-2 font-bold uppercase tracking-wider text-slate-400">
                <Lock className="h-3.5 w-3.5 text-emerald-400" />
                Active Policy Limits
              </div>
              <div className="mt-3 space-y-2 text-slate-300 font-mono text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-400">Auto-Pay Below:</span>
                  <span className="text-emerald-400 font-semibold">
                    ${overview.policy.auto_approve_below_usd}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Per-Invoice Cap:</span>
                  <span className="text-amber-300 font-semibold">
                    ${overview.policy.per_invoice_cap_usd}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Daily Hard Cap:</span>
                  <span className="text-slate-100 font-semibold">
                    ${overview.policy.daily_cap_usd}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Allowed Assets:</span>
                  <span className="text-slate-100">
                    {overview.policy.allowed_payout_assets.join(', ')}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Address Cooling:</span>
                  <span className="text-slate-100">
                    {overview.policy.address_change.cooling_off_hours}h
                  </span>
                </div>
              </div>
            </div>
          )}
        </aside>

        {/* Main Workspace Content */}
        <main className="min-w-0 flex-1 space-y-6">
          {statusMessage && (
            <div
              className={`flex items-center justify-between rounded-xl border px-4 py-3 text-xs font-medium ${
                statusMessage.type === 'ok'
                  ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-200'
                  : 'border-rose-500/50 bg-rose-950/50 text-rose-200'
              }`}
            >
              <span>{statusMessage.text}</span>
              <button
                type="button"
                onClick={() => setStatusMessage(null)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* ================================================================
              TAB 1: OVERVIEW DASHBOARD
             ================================================================ */}
          {activeTab === 'overview' && overview && (
            <div className="space-y-6">
              {/* Top Metric Cards */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4">
                  <div className="text-xs text-slate-400">Invoices Processed</div>
                  <div className="mt-1 font-mono text-2xl font-bold text-white">
                    {overview.metrics.totalInvoicesProcessed}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    {overview.metrics.verifiedVendorsCount} verified vendors
                  </div>
                </div>

                <div className="rounded-xl border border-emerald-500/30 bg-slate-900/80 p-4">
                  <div className="text-xs text-emerald-400">Total Amount Paid</div>
                  <div className="mt-1 font-mono text-2xl font-bold text-emerald-300">
                    ${overview.metrics.totalAmountPaidUsd.toFixed(2)}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    Exact-output USDC via 1Click
                  </div>
                </div>

                <div className="rounded-xl border border-amber-500/30 bg-slate-900/80 p-4">
                  <div className="text-xs text-amber-400">Pending Approvals (HOLD)</div>
                  <div className="mt-1 font-mono text-2xl font-bold text-amber-300">
                    {overview.metrics.pendingApprovalsCount}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    ${overview.metrics.totalAmountHeldUsd.toFixed(2)} awaiting controller
                  </div>
                </div>

                <div className="rounded-xl border border-rose-500/30 bg-slate-900/80 p-4">
                  <div className="text-xs text-rose-400">Blocked Suspicious / Fraud</div>
                  <div className="mt-1 font-mono text-2xl font-bold text-rose-300">
                    {overview.metrics.blockedSuspiciousCount}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    ${overview.metrics.totalAmountBlockedUsd.toFixed(2)} protected
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4">
                  <div className="text-xs text-slate-400">Authorized Settlement Rate</div>
                  <div className="mt-1 font-mono text-2xl font-bold text-white">
                    {overview.metrics.paymentSuccessRate}%
                  </div>
                  <div className="mt-1 text-[11px] text-emerald-400">
                    0 unauthorized payouts
                  </div>
                </div>
              </div>

              {/* Prominent Private AI Attestation Component */}
              {liveAttestation && (
                <PrivateAiVerifiedPanel
                  attestation={liveAttestation}
                  onRunLiveVerify={handleRunLiveAttestation}
                  verifying={verifyingAttestation}
                />
              )}

              {/* Recent Invoices & Recent Security Events Split */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {/* Recent Processed Invoices */}
                <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white">Recent AP Decisions</h3>
                    <button
                      type="button"
                      onClick={() => setActiveTab('invoices')}
                      className="text-xs text-emerald-400 hover:underline cursor-pointer"
                    >
                      Process Invoice →
                    </button>
                  </div>
                  <div className="mt-4 divide-y divide-slate-800/80">
                    {overview.recentInvoices.map((inv) => (
                      <div
                        key={inv.id}
                        className="flex items-center justify-between gap-3 py-3 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-slate-200">
                              {inv.invoiceNumber}
                            </span>
                            <span className="truncate font-medium text-slate-300">
                              {inv.vendorName}
                            </span>
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-slate-400">
                            {inv.decisionReasonSummary}
                          </div>
                        </div>
                        <div className="flex items-center gap-2.5 shrink-0">
                          <span className="font-mono font-semibold text-slate-200">
                            ${inv.total.toFixed(2)}
                          </span>
                          <span
                            className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${
                              inv.finalDecision === 'PAY'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                : inv.finalDecision === 'HOLD'
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                  : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                            }`}
                          >
                            {inv.finalDecision}
                          </span>
                          <button
                            type="button"
                            onClick={() => setInspectedInvoice(inv)}
                            className="rounded border border-slate-700 bg-slate-800 p-1 text-slate-300 hover:text-white cursor-pointer"
                            title="Inspect Pipeline Trace"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Recent Security Events */}
                <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white">Recent Defense & Security Events</h3>
                    <button
                      type="button"
                      onClick={() => setActiveTab('redteam')}
                      className="text-xs text-rose-400 hover:underline cursor-pointer"
                    >
                      Launch Red Team Lab →
                    </button>
                  </div>
                  <div className="mt-4 space-y-2.5">
                    {overview.recentSecurityEvents.map((ev) => (
                      <div
                        key={ev.id}
                        className={`rounded-lg border p-3 text-xs ${
                          ev.severity === 'CRITICAL'
                            ? 'border-rose-500/40 bg-rose-950/30 text-rose-200'
                            : 'border-amber-500/30 bg-amber-950/20 text-amber-200'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[10px] font-bold uppercase">
                            [{ev.severity} • {ev.category}]
                          </span>
                          <span className="font-mono text-[10px] text-slate-400">
                            {new Date(ev.createdAt).toLocaleTimeString()}
                          </span>
                        </div>
                        <div className="mt-1 font-semibold">{ev.title}</div>
                        <div className="mt-0.5 text-[11px] opacity-90">{ev.description}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================
              TAB 2: INVOICE WORKSPACE
             ================================================================ */}
          {activeTab === 'invoices' && (
            <div className="space-y-6">
              <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="text-base font-bold text-white">
                      Private Invoice Ingestion & Deterministic Evaluation Workspace
                    </h2>
                    <p className="mt-1 text-xs text-slate-400">
                      Submit a text invoice, upload a PDF (processed in ephemeral memory and
                      immediately zeroed), or select a synthetic test scenario.
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3.5 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25 cursor-pointer">
                    <Upload className="h-4 w-4" />
                    <span>Upload PDF Invoice (Ephemeral RAM)</span>
                    <input
                      type="file"
                      accept=".pdf,.txt"
                      onChange={handleUploadPdf}
                      className="hidden"
                    />
                  </label>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
                  <div className="space-y-3">
                    <label className="block text-xs font-semibold text-slate-300">
                      Select Synthetic Invoice Preset (10 Scenarios)
                    </label>
                    <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
                      {redTeamScenarios.map((sc) => (
                        <button
                          key={sc.id}
                          type="button"
                          onClick={() => handleSelectScenario(sc.id)}
                          className={`w-full rounded-lg border p-2.5 text-left text-xs transition-all cursor-pointer ${
                            selectedScenarioId === sc.id
                              ? 'border-emerald-500/60 bg-emerald-500/15 text-white'
                              : 'border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold truncate">{sc.title}</span>
                            <span
                              className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                                sc.expectedDecision === 'PAY'
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : sc.expectedDecision === 'HOLD'
                                    ? 'bg-amber-500/20 text-amber-300'
                                    : 'bg-rose-500/20 text-rose-300'
                              }`}
                            >
                              Expect: {sc.expectedDecision}
                            </span>
                          </div>
                          <div className="mt-1 text-[11px] text-slate-400 line-clamp-2">
                            {sc.attackDescription}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="lg:col-span-2 flex flex-col">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-semibold text-slate-300">
                        Untrusted Invoice Document Content (Ephemeral Buffer)
                      </label>
                      <span className="font-mono text-[11px] text-slate-400">
                        Model: {overview?.nearAiModel || 'Qwen/Qwen3.6-35B-A3B-FP8'}
                      </span>
                    </div>
                    <textarea
                      value={rawInvoiceInput}
                      onChange={(e) => setRawInvoiceInput(e.target.value)}
                      rows={12}
                      className="mt-2 w-full flex-1 rounded-xl border border-slate-800 bg-slate-950 p-3.5 font-mono text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
                      placeholder="Paste raw invoice text here..."
                    />
                    <div className="mt-3 flex items-center justify-between gap-4">
                      <span className="text-[11px] text-slate-400">
                        🔒 Raw invoice text is zeroed from RAM after extraction and never stored in
                        SQLite.
                      </span>
                      <button
                        type="button"
                        disabled={processingInvoice}
                        onClick={() => handleProcessInvoice()}
                        className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50 cursor-pointer"
                      >
                        <Play className="h-4 w-4" />
                        {processingInvoice
                          ? 'Running TEE Extraction & Policy Pipeline...'
                          : 'Analyze & Evaluate Invoice'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Latest Processed Result Trace */}
              {latestProcessed && (
                <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-6 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <span className="text-xs font-mono uppercase text-slate-400">
                        Latest Pipeline Execution Result
                      </span>
                      <h3 className="text-lg font-bold text-white">
                        Invoice #{latestProcessed.invoiceNumber} — {latestProcessed.vendorName} ($
                        {latestProcessed.total.toFixed(2)})
                      </h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-lg px-3 py-1 font-mono text-xs font-bold uppercase ${
                          latestProcessed.finalDecision === 'PAY'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            : latestProcessed.finalDecision === 'HOLD'
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                              : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                        }`}
                      >
                        Decision: {latestProcessed.finalDecision}
                      </span>
                      <button
                        type="button"
                        onClick={() => setInspectedInvoice(latestProcessed)}
                        className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer"
                      >
                        Open Full Security Trace
                      </button>
                    </div>
                  </div>

                  <PrivateAiVerifiedPanel attestation={latestProcessed.attestation} compact />
                </div>
              )}
            </div>
          )}

          {/* ================================================================
              TAB 3: HUMAN APPROVAL QUEUE
             ================================================================ */}
          {activeTab === 'approvals' && (
            <div className="space-y-6">
              <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-bold text-white">
                      Human Controller Exception Approval Queue ({heldInvoices.length} Pending)
                    </h2>
                    <p className="mt-1 text-xs text-slate-400">
                      Invoices placed on HOLD (e.g., ≥ $200 threshold, new vendor, or 48h address
                      cooling-off) require authenticated human review. Note: BLOCK decisions can
                      never be overridden.
                    </p>
                  </div>
                </div>

                {heldInvoices.length === 0 ? (
                  <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950/60 p-8 text-center text-xs text-slate-400">
                    No invoices currently held in the approval queue.
                  </div>
                ) : (
                  <div className="mt-5 space-y-4">
                    {heldInvoices.map((inv) => (
                      <div
                        key={inv.id}
                        className="rounded-xl border border-amber-500/30 bg-slate-950/80 p-5"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div>
                            <div className="flex items-center gap-2.5">
                              <span className="font-mono text-sm font-bold text-amber-300">
                                #{inv.invoiceNumber}
                              </span>
                              <span className="text-sm font-bold text-white">{inv.vendorName}</span>
                              <span className="rounded border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 font-mono text-[10px] font-bold text-amber-300">
                                HELD FOR CONTROLLER
                              </span>
                              <span className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-slate-300 uppercase">
                                {inv.mode}
                              </span>
                            </div>
                            <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-xs text-slate-300 sm:grid-cols-3">
                              <div>
                                <span className="text-slate-400">Amount:</span>{' '}
                                <strong className="font-mono text-white">
                                  ${inv.total.toFixed(2)} {inv.requestedPayoutAsset}
                                </strong>
                              </div>
                              <div>
                                <span className="text-slate-400">Destination:</span>{' '}
                                <code className="text-emerald-300">
                                  {inv.receivingWalletAddress} ({inv.requestedDestinationChain.toUpperCase()})
                                </code>
                              </div>
                              <div>
                                <span className="text-slate-400">Due Date:</span>{' '}
                                <span className="font-mono">{inv.dueDate}</span>
                              </div>
                              <div>
                                <span className="text-slate-400">Vendor Status:</span>{' '}
                                <span>
                                  {inv.vendorCheck.isNewVendor
                                    ? 'NEW UNVERIFIED VENDOR'
                                    : inv.vendorCheck.addressMatchesRegistry
                                      ? 'VERIFIED MATCH'
                                      : 'ADDRESS MISMATCH'}
                                </span>
                              </div>
                              <div>
                                <span className="text-slate-400">Risk Decision:</span>{' '}
                                <span className="font-mono font-semibold text-amber-300">
                                  {inv.riskAssessment.decision} ({inv.riskAssessment.riskScore}/100)
                                </span>
                              </div>
                              <div>
                                <span className="text-slate-400">TEE Attestation:</span>{' '}
                                <span
                                  className={
                                    inv.attestation.verified ? 'text-emerald-400' : 'text-rose-400'
                                  }
                                >
                                  {inv.attestation.verified ? '✓ Verified' : '✗ Failed'}
                                </span>
                              </div>
                            </div>

                            <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-950/20 p-2.5 text-xs text-amber-200">
                              <strong>Hold Reasons:</strong> {inv.decisionReasonSummary}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setInspectedInvoice(inv)}
                              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer"
                            >
                              View Details
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRejectInvoice(inv.id)}
                              className="rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-500/25 cursor-pointer"
                            >
                              Reject
                            </button>
                            <button
                              type="button"
                              onClick={() => handleApproveInvoice(inv.id)}
                              className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 cursor-pointer"
                            >
                              Approve & Pay
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ================================================================
              TAB 4: VENDOR REGISTRY & 48H COOLING-OFF
             ================================================================ */}
          {activeTab === 'vendors' && (
            <div className="space-y-6">
              <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-6">
                <h2 className="text-base font-bold text-white">
                  Verified Vendor Registry & 48-Hour Address Cooling-Off Controls
                </h2>
                <p className="mt-1 text-xs text-slate-400">
                  STEWARD never treats an invoice&apos;s own wallet address as proof of vendor
                  identity. New vendors require human approval, and any wallet change triggers a
                  48-hour cooling-off period.
                </p>

                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-800 text-slate-400 uppercase font-mono text-[11px]">
                      <tr>
                        <th className="py-2.5 pr-4">Vendor ID</th>
                        <th className="py-2.5 pr-4">Business Name</th>
                        <th className="py-2.5 pr-4">Verified Wallet Address</th>
                        <th className="py-2.5 pr-4">Chain / Asset</th>
                        <th className="py-2.5 pr-4">Status</th>
                        <th className="py-2.5 pr-4">Payments</th>
                        <th className="py-2.5">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {vendors.map((v) => (
                        <tr key={v.id}>
                          <td className="py-3 pr-4 font-mono text-slate-300">{v.id}</td>
                          <td className="py-3 pr-4 font-semibold text-white">{v.businessName}</td>
                          <td className="py-3 pr-4 font-mono text-emerald-300">
                            {v.verifiedWalletAddress}
                          </td>
                          <td className="py-3 pr-4 font-mono uppercase text-slate-300">
                            {v.preferredDestinationChain} / {v.preferredPayoutAsset}
                          </td>
                          <td className="py-3 pr-4">
                            <span
                              className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold ${
                                v.status === 'VERIFIED'
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : 'bg-amber-500/20 text-amber-300'
                              }`}
                            >
                              {v.status}
                            </span>
                            {v.coolingOffUntil && (
                              <div className="mt-1 text-[10px] text-amber-300 font-mono">
                                Cooling until {new Date(v.coolingOffUntil).toLocaleString()}
                              </div>
                            )}
                          </td>
                          <td className="py-3 pr-4 font-mono text-slate-300">
                            {v.paymentCount} (${v.totalPaidUsd.toFixed(2)})
                          </td>
                          <td className="py-3">
                            {v.status !== 'VERIFIED' && (
                              <button
                                type="button"
                                onClick={async () => {
                                  await fetch(`/api/vendors/${v.id}/verify`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      approvedBy: 'controller@steward-ap.finance',
                                    }),
                                  });
                                  await refreshAllData();
                                }}
                                className="rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500 cursor-pointer"
                              >
                                Confirm & Verify
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Add Vendor & Test 48-Hour Address Rotation Forms */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <form
                  onSubmit={handleCreateVendor}
                  className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 space-y-3"
                >
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Plus className="h-4 w-4 text-emerald-400" />
                    Onboard New Vendor (Enters PENDING_APPROVAL)
                  </h3>
                  <input
                    type="text"
                    placeholder="Business Name (e.g., Lagos Cloud Services)"
                    value={newVendorName}
                    onChange={(e) => setNewVendorName(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="Wallet Address (e.g., vendor.near)"
                      value={newVendorWallet}
                      onChange={(e) => setNewVendorWallet(e.target.value)}
                      className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-mono text-white"
                    />
                    <select
                      value={newVendorChain}
                      onChange={(e) => setNewVendorChain(e.target.value as SupportedChain)}
                      className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                    >
                      <option value="near">NEAR</option>
                      <option value="arbitrum">Arbitrum</option>
                      <option value="solana">Solana</option>
                      <option value="ethereum">Ethereum</option>
                      <option value="base">Base</option>
                    </select>
                  </div>
                  <button
                    type="submit"
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 cursor-pointer"
                  >
                    Register Vendor (Requires Human Approval)
                  </button>
                </form>

                <form
                  onSubmit={handleRotateVendorAddress}
                  className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 space-y-3"
                >
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Clock className="h-4 w-4 text-amber-400" />
                    Rotate Vendor Wallet (Triggers 48-Hour Cooling-Off Lock)
                  </h3>
                  <select
                    value={rotateVendorId}
                    onChange={(e) => setRotateVendorId(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                  >
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.businessName} ({v.verifiedWalletAddress})
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    placeholder="New Wallet Address"
                    value={rotateNewAddress}
                    onChange={(e) => setRotateNewAddress(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-mono text-white"
                  />
                  <button
                    type="submit"
                    className="rounded-lg border border-amber-500/40 bg-amber-500/20 px-4 py-2 text-xs font-bold text-amber-200 hover:bg-amber-500/30 cursor-pointer"
                  >
                    Initiate Wallet Change (48h Cooling-Off)
                  </button>
                </form>
              </div>

              {/* Immutable Vendor Address Change History */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-6">
                <h3 className="text-sm font-bold text-white">
                  Immutable Vendor Wallet Address Audit Log
                </h3>
                <div className="mt-3 space-y-2">
                  {vendorHistory.map((h) => (
                    <div
                      key={h.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/70 px-3.5 py-2.5 text-xs"
                    >
                      <div>
                        <span className="font-semibold text-white">{h.businessName}</span>:{' '}
                        <code className="text-slate-400">{h.previousAddress || 'INITIAL'}</code> →{' '}
                        <code className="text-emerald-300">{h.newAddress}</code>
                        <span className="ml-2 text-slate-400">({h.reason})</span>
                      </div>
                      <div className="font-mono text-[11px] text-slate-400">
                        By {h.changedBy} at {new Date(h.timestamp).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ================================================================
              TAB 5: NEAR INTENTS 1CLICK TRANSACTIONS
             ================================================================ */}
          {activeTab === 'transactions' && (
            <div className="space-y-6">
              {/* Live 1Click Exact-Output Quote Calculator */}
              <div className="rounded-xl border border-indigo-500/30 bg-slate-900/80 p-6">
                <h2 className="text-base font-bold text-white">
                  NEAR Intents 1Click API — Live Exact-Output Quote Tester
                </h2>
                <p className="mt-1 text-xs text-slate-400">
                  Queries <code>POST https://1click.chaindefuser.com/v0/quote</code> with{' '}
                  <code>swapType: &quot;EXACT_OUTPUT&quot;</code> so the vendor receives the exact
                  billed amount while any unspent slippage buffer refunds to the STEWARD treasury.
                </p>

                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
                  <select
                    value={quoteChain}
                    onChange={(e) => setQuoteChain(e.target.value as SupportedChain)}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                  >
                    <option value="near">NEAR (nep141 USDC)</option>
                    <option value="arbitrum">Arbitrum (omft USDC)</option>
                    <option value="solana">Solana (omft USDC)</option>
                    <option value="ethereum">Ethereum (omft USDC)</option>
                  </select>
                  <input
                    type="number"
                    value={quoteAmount}
                    onChange={(e) => setQuoteAmount(e.target.value)}
                    placeholder="Exact Output USD"
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-mono text-white"
                  />
                  <input
                    type="text"
                    value={quoteRecipient}
                    onChange={(e) => setQuoteRecipient(e.target.value)}
                    placeholder="Recipient Address"
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-mono text-white"
                  />
                  <button
                    type="button"
                    disabled={loadingQuote}
                    onClick={handleFetch1ClickQuote}
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-500 cursor-pointer"
                  >
                    {loadingQuote ? 'Querying 1Click Solver...' : 'Fetch Live EXACT_OUTPUT Quote'}
                  </button>
                </div>

                {quotePreview && (
                  <pre className="mt-4 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-[11px] text-emerald-300">
                    {JSON.stringify(quotePreview, null, 2)}
                  </pre>
                )}
              </div>

              {/* Payment Execution Records Table */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-6">
                <h3 className="text-sm font-bold text-white">
                  Payment Execution & Settlement Records ({payments.length})
                </h3>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-800 font-mono text-[11px] uppercase text-slate-400">
                      <tr>
                        <th className="py-2.5 pr-4">Payment ID / Mode</th>
                        <th className="py-2.5 pr-4">Quote ID</th>
                        <th className="py-2.5 pr-4">Exact Output</th>
                        <th className="py-2.5 pr-4">Est. Input / Fee</th>
                        <th className="py-2.5 pr-4">Recipient</th>
                        <th className="py-2.5 pr-4">Status</th>
                        <th className="py-2.5">Source / Proof</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {payments.map((p) => (
                        <tr key={p.id}>
                          <td className="py-3 pr-4 font-mono">
                            <div className="text-slate-200">{p.id}</div>
                            <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] text-indigo-300 uppercase">
                              {p.mode}
                            </span>
                          </td>
                          <td className="py-3 pr-4 font-mono text-slate-300">
                            {p.quoteId || 'N/A'}
                          </td>
                          <td className="py-3 pr-4 font-mono font-bold text-emerald-300">
                            {p.exactRequestedOutput}
                          </td>
                          <td className="py-3 pr-4 font-mono text-slate-300">
                            {p.estimatedInputAmount} (Fee: ${p.feesUsd.toFixed(4)})
                          </td>
                          <td className="py-3 pr-4 font-mono text-slate-200">
                            {p.recipientAddress} ({p.destinationChain.toUpperCase()})
                          </td>
                          <td className="py-3 pr-4">
                            <span
                              className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold ${
                                p.status === 'PAID'
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : p.status === 'PENDING'
                                    ? 'bg-amber-500/20 text-amber-300'
                                    : 'bg-rose-500/20 text-rose-300'
                              }`}
                            >
                              {p.status}
                            </span>
                          </td>
                          <td className="py-3 font-mono text-[11px] text-slate-400">
                            {p.explorerUrl ? (
                              <a
                                href={p.explorerUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-emerald-400 underline"
                              >
                                View Explorer
                              </a>
                            ) : (
                              p.statusSource
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================
              TAB 6: RISK & SECURITY CENTER
             ================================================================ */}
          {activeTab === 'security' && (
            <div className="space-y-6">
              {liveAttestation && (
                <PrivateAiVerifiedPanel
                  attestation={liveAttestation}
                  onRunLiveVerify={handleRunLiveAttestation}
                  verifying={verifyingAttestation}
                />
              )}

              {/* Live NEAR RPC Account & Smart Contract Intelligence Inspector */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-6">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-emerald-400" />
                  Live NEAR RPC Counterparty & Smart Contract Inspector
                </h3>
                <p className="mt-1 text-xs text-slate-400">
                  Queries live NEAR RPC (<code>view_account</code> &{' '}
                  <code>view_access_key_list</code>) to inspect account existence, balance, storage
                  footprint, contract bytecode deployment (<code>code_hash</code>), and access keys.
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={rpcAccountInput}
                    onChange={(e) => setRpcAccountInput(e.target.value)}
                    placeholder="Enter NEAR account (e.g., wrap.near, intents.near, system.near)"
                    className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs font-mono text-white"
                  />
                  <button
                    type="button"
                    disabled={inspectingRpc}
                    onClick={handleInspectNearAccount}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 cursor-pointer"
                  >
                    {inspectingRpc ? 'Inspecting NEAR RPC...' : 'Inspect Account on NEAR RPC'}
                  </button>
                </div>

                {rpcIntel && (
                  <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-xs text-slate-200 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <div>
                      <span className="text-slate-400">Account Exists:</span>{' '}
                      <strong className={rpcIntel.accountExists ? 'text-emerald-400' : 'text-rose-400'}>
                        {String(rpcIntel.accountExists)}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-400">NEAR Balance:</span>{' '}
                      <strong>{rpcIntel.balanceNearFormatted || '0 NEAR'}</strong>
                    </div>
                    <div>
                      <span className="text-slate-400">Smart Contract Deployed:</span>{' '}
                      <strong className={rpcIntel.isSmartContract ? 'text-amber-300' : 'text-emerald-300'}>
                        {rpcIntel.isSmartContract ? 'YES (Contract)' : 'NO (Standard EOA)'}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-400">Storage Usage:</span>{' '}
                      <span>{rpcIntel.storageUsageBytes ?? 'N/A'} Bytes</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Access Keys:</span>{' '}
                      <span>
                        {rpcIntel.accessKeyCount ?? 'N/A'} (Full: {rpcIntel.fullAccessKeyCount ?? '-'}
                        , FnCall: {rpcIntel.functionCallKeyCount ?? '-'})
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400">Block Height / Latency:</span>{' '}
                      <span>
                        #{rpcIntel.blockHeight ?? 'N/A'} ({rpcIntel.rpcLatencyMs}ms)
                      </span>
                    </div>
                    <div className="sm:col-span-3 text-[11px] text-slate-400 truncate">
                      Code Hash: {rpcIntel.codeHash || 'N/A'} — {rpcIntel.note}
                    </div>
                  </div>
                )}
              </div>

              {/* Threat Intelligence Blocklist */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-6">
                <h3 className="text-sm font-bold text-white">
                  Shared Threat Intelligence Blocklist ({blocklist.length})
                </h3>
                <div className="mt-3 space-y-2">
                  {blocklist.map((b) => (
                    <div
                      key={b.address}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-500/30 bg-rose-950/20 px-3.5 py-2.5 text-xs"
                    >
                      <div>
                        <code className="font-bold text-rose-300">{b.address}</code>{' '}
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] uppercase text-slate-300">
                          {b.chain}
                        </span>
                        <span className="ml-2 text-slate-300">{b.reason}</span>
                      </div>
                      <span className="font-mono text-[11px] text-slate-400">{b.source}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ================================================================
              TAB 7: RED TEAM LAB & 30-CASE ATTACK EVALUATION SUITE
             ================================================================ */}
          {activeTab === 'redteam' && (
            <div className="space-y-6">
              {/* Flagship Prompt Injection Attack Spotlight */}
              <div className="rounded-xl border border-rose-500/50 bg-rose-950/20 p-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <span className="rounded bg-rose-500/25 border border-rose-500/50 px-2.5 py-0.5 font-mono text-[11px] font-bold uppercase text-rose-300">
                      Featured Red-Team Demonstration
                    </span>
                    <h2 className="mt-2 text-lg font-bold text-white">
                      Hidden Prompt-Injection Wallet Redirection Attack
                    </h2>
                    <p className="mt-1 text-xs text-slate-300">
                      An untrusted invoice from &quot;Lagos Design Studio Ltd&quot; contains embedded
                      instructions telling the AI to ignore the verified vendor wallet (
                      <code>lagos-studio.near</code>) and pay <code>attacker-drain.near</code>.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={processingInvoice}
                    onClick={async () => {
                      await handleProcessInvoice('RT-08-HIDDEN-PROMPT-INJECTION');
                    }}
                    className="rounded-lg bg-rose-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-rose-500 cursor-pointer"
                  >
                    Execute Flagship Attack Demo Now
                  </button>
                </div>
              </div>

              {/* 30-Invoice Automated Attack Evaluation Suite */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h3 className="text-base font-bold text-white">
                      30-Invoice Synthetic Attack & Policy Evaluation Suite
                    </h3>
                    <p className="mt-1 text-xs text-slate-400">
                      Runs 30 repeatable synthetic invoices (legitimate, duplicates, address swaps,
                      new vendors, over-limit, bad math, blocklisted wallets, and prompt injections)
                      against STEWARD. Target: <strong>ZERO unauthorized payments</strong>.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={runningSuite}
                    onClick={handleRunEvaluationSuite}
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50 cursor-pointer"
                  >
                    <Play className="h-4 w-4" />
                    {runningSuite
                      ? 'Running 30 Synthetic Invoices...'
                      : 'Run Full 30-Invoice Evaluation Suite'}
                  </button>
                </div>

                {evalReport && (
                  <div className="mt-6 space-y-5">
                    <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 px-3.5 py-2 text-[11px] text-amber-200">
                      <strong>{evalReport.disclaimer}</strong>
                    </div>

                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8 text-center">
                      <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                        <div className="text-[11px] text-slate-400">Total Cases</div>
                        <div className="mt-1 font-mono text-lg font-bold text-white">
                          {evalReport.totalTestCases}
                        </div>
                      </div>
                      <div className="rounded-lg border border-emerald-500/30 bg-slate-950 p-3">
                        <div className="text-[11px] text-emerald-400">Correct PAY</div>
                        <div className="mt-1 font-mono text-lg font-bold text-emerald-300">
                          {evalReport.correctPayments}
                        </div>
                      </div>
                      <div className="rounded-lg border border-amber-500/30 bg-slate-950 p-3">
                        <div className="text-[11px] text-amber-400">Correct HOLD</div>
                        <div className="mt-1 font-mono text-lg font-bold text-amber-300">
                          {evalReport.correctHolds}
                        </div>
                      </div>
                      <div className="rounded-lg border border-rose-500/30 bg-slate-950 p-3">
                        <div className="text-[11px] text-rose-400">Correct BLOCK</div>
                        <div className="mt-1 font-mono text-lg font-bold text-rose-300">
                          {evalReport.correctBlocks}
                        </div>
                      </div>
                      <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                        <div className="text-[11px] text-slate-400">False Blocks</div>
                        <div className="mt-1 font-mono text-lg font-bold text-white">
                          {evalReport.falseBlocks}
                        </div>
                      </div>
                      <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                        <div className="text-[11px] text-slate-400">False Approvals</div>
                        <div className="mt-1 font-mono text-lg font-bold text-emerald-400">
                          {evalReport.falseApprovals}
                        </div>
                      </div>
                      <div className="rounded-lg border border-emerald-500/50 bg-emerald-950/30 p-3">
                        <div className="text-[11px] font-bold text-emerald-300">
                          Unauthorized Pay
                        </div>
                        <div className="mt-1 font-mono text-lg font-bold text-emerald-300">
                          {evalReport.unauthorizedPayments}
                        </div>
                      </div>
                      <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                        <div className="text-[11px] text-slate-400">Median Time</div>
                        <div className="mt-1 font-mono text-lg font-bold text-white">
                          {evalReport.medianDecisionTimeMs}ms
                        </div>
                      </div>
                    </div>

                    <div className="overflow-x-auto max-h-96">
                      <table className="w-full text-left text-xs">
                        <thead className="border-b border-slate-800 font-mono text-[11px] uppercase text-slate-400">
                          <tr>
                            <th className="py-2 pr-3">Case</th>
                            <th className="py-2 pr-3">Category</th>
                            <th className="py-2 pr-3">Expected</th>
                            <th className="py-2 pr-3">Actual</th>
                            <th className="py-2 pr-3">Unauth Pay</th>
                            <th className="py-2 pr-3">Time</th>
                            <th className="py-2">Deterministic Reason</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/70">
                          {evalReport.results.map((r) => (
                            <tr key={r.id}>
                              <td className="py-2 pr-3 font-semibold text-white">{r.title}</td>
                              <td className="py-2 pr-3 font-mono text-[11px] text-slate-300">
                                {r.category}
                              </td>
                              <td className="py-2 pr-3 font-mono font-bold text-slate-200">
                                {r.expectedDecision}
                              </td>
                              <td className="py-2 pr-3 font-mono font-bold text-emerald-400">
                                {r.actualDecision}
                              </td>
                              <td className="py-2 pr-3 font-mono text-emerald-400">
                                {r.unauthorizedPaymentOccurred ? 'YES' : '0 (NONE)'}
                              </td>
                              <td className="py-2 pr-3 font-mono text-slate-400">
                                {r.decisionTimeMs}ms
                              </td>
                              <td className="py-2 text-[11px] text-slate-400 max-w-md truncate">
                                {r.reasonSummary}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ================================================================
              TAB 8: ACCOUNTANT-READY AUDIT LEDGER & CSV EXPORT
             ================================================================ */}
          {activeTab === 'ledger' && (
            <div className="space-y-6">
              <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="text-base font-bold text-white">
                      Accountant-Ready Financial Audit Ledger ({filteredLedger.length} Rows)
                    </h2>
                    <p className="mt-1 text-xs text-slate-400">
                      Complete audit trail with ISO-8601 timestamps, quote IDs, fees, decision
                      reasons, and formula-injection-safe CSV export for Excel and Google Sheets.
                    </p>
                  </div>
                  <a
                    href="/api/ledger/csv"
                    download
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-500"
                  >
                    <Download className="h-4 w-4" />
                    Export Accountant CSV
                  </a>
                </div>

                {/* Search & Filters */}
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
                  <div className="sm:col-span-2 relative">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      value={ledgerSearch}
                      onChange={(e) => setLedgerSearch(e.target.value)}
                      placeholder="Search by invoice #, vendor, wallet, or policy reason..."
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 pl-9 pr-3 py-2 text-xs text-white"
                    />
                  </div>
                  <select
                    value={ledgerStatusFilter}
                    onChange={(e) => setLedgerStatusFilter(e.target.value)}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                  >
                    <option value="ALL">All Statuses</option>
                    <option value="PAID">PAID</option>
                    <option value="HELD">HELD</option>
                    <option value="BLOCKED">BLOCKED</option>
                    <option value="PENDING">PENDING</option>
                  </select>
                  <select
                    value={ledgerModeFilter}
                    onChange={(e) => setLedgerModeFilter(e.target.value)}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                  >
                    <option value="ALL">All Modes (SIMULATED + LIVE)</option>
                    <option value="SIMULATION">SIMULATED ONLY</option>
                    <option value="LIVE">LIVE ONLY</option>
                  </select>
                </div>

                {/* Ledger Table */}
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-800 font-mono text-[11px] uppercase text-slate-400">
                      <tr>
                        <th className="py-2.5 pr-3">Invoice #</th>
                        <th className="py-2.5 pr-3">Vendor</th>
                        <th className="py-2.5 pr-3">Amount</th>
                        <th className="py-2.5 pr-3">Asset / Chain</th>
                        <th className="py-2.5 pr-3">Mode</th>
                        <th className="py-2.5 pr-3">Status</th>
                        <th className="py-2.5 pr-3">Approved By</th>
                        <th className="py-2.5 pr-3">Decision Reason</th>
                        <th className="py-2.5">Trace</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {filteredLedger.map((inv) => (
                        <tr key={inv.id}>
                          <td className="py-3 pr-3 font-mono font-bold text-slate-200">
                            {inv.invoiceNumber}
                          </td>
                          <td className="py-3 pr-3 font-medium text-white">{inv.vendorName}</td>
                          <td className="py-3 pr-3 font-mono font-semibold text-white">
                            ${inv.total.toFixed(2)}
                          </td>
                          <td className="py-3 pr-3 font-mono text-slate-300">
                            {inv.requestedPayoutAsset} ({inv.requestedDestinationChain.toUpperCase()})
                          </td>
                          <td className="py-3 pr-3">
                            <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] uppercase text-slate-300">
                              {inv.mode}
                            </span>
                          </td>
                          <td className="py-3 pr-3">
                            <span
                              className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${
                                inv.paymentStatus === 'PAID'
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : inv.paymentStatus === 'HELD'
                                    ? 'bg-amber-500/20 text-amber-300'
                                    : 'bg-rose-500/20 text-rose-300'
                              }`}
                            >
                              {inv.paymentStatus}
                            </span>
                          </td>
                          <td className="py-3 pr-3 font-mono text-[11px] text-slate-300">
                            {inv.approvedBy || 'N/A'}
                          </td>
                          <td
                            className="py-3 pr-3 max-w-xs truncate text-[11px] text-slate-400"
                            title={inv.decisionReasonSummary}
                          >
                            {inv.decisionReasonSummary}
                          </td>
                          <td className="py-3">
                            <button
                              type="button"
                              onClick={() => setInspectedInvoice(inv)}
                              className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700 cursor-pointer"
                            >
                              Inspect
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================
              TAB 9: SETTINGS & DETERMINISTIC POLICY ENGINE
             ================================================================ */}
          {activeTab === 'settings' && overview?.policy && (
            <div className="space-y-6">
              <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-6">
                <h2 className="text-base font-bold text-white">
                  Deterministic Payment Policy & Autonomous Business Controls
                </h2>
                <p className="mt-1 text-xs text-slate-400">
                  All financial thresholds are enforced server-side in SQLite & YAML independent of
                  the AI model. The AI model cannot read or mutate these rules.
                </p>

                <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                    <label className="text-xs text-slate-400">
                      Auto-Approve Threshold (USD)
                    </label>
                    <div className="mt-1 font-mono text-xl font-bold text-emerald-400">
                      ${overview.policy.auto_approve_below_usd}
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Verified invoices below this amount execute automatically.
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                    <label className="text-xs text-slate-400">
                      Per-Invoice Hard Cap (USD)
                    </label>
                    <div className="mt-1 font-mono text-xl font-bold text-amber-300">
                      ${overview.policy.per_invoice_cap_usd}
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Invoices above this amount are automatically BLOCKED.
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                    <label className="text-xs text-slate-400">Daily Spend Cap (USD)</label>
                    <div className="mt-1 font-mono text-xl font-bold text-white">
                      ${overview.policy.daily_cap_usd}
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Maximum cumulative autonomous + approved spend per 24h.
                    </p>
                  </div>
                </div>

                {/* Custody & Security Architecture Disclosure */}
                <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950 p-5 text-xs space-y-2">
                  <div className="font-bold text-white uppercase tracking-wider">
                    Treasury Custody Architecture & Security Boundaries
                  </div>
                  <p className="text-slate-300">
                    • <strong>Primary Custody (OutLayer Agent Custody):</strong> Integrates with{' '}
                    <code>https://api.outlayer.ai</code> via <code>@outlayer/sdk</code> where
                    signing keys reside inside an Intel TDX enclave with TEE-enforced spending
                    policies.
                  </p>
                  <p className="text-slate-300">
                    • <strong>Mainnet Safety Lock:</strong>{' '}
                    <code>ALLOW_MAINNET_EXECUTION={String(overview.allowMainnetExecution)}</code>.
                    STEWARD will never spend real mainnet funds without explicit product-owner
                    authorization.
                  </p>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Pipeline Trace Modal */}
      <PipelineTraceModal
        invoice={inspectedInvoice}
        onClose={() => setInspectedInvoice(null)}
        onApprove={handleApproveInvoice}
        onReject={handleRejectInvoice}
      />
    </div>
  );
};
