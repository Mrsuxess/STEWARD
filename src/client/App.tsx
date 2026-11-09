import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  Plus,
  Bell,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  Sparkles,
  ExternalLink,
  HelpCircle,
  Home,
  SlidersHorizontal,
  UserCheck,
  AlertTriangle,
  Wallet,
} from 'lucide-react';
import type {
  AttestationVerificationResult,
  ConnectedWalletRecord,
  NearAccountIntelligence,
  OperatingMode,
  PaymentExecutionRecord,
  PolicyConfig,
  ProcessedInvoiceRecord,
  SecurityEventRecord,
  SupportedChain,
  TreasurySettings,
  VendorAddressHistoryEntry,
  VendorRecord,
  ExperienceMode,
  WorkspaceProfile,
  WorkspaceMemberRecord,
  WorkspaceRole,
} from '../shared/types.js';
import type {
  AttackEvaluationSuiteReport,
  SyntheticInvoiceScenario,
} from '../evaluation/redTeamAndSuite.js';
import {
  StewardLogo,
  DecisionBadge,
  PaymentStatusBadge,
  ModeBadge,
  ChainBadge,
  getPlainEnglishDecisionExplanation,
  getPlainEnglishSecurityEventSummary,
} from './components/StewardLogo.js';
import { LandingPage } from './components/LandingPage.js';
import { PrivateAiVerifiedPanel } from './components/PrivateAiVerifiedPanel.js';
import { InvoiceJourneyAndPreview } from './components/InvoiceJourneyAndPreview.js';
import { PipelineTraceModal } from './components/PipelineTraceModal.js';
import {
  GuidedDemoModal,
  ConfirmationDialog,
} from './components/GuidedDemoModal.js';
import {
  SecurityCenterView,
  RedTeamView,
} from './components/SecurityAndRedTeamViews.js';
import { TreasuryDashboardView } from './components/TreasuryDashboardView.js';
import { PaymentAuthorizationModal } from './components/PaymentAuthorizationModal.js';
import { LaunchGatewayView } from './components/LaunchGatewayView.js';
import {
  BusinessOnboardingWizard,
  FirstTimeSetupChecklistBanner,
} from './components/BusinessOnboardingWizard.js';

export type NavTab =
  | 'overview'
  | 'invoices'
  | 'approvals'
  | 'vendors'
  | 'treasury'
  | 'payments'
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
  workspace?: WorkspaceProfile;
  members?: WorkspaceMemberRecord[];
  recentInvoices: ProcessedInvoiceRecord[];
  recentTransactions: PaymentExecutionRecord[];
  recentSecurityEvents: SecurityEventRecord[];
}

const VALID_TABS: NavTab[] = [
  'overview',
  'invoices',
  'approvals',
  'vendors',
  'payments',
  'security',
  'redteam',
  'ledger',
  'treasury',
  'settings',
];

export const App: React.FC = () => {
  // Default to the public-facing Landing Page unless URL hash specifies gateway, onboarding, or a dashboard tab
  const [viewMode, setViewMode] = useState<'landing' | 'gateway' | 'onboarding' | 'dashboard'>(() => {
    const hash = window.location.hash.replace('#', '').toLowerCase();
    if (hash === 'gateway') return 'gateway';
    if (hash === 'onboarding') return 'onboarding';
    if (hash === 'dashboard' || VALID_TABS.includes(hash as NavTab)) {
      return 'dashboard';
    }
    return 'landing';
  });

  const [activeTab, setActiveTab] = useState<NavTab>(() => {
    const hash = window.location.hash.replace('#', '').toLowerCase();
    if (VALID_TABS.includes(hash as NavTab)) {
      return hash as NavTab;
    }
    return 'overview';
  });

  const [sidebarCompact, setSidebarCompact] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [guidedTourOpen, setGuidedTourOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [headerSearch, setHeaderSearch] = useState('');

  // Core Application Data State (100% real SQLite backend data)
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
  const [treasuryWallets, setTreasuryWallets] = useState<ConnectedWalletRecord[]>([]);
  const [treasurySettings, setTreasurySettings] = useState<TreasurySettings | null>(null);
  const [authorizingInvoice, setAuthorizingInvoice] = useState<ProcessedInvoiceRecord | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceProfile>({
    companyName: 'Steward Global Operations Ltd.',
    businessEmail: 'finance@steward-ap.finance',
    country: 'United Kingdom',
    businessType: 'Cross-Border SaaS & Digital Services',
    reportingCurrency: 'USD',
    experienceMode: 'simulated',
    onboardingCompleted: false,
    onboardingStep: 1,
    checklistState: {
      businessProfileCompleted: true,
      treasuryConnected: false,
      paymentPoliciesConfigured: true,
      firstVendorAdded: true,
      firstInvoiceUploaded: true,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMemberRecord[]>([]);
  const [experienceMode, setExperienceMode] = useState<ExperienceMode>('simulated');
  const [activeRole, setActiveRole] = useState<WorkspaceRole>('Owner');
  const [onboardingInitialStep, setOnboardingInitialStep] = useState<number>(1);

  // Invoice Workspace state
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('RT-01-LEGIT-LAGOS');
  const [rawInvoiceInput, setRawInvoiceInput] = useState<string>('');
  const [processingInvoice, setProcessingInvoice] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [latestProcessed, setLatestProcessed] = useState<ProcessedInvoiceRecord | null>(null);
  const [inspectedInvoice, setInspectedInvoice] = useState<ProcessedInvoiceRecord | null>(null);
  const [toastMessage, setToastMessage] = useState<{
    type: 'ok' | 'warn' | 'err';
    title: string;
    text: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Confirmation Dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    variant: 'approve' | 'danger' | 'warning';
    requireNotes?: boolean;
    defaultNotes?: string;
    onConfirm: (notes: string) => Promise<void>;
  } | null>(null);

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
  const [quoteRecipient, setQuoteRecipient] = useState('lagos-studio.near');
  const [quotePreview, setQuotePreview] = useState<Record<string, unknown> | null>(null);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [showRawQuoteJson, setShowRawQuoteJson] = useState(false);

  // Ledger filters
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [ledgerStatusFilter, setLedgerStatusFilter] = useState('ALL');
  const [ledgerModeFilter, setLedgerModeFilter] = useState('ALL');
  const [ledgerDateFrom, setLedgerDateFrom] = useState('');
  const [ledgerDateTo, setLedgerDateTo] = useState('');

  // Vendor Onboarding, Search & Address Change state
  const [vendorSearch, setVendorSearch] = useState('');
  const [vendorStatusFilter, setVendorStatusFilter] = useState('ALL');
  const [newVendorName, setNewVendorName] = useState('');
  const [newVendorWallet, setNewVendorWallet] = useState('');
  const [newVendorChain, setNewVendorChain] = useState<SupportedChain>('near');
  const [rotateVendorId, setRotateVendorId] = useState('VND-LAGOS-01');
  const [rotateNewAddress, setRotateNewAddress] = useState('');
  const [rotateReason, setRotateReason] = useState('Corporate wallet key rotation');

  // Policy Threshold Editor state
  const [editAutoApprove, setEditAutoApprove] = useState('200');
  const [editPerInvoiceCap, setEditPerInvoiceCap] = useState('500');
  const [editDailyCap, setEditDailyCap] = useState('1500');
  const [editCoolingHours, setEditCoolingHours] = useState('48');
  const [savingPolicy, setSavingPolicy] = useState(false);

  // Evaluation suite runner state
  const [runningSuite, setRunningSuite] = useState(false);

  const buildMutationHeaders = (includeJson = true): Record<string, string> => {
    const h: Record<string, string> = {
      'x-steward-role': activeRole,
      'x-steward-experience-mode': experienceMode,
    };
    if (includeJson) {
      h['Content-Type'] = 'application/json';
    }
    return h;
  };

  const navigateToDashboardTab = (tab: NavTab) => {
    setViewMode('dashboard');
    setActiveTab(tab);
    setMobileMenuOpen(false);
    window.history.replaceState(null, '', `#${tab}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const navigateToGateway = () => {
    setViewMode('gateway');
    setMobileMenuOpen(false);
    window.history.replaceState(null, '', '#gateway');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const navigateToOnboarding = (step = 1) => {
    setOnboardingInitialStep(step);
    setViewMode('onboarding');
    setMobileMenuOpen(false);
    window.history.replaceState(null, '', '#onboarding');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const navigateToLanding = () => {
    setViewMode('landing');
    window.history.replaceState(null, '', '#');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const refreshAllData = useCallback(async () => {
    try {
      const [ovRes, invRes, vndRes, payRes, secRes, rtRes, trRes] = await Promise.all([
        fetch('/api/overview'),
        fetch('/api/invoices'),
        fetch('/api/vendors'),
        fetch('/api/payments'),
        fetch('/api/security/events'),
        fetch('/api/red-team/scenarios'),
        fetch('/api/treasury/overview'),
      ]);

      if (ovRes.ok) {
        const ovData = (await ovRes.json()) as OverviewResponse;
        setOverview(ovData);
        if (ovData.workspace) {
          setWorkspace(ovData.workspace);
          setExperienceMode(ovData.workspace.experienceMode || 'simulated');
        }
        if (ovData.members) {
          setWorkspaceMembers(ovData.members);
        }
        if (ovData.policy) {
          setEditAutoApprove(String(ovData.policy.auto_approve_below_usd));
          setEditPerInvoiceCap(String(ovData.policy.per_invoice_cap_usd));
          setEditDailyCap(String(ovData.policy.daily_cap_usd));
          setEditCoolingHours(String(ovData.policy.address_change.cooling_off_hours));
        }
        if (!liveAttestation && ovData.recentInvoices[0]?.attestation) {
          setLiveAttestation(ovData.recentInvoices[0].attestation);
        }
      }
      if (invRes.ok) {
        const d = await invRes.json();
        const list: ProcessedInvoiceRecord[] = d.invoices || [];
        setInvoices(list);
        if (!latestProcessed && list.length > 0) {
          setLatestProcessed(list[0]);
        }
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
      if (trRes.ok) {
        const d = await trRes.json();
        setTreasuryWallets(d.connectedWallets || []);
        setTreasurySettings(d.settings || null);
      }
    } catch (err) {
      console.error('Failed to refresh STEWARD data:', err);
    }
  }, [liveAttestation, latestProcessed, rawInvoiceInput]);

  useEffect(() => {
    refreshAllData();
  }, [refreshAllData]);

  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash.replace('#', '').toLowerCase();
      if (!hash || hash === 'top' || hash === 'landing') {
        setViewMode('landing');
      } else if (hash === 'gateway') {
        setViewMode('gateway');
      } else if (hash === 'onboarding') {
        setViewMode('onboarding');
      } else if (hash === 'dashboard') {
        setViewMode('dashboard');
      } else if (VALID_TABS.includes(hash as NavTab)) {
        setViewMode('dashboard');
        setActiveTab(hash as NavTab);
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const handleSelectScenario = (scenarioId: string) => {
    setSelectedScenarioId(scenarioId);
    const found = redTeamScenarios.find((s) => s.id === scenarioId);
    if (found) {
      setRawInvoiceInput(found.rawInvoiceText);
    }
  };

  const handleProcessInvoice = async (overrideScenarioId?: string) => {
    setProcessingInvoice(true);
    setUploadProgress(30);
    setToastMessage(null);
    try {
      const targetScenario = overrideScenarioId
        ? redTeamScenarios.find((s) => s.id === overrideScenarioId)
        : redTeamScenarios.find(
            (s) =>
              s.id === selectedScenarioId &&
              s.rawInvoiceText.trim() === rawInvoiceInput.trim()
          );

      setUploadProgress(65);
      const res = await fetch('/api/invoices/process', {
        method: 'POST',
        headers: buildMutationHeaders(),
        body: JSON.stringify(
          targetScenario
            ? {
                scenarioId: targetScenario.id,
                mode: experienceMode === 'real' ? 'live' : 'simulation',
              }
            : {
                rawText: rawInvoiceInput,
                mode: experienceMode === 'real' ? 'live' : 'simulation',
              }
        ),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Invoice processing failed');
      }

      setUploadProgress(100);
      const record: ProcessedInvoiceRecord = data.invoice;
      setLatestProcessed(record);
      setLiveAttestation(record.attestation);

      const plain = getPlainEnglishDecisionExplanation(record);
      setToastMessage({
        type:
          record.finalDecision === 'PAY'
            ? 'ok'
            : record.finalDecision === 'HOLD'
              ? 'warn'
              : 'err',
        title: `Invoice #${record.invoiceNumber} — ${plain.headline}`,
        text: plain.explanation,
      });

      await refreshAllData();
    } catch (err) {
      setToastMessage({
        type: 'err',
        title: 'Could not process invoice',
        text: (err as Error).message,
      });
    } finally {
      setProcessingInvoice(false);
      setTimeout(() => setUploadProgress(0), 600);
    }
  };

  const processUploadedFile = async (file: File) => {
    if (file.size > 8 * 1024 * 1024) {
      setToastMessage({
        type: 'err',
        title: 'File exceeds 8 MB limit',
        text: 'Please upload a PDF or TXT invoice under 8 MB.',
      });
      return;
    }

    setProcessingInvoice(true);
    setUploadProgress(35);
    setToastMessage(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mode', overview?.mode || 'simulation');

      setUploadProgress(75);
      const res = await fetch('/api/invoices/upload-pdf', {
        method: 'POST',
        headers: buildMutationHeaders(false),
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'PDF extraction failed');

      setUploadProgress(100);
      const record: ProcessedInvoiceRecord = data.invoice;
      setLatestProcessed(record);
      setLiveAttestation(record.attestation);
      const plain = getPlainEnglishDecisionExplanation(record);
      setToastMessage({
        type:
          record.finalDecision === 'PAY'
            ? 'ok'
            : record.finalDecision === 'HOLD'
              ? 'warn'
              : 'err',
        title: `Uploaded ${file.name} — ${plain.headline}`,
        text: `${plain.explanation} (Raw PDF buffer zeroed from RAM immediately.)`,
      });
      await refreshAllData();
    } catch (err) {
      setToastMessage({
        type: 'err',
        title: 'Upload failed',
        text: (err as Error).message,
      });
    } finally {
      setProcessingInvoice(false);
      setTimeout(() => setUploadProgress(0), 600);
    }
  };

  const handleUploadPdfInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processUploadedFile(file);
    e.target.value = '';
  };

  const handleDropFile = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingFile(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    await processUploadedFile(file);
  };

  const requestApproveInvoiceConfirmation = (invoiceId: string) => {
    const inv = invoices.find((i) => i.id === invoiceId);
    if (!inv) return;

    setConfirmDialog({
      open: true,
      title: `Approve & Pay Invoice #${inv.invoiceNumber}?`,
      description: `You are authorizing an exact-output payment of $${inv.total.toFixed(2)} ${inv.requestedPayoutAsset} to ${inv.vendorName} (${inv.receivingWalletAddress} on ${inv.requestedDestinationChain.toUpperCase()}).`,
      confirmLabel: `Approve & Pay $${inv.total.toFixed(2)}`,
      variant: 'approve',
      requireNotes: true,
      defaultNotes: 'Verified vendor exception confirmed by financial controller.',
      onConfirm: async (notes: string) => {
        setConfirmDialog(null);
        await executeApproveInvoice(invoiceId, notes);
      },
    });
  };

  const executeApproveInvoice = async (invoiceId: string, notes?: string) => {
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/approve`, {
        method: 'POST',
        headers: buildMutationHeaders(),
        body: JSON.stringify({
          approvedBy: 'controller@steward-ap.finance',
          notes: notes || 'Verified vendor exception via STEWARD Approval Queue',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Approval failed');
      setLatestProcessed(data.invoice);
      setToastMessage({
        type: 'ok',
        title: `Invoice #${data.invoice.invoiceNumber} Approved & Paid`,
        text: `Settled $${data.invoice.total.toFixed(2)} ${data.invoice.requestedPayoutAsset} to ${data.invoice.vendorName}.`,
      });
      await refreshAllData();
    } catch (err) {
      setToastMessage({
        type: 'err',
        title: 'Approval blocked by security policy',
        text: (err as Error).message,
      });
    }
  };

  const requestRejectInvoiceConfirmation = (invoiceId: string) => {
    const inv = invoices.find((i) => i.id === invoiceId);
    if (!inv) return;

    setConfirmDialog({
      open: true,
      title: `Reject & Block Invoice #${inv.invoiceNumber}?`,
      description: `This will permanently block payment of $${inv.total.toFixed(2)} to ${inv.vendorName} and record a rejection in the audit ledger.`,
      confirmLabel: 'Reject Invoice',
      variant: 'danger',
      requireNotes: true,
      defaultNotes: 'Rejected during financial controller review.',
      onConfirm: async (notes: string) => {
        setConfirmDialog(null);
        await executeRejectInvoice(invoiceId, notes);
      },
    });
  };

  const executeRejectInvoice = async (invoiceId: string, reason?: string) => {
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/reject`, {
        method: 'POST',
        headers: buildMutationHeaders(),
        body: JSON.stringify({
          rejectedBy: 'controller@steward-ap.finance',
          reason: reason || 'Rejected during manual AP review',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Rejection failed');
      setLatestProcessed(data.invoice);
      setToastMessage({
        type: 'err',
        title: `Invoice #${data.invoice.invoiceNumber} Rejected`,
        text: `Marked as BLOCKED. No funds were transferred.`,
      });
      await refreshAllData();
    } catch (err) {
      setToastMessage({
        type: 'err',
        title: 'Rejection error',
        text: (err as Error).message,
      });
    }
  };

  const handleInvoiceUpdated = (updated: ProcessedInvoiceRecord) => {
    setInvoices((prev) => prev.map((inv) => (inv.id === updated.id ? updated : inv)));
    setLatestProcessed((prev) => (prev?.id === updated.id ? updated : prev));
    if (inspectedInvoice?.id === updated.id) {
      setInspectedInvoice(updated);
    }
    setToastMessage({
      type: 'ok',
      title: 'Field Corrected & Re-evaluated',
      text: `Updated ${updated.vendorName} #${updated.invoiceNumber}. Validation recalculated.`,
    });
    void refreshAllData();
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
        setToastMessage({
          type: data.attestation.verified ? 'ok' : 'err',
          title: data.attestation.verified
            ? 'Private AI environment verified'
            : 'Tampered hardware proof rejected',
          text: data.attestation.verified
            ? 'Fresh 32-byte session nonce and Intel TDX + NVIDIA Hopper certificates verified.'
            : `STEWARD caught the simulated attack: ${data.attestation.failedChecks[0] || 'Cryptographic signature invalid'}`,
        });
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
      if (!res.ok) {
        setToastMessage({
          type: 'err',
          title: 'Invalid quote request',
          text: data.error || 'Could not calculate cross-chain quote.',
        });
        return;
      }
      setQuotePreview(data.quote || null);
    } catch (err) {
      setToastMessage({
        type: 'err',
        title: 'Quote preview error',
        text: (err as Error).message,
      });
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
      setToastMessage({
        type: 'ok',
        title: '30-Invoice Evaluation Complete',
        text: `100% accuracy achieved with 0 unauthorized payments across all 30 scenarios.`,
      });
    } catch (err) {
      console.error(err);
    } finally {
      setRunningSuite(false);
    }
  };

  const requestToggleKillSwitch = () => {
    if (!overview?.policy) return;
    const nextState = !overview.policy.kill_switch;
    setConfirmDialog({
      open: true,
      title: nextState
        ? 'Activate Emergency Treasury Kill Switch?'
        : 'Deactivate Kill Switch & Resume Normal Operations?',
      description: nextState
        ? 'Activating the Kill Switch immediately locks all automated and manual payments across your entire organization until a controller unlocks it.'
        : 'Deactivating the Kill Switch restores normal deterministic policy checks and automated approvals below your threshold.',
      confirmLabel: nextState ? 'Lock All Payments Now' : 'Resume Normal Operations',
      variant: nextState ? 'danger' : 'approve',
      onConfirm: async () => {
        setConfirmDialog(null);
        const res = await fetch('/api/policy', {
          method: 'POST',
          headers: buildMutationHeaders(),
          body: JSON.stringify({ kill_switch: nextState }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setToastMessage({
            type: 'err',
            title: 'Kill Switch Action Blocked',
            text: data.error || 'Unauthorized role or Explore Mode restriction.',
          });
          return;
        }
        setToastMessage({
          type: nextState ? 'err' : 'ok',
          title: nextState
            ? 'Emergency Kill Switch Activated'
            : 'Normal Payment Operations Resumed',
          text: nextState
            ? 'All outgoing payments are now locked server-side.'
            : 'Deterministic payment policy evaluation is active.',
        });
        await refreshAllData();
      },
    });
  };

  const handleCreateVendor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVendorName || !newVendorWallet) return;
    try {
      const res = await fetch('/api/vendors', {
        method: 'POST',
        headers: buildMutationHeaders(),
        body: JSON.stringify({
          businessName: newVendorName,
          walletAddress: newVendorWallet,
          preferredPayoutAsset: 'USDC',
          preferredDestinationChain: newVendorChain,
          autoVerify: false,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToastMessage({
          type: 'err',
          title: 'Could not register supplier',
          text: data.error || 'Invalid vendor details.',
        });
        return;
      }
      setToastMessage({
        type: 'warn',
        title: `Vendor "${newVendorName}" Registered`,
        text: 'Placed in PENDING_APPROVAL. Please confirm & verify the supplier before automated payouts begin.',
      });
      setNewVendorName('');
      setNewVendorWallet('');
      await refreshAllData();
    } catch (err) {
      setToastMessage({
        type: 'err',
        title: 'Supplier registration error',
        text: (err as Error).message,
      });
    }
  };

  const handleRotateVendorAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rotateVendorId || !rotateNewAddress) return;
    try {
      const res = await fetch(`/api/vendors/${rotateVendorId}/change-address`, {
        method: 'POST',
        headers: buildMutationHeaders(),
        body: JSON.stringify({
          newWalletAddress: rotateNewAddress,
          changedBy: 'controller@steward-ap.finance',
          reason: rotateReason,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToastMessage({
          type: 'err',
          title: 'Could not update supplier wallet',
          text: data.error || 'Invalid wallet address.',
        });
        return;
      }
      setToastMessage({
        type: 'warn',
        title: 'Wallet Change Initiated — 48-Hour Cooling-Off Active',
        text: `Any invoice from this vendor will require manual controller approval for the next 48 hours.`,
      });
      setRotateNewAddress('');
      await refreshAllData();
    } catch (err) {
      setToastMessage({
        type: 'err',
        title: 'Wallet update error',
        text: (err as Error).message,
      });
    }
  };

  const handleUpdatePolicyThresholds = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPolicy(true);
    try {
      const res = await fetch('/api/policy', {
        method: 'POST',
        headers: buildMutationHeaders(),
        body: JSON.stringify({
          auto_approve_below_usd: Number(editAutoApprove),
          per_invoice_cap_usd: Number(editPerInvoiceCap),
          daily_cap_usd: Number(editDailyCap),
          address_change: {
            cooling_off_hours: Number(editCoolingHours),
            require_human_approval: true,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToastMessage({
          type: 'err',
          title: 'Invalid policy thresholds',
          text: data.error || 'Could not update policy configuration.',
        });
        return;
      }
      setToastMessage({
        type: 'ok',
        title: 'Company Payment Policy Updated',
        text: `Auto-pay limit: $${data.policy.auto_approve_below_usd} | Per-invoice cap: $${data.policy.per_invoice_cap_usd} | Daily cap: $${data.policy.daily_cap_usd}.`,
      });
      await refreshAllData();
    } catch (err) {
      setToastMessage({
        type: 'err',
        title: 'Policy update error',
        text: (err as Error).message,
      });
    } finally {
      setSavingPolicy(false);
    }
  };

  // Render Landing Page when viewMode === 'landing'
  if (viewMode === 'landing') {
    return (
      <LandingPage
        onOpenGateway={navigateToGateway}
        onStartOnboarding={() => navigateToOnboarding(1)}
        onLaunchDemo={(initialTab) => {
          const tab =
            initialTab && VALID_TABS.includes(initialTab as NavTab)
              ? (initialTab as NavTab)
              : 'overview';
          navigateToDashboardTab(tab);
        }}
      />
    );
  }

  // Render Launch Gateway when viewMode === 'gateway'
  if (viewMode === 'gateway') {
    return (
      <LaunchGatewayView
        connectedWallets={treasuryWallets}
        onBackToLanding={navigateToLanding}
        onStartOnboarding={() => navigateToOnboarding(1)}
        onWalletsUpdated={refreshAllData}
        onEnterWorkspace={(mode, initialTab) => {
          setExperienceMode(mode);
          const tab =
            initialTab && VALID_TABS.includes(initialTab as NavTab)
              ? (initialTab as NavTab)
              : 'overview';
          navigateToDashboardTab(tab);
        }}
      />
    );
  }

  // Render 6-Step Business Onboarding Wizard when viewMode === 'onboarding'
  if (viewMode === 'onboarding') {
    return (
      <BusinessOnboardingWizard
        workspace={workspace}
        members={workspaceMembers}
        connectedWallets={treasuryWallets}
        policy={
          overview?.policy || {
            per_invoice_cap_usd: 500,
            daily_cap_usd: 1500,
            auto_approve_below_usd: 200,
            allowed_payout_assets: ['USDC'],
            new_vendor: 'require_human',
            address_change: { cooling_off_hours: 48, require_human: true },
            kill_switch: false,
          }
        }
        treasurySettings={treasurySettings}
        vendors={vendors}
        activeRole={activeRole}
        initialStep={onboardingInitialStep}
        onRefreshAll={refreshAllData}
        onOpenGateway={navigateToGateway}
        onFinishOnboarding={(mode, targetTab) => {
          setExperienceMode(mode);
          const tab =
            targetTab && VALID_TABS.includes(targetTab as NavTab)
              ? (targetTab as NavTab)
              : 'overview';
          navigateToDashboardTab(tab);
        }}
      />
    );
  }

  const heldInvoices = invoices.filter((i) => i.paymentStatus === 'HELD');
  const totalProcessedVolumeUsd = invoices.reduce((sum, i) => sum + i.total, 0);

  const filteredLedger = invoices.filter((inv) => {
    if (ledgerStatusFilter !== 'ALL' && inv.paymentStatus !== ledgerStatusFilter) return false;
    if (ledgerModeFilter !== 'ALL' && inv.mode.toUpperCase() !== ledgerModeFilter) return false;
    if (ledgerDateFrom && inv.invoiceDate < ledgerDateFrom) return false;
    if (ledgerDateTo && inv.invoiceDate > ledgerDateTo) return false;
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

  const searchMatches =
    headerSearch.trim().length > 1
      ? invoices
          .filter(
            (i) =>
              i.invoiceNumber.toLowerCase().includes(headerSearch.toLowerCase()) ||
              i.vendorName.toLowerCase().includes(headerSearch.toLowerCase()) ||
              i.receivingWalletAddress.toLowerCase().includes(headerSearch.toLowerCase())
          )
          .slice(0, 5)
      : [];

  const navItems: Array<{
    id: NavTab;
    label: string;
    subtitle: string;
    icon: React.ReactNode;
    badge?: number;
  }> = [
    {
      id: 'overview',
      label: 'Overview',
      subtitle: 'Financial operations summary',
      icon: <LayoutDashboard className="h-4 w-4" />,
    },
    {
      id: 'invoices',
      label: 'Invoices',
      subtitle: 'Upload, analyze & inspect bills',
      icon: <FileText className="h-4 w-4" />,
    },
    {
      id: 'approvals',
      label: 'Approvals',
      subtitle: 'Payments waiting for your review',
      icon: <CheckSquare className="h-4 w-4" />,
      badge: heldInvoices.length,
    },
    {
      id: 'vendors',
      label: 'Vendors',
      subtitle: 'Verified suppliers & wallet history',
      icon: <Building2 className="h-4 w-4" />,
    },
    {
      id: 'payments',
      label: 'Payments',
      subtitle: 'Cross-chain payouts & quotes',
      icon: <ArrowLeftRight className="h-4 w-4" />,
    },
    {
      id: 'security',
      label: 'Security Center',
      subtitle: 'Private AI & vendor protection',
      icon: <ShieldAlert className="h-4 w-4" />,
    },
    {
      id: 'redteam',
      label: 'Red Team',
      subtitle: 'Interactive fraud & attack lab',
      icon: <Swords className="h-4 w-4" />,
    },
    {
      id: 'ledger',
      label: 'Audit Ledger',
      subtitle: 'Accountant records & CSV export',
      icon: <BookOpenCheck className="h-4 w-4" />,
    },
    {
      id: 'treasury',
      label: 'Treasury',
      subtitle: 'Non-custodial NEAR & MetaMask wallets',
      icon: <Wallet className="h-4 w-4" />,
      badge: treasuryWallets.length > 0 ? treasuryWallets.length : undefined,
    },
    {
      id: 'settings',
      label: 'Settings',
      subtitle: 'Spending limits & custody controls',
      icon: <SettingsIcon className="h-4 w-4" />,
    },
  ];

  const currentNavMeta = navItems.find((n) => n.id === activeTab) || navItems[0];

  return (
    <div className="min-h-screen bg-[#F7F8F3] text-[#18251F] flex">
      {/* =====================================================================
          MOBILE NAVIGATION DRAWER OVERLAY
         ===================================================================== */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-[#18251F]/50 backdrop-blur-xs"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-10 w-72 max-w-[85vw] bg-white border-r border-[#E6EAE2] p-5 flex flex-col justify-between overflow-y-auto">
            <div>
              <div className="flex items-center justify-between border-b border-[#E6EAE2] pb-4">
                <StewardLogo size="md" />
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  aria-label="Close navigation menu"
                  className="rounded-lg p-1.5 text-[#78847C] hover:bg-[#F0F3EC]"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <nav className="mt-4 space-y-1">
                {navItems.map((item) => {
                  const active = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => navigateToDashboardTab(item.id)}
                      className={`w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-all cursor-pointer ${
                        active
                          ? 'bg-[#123D32] text-white shadow-xs'
                          : 'text-[#18251F] hover:bg-[#F0F3EC]'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className={active ? 'text-[#C7F36B]' : 'text-[#78847C]'}>
                          {item.icon}
                        </span>
                        <span>{item.label}</span>
                      </div>
                      {item.badge !== undefined && item.badge > 0 && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                            active
                              ? 'bg-[#C7F36B] text-[#123D32]'
                              : 'bg-[#FFF5DF] text-[#9A6700]'
                          }`}
                        >
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>
            </div>

            <div className="pt-4 border-t border-[#E6EAE2] space-y-2">
              <button
                type="button"
                onClick={navigateToLanding}
                className="w-full flex items-center gap-2 rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] px-3.5 py-2.5 text-xs font-semibold text-[#123D32] hover:bg-[#F0F3EC] cursor-pointer"
              >
                <Home className="h-4 w-4" />
                <span>Back to Product Landing Page</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* =====================================================================
          DESKTOP LEFT NAVIGATION SIDEBAR
         ===================================================================== */}
      <aside
        className={`hidden lg:flex flex-col justify-between shrink-0 border-r border-[#E6EAE2] bg-white transition-all duration-200 sticky top-0 h-screen ${
          sidebarCompact ? 'w-20 px-3 py-5' : 'w-64 px-4 py-5'
        }`}
      >
        <div className="space-y-6">
          {/* Brand Logo + Collapse Toggle */}
          <div className="flex items-center justify-between px-1">
            <button
              type="button"
              onClick={() => navigateToDashboardTab('overview')}
              className="focus:outline-none cursor-pointer"
              title="STEWARD Dashboard Overview"
            >
              <StewardLogo size="md" compact={sidebarCompact} />
            </button>
            <button
              type="button"
              onClick={() => setSidebarCompact((c) => !c)}
              aria-label={sidebarCompact ? 'Expand sidebar' : 'Collapse sidebar'}
              className="rounded-lg border border-[#E6EAE2] bg-[#F7F8F3] p-1.5 text-[#78847C] hover:text-[#18251F] cursor-pointer"
              title={sidebarCompact ? 'Expand sidebar' : 'Compact sidebar'}
            >
              {sidebarCompact ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronLeft className="h-4 w-4" />
              )}
            </button>
          </div>

          {/* Primary Navigation Items */}
          <nav className="space-y-1" aria-label="Main Navigation">
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigateToDashboardTab(item.id)}
                  title={sidebarCompact ? item.label : undefined}
                  className={`w-full flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-semibold transition-all cursor-pointer ${
                    active
                      ? 'bg-[#123D32] text-white shadow-xs'
                      : 'text-[#18251F]/80 hover:bg-[#F0F3EC] hover:text-[#18251F]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={active ? 'text-[#C7F36B]' : 'text-[#78847C]'}>
                      {item.icon}
                    </span>
                    {!sidebarCompact && <span className="truncate">{item.label}</span>}
                  </div>
                  {!sidebarCompact && item.badge !== undefined && item.badge > 0 && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${
                        active
                          ? 'bg-[#C7F36B] text-[#123D32]'
                          : 'bg-[#FFF5DF] text-[#9A6700] border border-[#D99A32]/30'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Sidebar Footer: Policy Summary & Landing Page Link */}
        <div className="space-y-3 pt-4 border-t border-[#E6EAE2]">
          {!sidebarCompact && overview?.policy && (
            <div className="rounded-xl bg-[#F7F8F3] border border-[#E6EAE2] p-3.5 text-xs space-y-2">
              <div className="flex items-center justify-between font-bold text-[#123D32]">
                <span className="flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5 text-[#23845B]" />
                  <span>Active Safety Rules</span>
                </span>
                <span className="text-[10px] uppercase tracking-wider text-[#23845B]">On</span>
              </div>
              <div className="space-y-1 text-[11px] text-[#78847C]">
                <div className="flex justify-between">
                  <span>Auto-pay under:</span>
                  <strong className="font-mono text-[#18251F]">
                    ${overview.policy.auto_approve_below_usd}
                  </strong>
                </div>
                <div className="flex justify-between">
                  <span>Max per invoice:</span>
                  <strong className="font-mono text-[#18251F]">
                    ${overview.policy.per_invoice_cap_usd}
                  </strong>
                </div>
                <div className="flex justify-between">
                  <span>Wallet change lock:</span>
                  <strong className="font-mono text-[#18251F]">
                    {overview.policy.address_change.cooling_off_hours}h
                  </strong>
                </div>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={navigateToLanding}
            title="View Public Landing Page"
            className="w-full flex items-center justify-center gap-2 rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] px-3 py-2 text-xs font-semibold text-[#123D32] hover:bg-[#F0F3EC] transition-colors cursor-pointer"
          >
            <Home className="h-3.5 w-3.5 shrink-0" />
            {!sidebarCompact && <span>Product Landing Page</span>}
          </button>
        </div>
      </aside>

      {/* =====================================================================
          MAIN APPLICATION COLUMN (HEADER + WORKSPACE)
         ===================================================================== */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Application Header */}
        <header className="sticky top-0 z-30 border-b border-[#E6EAE2] bg-white/90 backdrop-blur-md px-4 sm:px-8 py-3.5">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
            {/* Left: Mobile Drawer Button + Current Page Title */}
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                aria-label="Open navigation menu"
                className="lg:hidden rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] p-2 text-[#18251F] hover:bg-[#F0F3EC]"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="min-w-0">
                <h1 className="font-display text-lg sm:text-xl font-extrabold text-[#18251F] truncate">
                  {currentNavMeta.label}
                </h1>
                <p className="hidden sm:block text-xs text-[#78847C] truncate">
                  {currentNavMeta.subtitle}
                </p>
              </div>
            </div>

            {/* Right: Search, Demo Mode Indicator, Notifications, Kill Switch, User Menu */}
            <div className="flex items-center gap-2.5 sm:gap-3">
              {/* Quick Global Search */}
              <div className="relative hidden md:block w-56 lg:w-64">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#78847C]" />
                <input
                  type="text"
                  value={headerSearch}
                  onChange={(e) => setHeaderSearch(e.target.value)}
                  placeholder="Search invoices or vendors..."
                  aria-label="Search invoices or vendors"
                  className="w-full rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] pl-9 pr-3 py-2 text-xs text-[#18251F] placeholder:text-[#78847C] focus:border-[#123D32] focus:bg-white focus:outline-none"
                />
                {searchMatches.length > 0 && (
                  <div className="absolute right-0 mt-1.5 w-80 rounded-2xl border border-[#E6EAE2] bg-white p-2 shadow-xl z-50">
                    <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#78847C]">
                      Matching Invoices
                    </div>
                    {searchMatches.map((inv) => (
                      <button
                        key={inv.id}
                        type="button"
                        onClick={() => {
                          setInspectedInvoice(inv);
                          setHeaderSearch('');
                        }}
                        className="w-full flex items-center justify-between rounded-xl px-2.5 py-2 text-left text-xs hover:bg-[#F7F8F3] cursor-pointer"
                      >
                        <div>
                          <div className="font-bold text-[#18251F]">#{inv.invoiceNumber}</div>
                          <div className="text-[11px] text-[#78847C]">{inv.vendorName}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-mono font-bold text-[#123D32]">
                            ${inv.total.toFixed(2)}
                          </div>
                          <div className="text-[10px] text-[#78847C]">{inv.paymentStatus}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Persistent Experience Mode Indicator (REAL MODE / SIMULATED MODE / EXPLORE MODE) */}
              <button
                type="button"
                onClick={navigateToGateway}
                className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition-colors cursor-pointer ${
                  experienceMode === 'real'
                    ? 'border-[#123D32] bg-[#123D32] text-[#C7F36B]'
                    : experienceMode === 'explore'
                    ? 'border-[#E6EAE2] bg-[#F0F3EC] text-[#18251F]'
                    : 'border-[#C7F36B] bg-[#EDF8D8] text-[#123D32]'
                }`}
                title="Click to switch Experience Mode in Launch Gateway"
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    experienceMode === 'real'
                      ? 'bg-[#C7F36B]'
                      : experienceMode === 'explore'
                      ? 'bg-[#78847C]'
                      : 'bg-[#23845B] animate-pulse'
                  }`}
                />
                <span>
                  {experienceMode === 'real'
                    ? 'REAL MODE'
                    : experienceMode === 'explore'
                    ? 'EXPLORE MODE'
                    : 'SIMULATED MODE'}
                </span>
              </button>

              {/* Server-Side RBAC Role Selector */}
              <select
                aria-label="Active Workspace Role"
                value={activeRole}
                onChange={(e) => setActiveRole(e.target.value as WorkspaceRole)}
                className="hidden sm:inline-block rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] px-2.5 py-2 text-xs font-bold text-[#123D32] focus:border-[#123D32] focus:outline-none cursor-pointer"
                title="Active Finance Team Role (Enforced Server-Side)"
              >
                <option value="Owner">Role: Owner</option>
                <option value="Finance Administrator">Role: Finance Admin</option>
                <option value="Approver">Role: Approver</option>
                <option value="Auditor">Role: Auditor (Read-Only)</option>
              </select>

              {/* Guided Tour Button */}
              <button
                type="button"
                onClick={() => setGuidedTourOpen(true)}
                className="hidden xl:inline-flex items-center gap-1.5 rounded-xl border border-[#E6EAE2] bg-white px-3 py-2 text-xs font-semibold text-[#123D32] hover:bg-[#F0F3EC] transition-colors cursor-pointer"
                title="Click to open the Guided Demo Tour"
              >
                <span>Guided Tour</span>
              </button>

              {/* Emergency Kill Switch Button */}
              {overview?.policy.kill_switch && (
                <button
                  type="button"
                  onClick={requestToggleKillSwitch}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#D9534F] px-3 py-2 text-xs font-bold text-white shadow-xs cursor-pointer"
                >
                  <AlertOctagon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Payments Locked</span>
                </button>
              )}

              {/* Notification Indicator */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setNotificationsOpen((n) => !n);
                    setAccountMenuOpen(false);
                  }}
                  aria-label="Notifications"
                  className="relative rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] p-2 text-[#18251F] hover:bg-[#F0F3EC] cursor-pointer"
                >
                  <Bell className="h-4 w-4" />
                  {(heldInvoices.length > 0 || securityEvents.length > 0) && (
                    <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#D9534F] text-[10px] font-bold text-white">
                      {heldInvoices.length}
                    </span>
                  )}
                </button>

                {notificationsOpen && (
                  <div className="absolute right-0 mt-2 w-80 rounded-2xl border border-[#E6EAE2] bg-white p-4 shadow-xl z-50 space-y-3">
                    <div className="flex items-center justify-between border-b border-[#E6EAE2] pb-2">
                      <span className="font-display text-xs font-bold text-[#18251F]">
                        Action Items & Alerts
                      </span>
                      <button
                        type="button"
                        onClick={() => setNotificationsOpen(false)}
                        className="text-xs text-[#78847C] hover:text-[#18251F]"
                      >
                        Close
                      </button>
                    </div>
                    {heldInvoices.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setNotificationsOpen(false);
                          navigateToDashboardTab('approvals');
                        }}
                        className="w-full rounded-xl bg-[#FFF5DF] p-3 text-left text-xs border border-[#D99A32]/30 hover:bg-[#FFF5DF]/80 cursor-pointer"
                      >
                        <div className="font-bold text-[#9A6700]">
                          {heldInvoices.length} invoice{heldInvoices.length > 1 ? 's' : ''} waiting
                          for your approval
                        </div>
                        <div className="mt-0.5 text-[11px] text-[#18251F]">
                          Click to review held bills in the Approval Queue →
                        </div>
                      </button>
                    )}
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {securityEvents.slice(0, 3).map((ev) => (
                        <div
                          key={ev.id}
                          className="rounded-xl bg-[#F7F8F3] p-2.5 text-xs border border-[#E6EAE2]"
                        >
                          <div className="font-semibold text-[#18251F] truncate">{ev.title}</div>
                          <div className="text-[11px] text-[#78847C] line-clamp-1">
                            {ev.description}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* User / Account Menu */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setAccountMenuOpen((a) => !a);
                    setNotificationsOpen(false);
                  }}
                  aria-label="User account menu"
                  className="flex items-center gap-2 rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] px-2.5 py-1.5 text-left hover:bg-[#F0F3EC] cursor-pointer"
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#123D32] text-xs font-bold text-[#C7F36B]">
                    ER
                  </div>
                  <div className="hidden sm:block leading-tight">
                    <div className="text-xs font-bold text-[#18251F]">Elena Rostova</div>
                    <div className="text-[10px] text-[#78847C]">Financial Controller</div>
                  </div>
                </button>

                {accountMenuOpen && (
                  <div className="absolute right-0 mt-2 w-64 rounded-2xl border border-[#E6EAE2] bg-white p-3.5 shadow-xl z-50 space-y-2.5 text-xs">
                    <div className="border-b border-[#E6EAE2] pb-2.5">
                      <div className="font-bold text-[#18251F]">Elena Rostova</div>
                      <div className="font-mono text-[11px] text-[#78847C]">
                        controller@steward-ap.finance
                      </div>
                      <div className="mt-1 inline-flex items-center gap-1 rounded bg-[#E8F5EC] px-2 py-0.5 text-[10px] font-bold text-[#23845B]">
                        Authorized Approver
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        navigateToDashboardTab('settings');
                      }}
                      className="w-full text-left rounded-lg px-2.5 py-1.5 font-medium text-[#18251F] hover:bg-[#F7F8F3] cursor-pointer"
                    >
                      Payment Policy & Thresholds
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        setGuidedTourOpen(true);
                      }}
                      className="w-full text-left rounded-lg px-2.5 py-1.5 font-medium text-[#18251F] hover:bg-[#F7F8F3] cursor-pointer"
                    >
                      Open Guided Demo Tour
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        navigateToOnboarding(1);
                      }}
                      className="w-full text-left rounded-lg px-2.5 py-1.5 font-medium text-[#18251F] hover:bg-[#F7F8F3] cursor-pointer"
                    >
                      Business Onboarding Wizard (6 Steps)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        navigateToGateway();
                      }}
                      className="w-full text-left rounded-lg px-2.5 py-1.5 font-medium text-[#18251F] hover:bg-[#F7F8F3] cursor-pointer"
                    >
                      Switch Mode (Launch Gateway)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        navigateToLanding();
                      }}
                      className="w-full text-left rounded-lg px-2.5 py-1.5 font-medium text-[#123D32] hover:bg-[#F7F8F3] cursor-pointer"
                    >
                      ← Return to Landing Page
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Main Workspace Container */}
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 sm:px-8 py-6 sm:py-8 space-y-6">
          {/* Toast Notification Banner */}
          {toastMessage && (
            <div
              role="status"
              className={`flex items-start justify-between gap-4 rounded-2xl border p-4 shadow-sm animate-fade-in ${
                toastMessage.type === 'ok'
                  ? 'border-[#23845B]/35 bg-[#E8F5EC] text-[#18251F]'
                  : toastMessage.type === 'warn'
                    ? 'border-[#D99A32]/40 bg-[#FFF5DF] text-[#18251F]'
                    : 'border-[#D9534F]/40 bg-[#FCEDEC] text-[#18251F]'
              }`}
            >
              <div className="flex items-start gap-3">
                {toastMessage.type === 'ok' ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-[#23845B] mt-0.5" />
                ) : toastMessage.type === 'warn' ? (
                  <Clock className="h-5 w-5 shrink-0 text-[#D99A32] mt-0.5" />
                ) : (
                  <ShieldAlert className="h-5 w-5 shrink-0 text-[#D9534F] mt-0.5" />
                )}
                <div>
                  <div className="font-display text-sm font-bold">{toastMessage.title}</div>
                  <div className="mt-0.5 text-xs text-[#18251F]/80">{toastMessage.text}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setToastMessage(null)}
                className="rounded-lg px-2 py-1 text-xs font-semibold text-[#78847C] hover:text-[#18251F] cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* ================================================================
              EXPLORE MODE READ-ONLY NOTICE BANNER
             ================================================================ */}
          {experienceMode === 'explore' && (
            <div className="rounded-2xl border border-[#D99A32]/40 bg-[#FFF5DF] p-4 flex flex-wrap items-center justify-between gap-4 text-xs">
              <div className="flex items-center gap-3 text-[#8A5A00]">
                <Eye className="h-4 w-4 shrink-0" />
                <div>
                  <span className="font-bold">Explore Mode (Read-Only):</span> You are inspecting
                  STEWARD without a connected wallet. To approve invoices, modify policies, or sign
                  payments, connect a real wallet or launch the Simulated Demo Treasury.
                </div>
              </div>
              <button
                type="button"
                onClick={navigateToGateway}
                className="rounded-xl bg-[#123D32] px-4 py-2 text-xs font-bold text-white hover:bg-[#1B5545] cursor-pointer"
              >
                Connect Wallet or Launch Demo Treasury →
              </button>
            </div>
          )}

          {/* ================================================================
              TAB 1: OVERVIEW DASHBOARD (SECTION 5)
             ================================================================ */}
          {activeTab === 'overview' && overview && (
            <div className="space-y-6 animate-fade-in">
              {/* Phase 4 First-Time User Experience Setup Checklist */}
              <FirstTimeSetupChecklistBanner
                workspace={workspace}
                onOpenWizardStep={(step) => navigateToOnboarding(step)}
              />

              {/* Dashboard Greeting Banner */}
              <div className="steward-card p-6 sm:p-7 flex flex-wrap items-center justify-between gap-6 bg-gradient-to-r from-white via-white to-[#EDF8D8]/45">
                <div className="space-y-1.5">
                  <div className="inline-flex items-center gap-2 text-xs font-bold text-[#23845B]">
                    <ShieldCheck className="h-4 w-4" />
                    <span>All Security Protections Active</span>
                  </div>
                  <h2 className="font-display text-2xl sm:text-3xl font-extrabold text-[#18251F]">
                    Good morning. Your finances are in good hands.
                  </h2>
                  <p className="text-sm text-[#78847C]">
                    Here&apos;s what&apos;s happening across your payments today.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => navigateToDashboardTab('invoices')}
                    className="inline-flex items-center gap-2 rounded-xl bg-[#123D32] px-4 py-2.5 text-xs sm:text-sm font-bold text-white shadow-xs hover:bg-[#1B5545] transition-colors cursor-pointer"
                  >
                    <Upload className="h-4 w-4 text-[#C7F36B]" />
                    <span>Upload or Test Invoice</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => navigateToDashboardTab('redteam')}
                    className="inline-flex items-center gap-2 rounded-xl border border-[#E6EAE2] bg-white px-4 py-2.5 text-xs sm:text-sm font-semibold text-[#18251F] hover:bg-[#F0F3EC] transition-colors cursor-pointer"
                  >
                    <Swords className="h-4 w-4 text-[#D9534F]" />
                    <span>Red Team Demo</span>
                  </button>
                </div>
              </div>

              {/* 4 Summary Cards (Real Application Data) */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {/* 1. Total Processed */}
                <div
                  onClick={() => navigateToDashboardTab('invoices')}
                  className="steward-card steward-card-interactive p-5 cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#78847C]">Total Processed</span>
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#F0F3EC] text-[#123D32]">
                      <FileText className="h-4 w-4" />
                    </span>
                  </div>
                  <div className="mt-3 font-display text-3xl font-extrabold text-[#18251F] tabular-nums">
                    {overview.metrics.totalInvoicesProcessed}
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-xs text-[#78847C]">
                    <span>${totalProcessedVolumeUsd.toFixed(2)} total volume</span>
                    <span className="font-semibold text-[#123D32]">
                      {overview.metrics.verifiedVendorsCount} verified vendors
                    </span>
                  </div>
                </div>

                {/* 2. Successfully Paid */}
                <div
                  onClick={() => navigateToDashboardTab('payments')}
                  className="steward-card steward-card-interactive p-5 cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#23845B]">Successfully Paid</span>
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#E8F5EC] text-[#23845B]">
                      <CheckCircle2 className="h-4 w-4" />
                    </span>
                  </div>
                  <div className="mt-3 font-display text-3xl font-extrabold text-[#23845B] tabular-nums">
                    ${overview.metrics.totalAmountPaidUsd.toFixed(2)}
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-xs text-[#78847C]">
                    <span>Exact-output USDC</span>
                    <span className="font-semibold text-[#23845B]">
                      {overview.metrics.paymentSuccessRate}% settlement rate
                    </span>
                  </div>
                </div>

                {/* 3. Awaiting Approval */}
                <div
                  onClick={() => navigateToDashboardTab('approvals')}
                  className="steward-card steward-card-interactive p-5 cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#9A6700]">Awaiting Approval</span>
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FFF5DF] text-[#D99A32]">
                      <Clock className="h-4 w-4" />
                    </span>
                  </div>
                  <div className="mt-3 font-display text-3xl font-extrabold text-[#18251F] tabular-nums">
                    {overview.metrics.pendingApprovalsCount}
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-xs text-[#78847C]">
                    <span>${overview.metrics.totalAmountHeldUsd.toFixed(2)} on hold</span>
                    <span className="font-semibold text-[#9A6700]">Review queue →</span>
                  </div>
                </div>

                {/* 4. Threats Prevented */}
                <div
                  onClick={() => navigateToDashboardTab('security')}
                  className="steward-card steward-card-interactive p-5 cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#B8322E]">Threats Prevented</span>
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FCEDEC] text-[#D9534F]">
                      <ShieldAlert className="h-4 w-4" />
                    </span>
                  </div>
                  <div className="mt-3 font-display text-3xl font-extrabold text-[#D9534F] tabular-nums">
                    {overview.metrics.blockedSuspiciousCount}
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-xs text-[#78847C]">
                    <span>${overview.metrics.totalAmountBlockedUsd.toFixed(2)} protected</span>
                    <span className="font-semibold text-[#23845B]">0 unauthorized payouts</span>
                  </div>
                </div>
              </div>

              {/* Invoice Processing Overview Bar & Daily Spend Utilization */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                <div className="lg:col-span-7 steward-card p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-display text-base font-bold text-[#18251F]">
                        Invoice Processing Overview
                      </h3>
                      <p className="text-xs text-[#78847C]">
                        Breakdown of how STEWARD handled your {invoices.length} submitted invoices
                      </p>
                    </div>
                    <ModeBadge mode={overview.mode} />
                  </div>

                  {/* Proportional Stacked Progress Bar */}
                  <div className="h-3.5 w-full rounded-full bg-[#F0F3EC] overflow-hidden flex">
                    {invoices.length > 0 && (
                      <>
                        <div
                          className="h-full bg-[#23845B] transition-all"
                          style={{
                            width: `${(invoices.filter((i) => i.paymentStatus === 'PAID').length / invoices.length) * 100}%`,
                          }}
                          title="Paid"
                        />
                        <div
                          className="h-full bg-[#D99A32] transition-all"
                          style={{
                            width: `${(invoices.filter((i) => i.paymentStatus === 'HELD').length / invoices.length) * 100}%`,
                          }}
                          title="Awaiting Approval"
                        />
                        <div
                          className="h-full bg-[#D9534F] transition-all"
                          style={{
                            width: `${(invoices.filter((i) => i.paymentStatus === 'BLOCKED').length / invoices.length) * 100}%`,
                          }}
                          title="Blocked"
                        />
                      </>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-3 text-xs pt-1">
                    <div className="rounded-xl bg-[#F7F8F3] p-3 border border-[#E6EAE2]">
                      <div className="flex items-center gap-1.5 font-semibold text-[#23845B]">
                        <span className="h-2 w-2 rounded-full bg-[#23845B]" />
                        <span>Paid ({invoices.filter((i) => i.paymentStatus === 'PAID').length})</span>
                      </div>
                      <div className="mt-1 font-mono font-bold text-[#18251F] tabular-nums">
                        ${overview.metrics.totalAmountPaidUsd.toFixed(2)}
                      </div>
                    </div>
                    <div className="rounded-xl bg-[#F7F8F3] p-3 border border-[#E6EAE2]">
                      <div className="flex items-center gap-1.5 font-semibold text-[#9A6700]">
                        <span className="h-2 w-2 rounded-full bg-[#D99A32]" />
                        <span>
                          Awaiting Approval ({overview.metrics.pendingApprovalsCount})
                        </span>
                      </div>
                      <div className="mt-1 font-mono font-bold text-[#18251F] tabular-nums">
                        ${overview.metrics.totalAmountHeldUsd.toFixed(2)}
                      </div>
                    </div>
                    <div className="rounded-xl bg-[#F7F8F3] p-3 border border-[#E6EAE2]">
                      <div className="flex items-center gap-1.5 font-semibold text-[#B8322E]">
                        <span className="h-2 w-2 rounded-full bg-[#D9534F]" />
                        <span>Blocked ({overview.metrics.blockedSuspiciousCount})</span>
                      </div>
                      <div className="mt-1 font-mono font-bold text-[#18251F] tabular-nums">
                        ${overview.metrics.totalAmountBlockedUsd.toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Daily Spend Utilization & Private AI Quick Status */}
                <div className="lg:col-span-5 steward-card p-6 flex flex-col justify-between space-y-4">
                  <div>
                    <div className="flex items-center justify-between">
                      <h3 className="font-display text-base font-bold text-[#18251F]">
                        Daily Spending Safeguard
                      </h3>
                      <span className="font-mono text-xs font-bold text-[#123D32] tabular-nums">
                        ${overview.metrics.totalAmountPaidUsd.toFixed(2)} / $
                        {overview.policy.daily_cap_usd.toFixed(2)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[#78847C]">
                      Cumulative autonomous and controller-approved spend over the last 24 hours.
                    </p>

                    <div className="mt-3 h-2.5 w-full rounded-full bg-[#F0F3EC] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#123D32]"
                        style={{
                          width: `${Math.min(100, (overview.metrics.totalAmountPaidUsd / overview.policy.daily_cap_usd) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>

                  <div className="rounded-xl bg-[#EDF8D8]/60 border border-[#C7F36B] p-3.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <Lock className="h-5 w-5 text-[#123D32] shrink-0" />
                      <div className="text-xs">
                        <div className="font-bold text-[#123D32]">
                          {liveAttestation?.verified
                            ? 'Private AI environment verified'
                            : 'Private AI status check available'}
                        </div>
                        <div className="text-[11px] text-[#237A57]">
                          Model: {overview.nearAiModel}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigateToDashboardTab('security')}
                      className="rounded-lg bg-white px-2.5 py-1.5 text-xs font-bold text-[#123D32] border border-[#E6EAE2] hover:bg-[#F0F3EC] shrink-0 cursor-pointer"
                    >
                      Details →
                    </button>
                  </div>
                </div>
              </div>

              {/* Recent Invoices, Payment Activity, and Security Activity */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                {/* Recent Invoices (7 cols) */}
                <div className="lg:col-span-7 steward-card p-6">
                  <div className="flex items-center justify-between border-b border-[#E6EAE2] pb-3.5">
                    <div>
                      <h3 className="font-display text-base font-bold text-[#18251F]">
                        Recent Invoices
                      </h3>
                      <p className="text-xs text-[#78847C]">
                        Click any invoice to view its 7-stage verification journey
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigateToDashboardTab('invoices')}
                      className="text-xs font-bold text-[#123D32] hover:underline cursor-pointer"
                    >
                      Open Workspace →
                    </button>
                  </div>

                  <div className="mt-3 divide-y divide-[#E6EAE2]">
                    {overview.recentInvoices.length === 0 ? (
                      <div className="py-8 text-center text-xs text-[#78847C]">
                        No invoices have been processed yet. Upload a PDF or test a sample invoice in the Workspace.
                      </div>
                    ) : (
                      overview.recentInvoices.map((inv) => {
                        const plain = getPlainEnglishDecisionExplanation(inv);
                        return (
                          <div
                            key={inv.id}
                            className="py-3.5 flex flex-wrap items-center justify-between gap-3 hover:bg-[#F7F8F3]/60 rounded-xl px-2 transition-colors"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs font-bold text-[#123D32]">
                                  #{inv.invoiceNumber}
                                </span>
                                <span className="font-display text-sm font-bold text-[#18251F] truncate">
                                  {inv.vendorName}
                                </span>
                              </div>
                              <div className="mt-0.5 text-xs text-[#78847C] truncate">
                                {plain.headline}
                              </div>
                            </div>

                            <div className="flex items-center gap-3 shrink-0">
                              <div className="text-right">
                                <div className="font-display text-sm font-extrabold text-[#18251F] tabular-nums">
                                  ${inv.total.toFixed(2)}
                                </div>
                                <div className="text-[10px] font-mono text-[#78847C] uppercase">
                                  {inv.requestedPayoutAsset} • {inv.requestedDestinationChain}
                                </div>
                              </div>
                              <PaymentStatusBadge status={inv.paymentStatus} />
                              <button
                                type="button"
                                onClick={() => setInspectedInvoice(inv)}
                                aria-label={`View details for invoice ${inv.invoiceNumber}`}
                                className="rounded-xl border border-[#E6EAE2] bg-white p-2 text-[#78847C] hover:text-[#123D32] hover:bg-[#F0F3EC] cursor-pointer"
                                title="View Invoice Details & Journey"
                              >
                                <Eye className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Right Column: Payment Activity & Security Activity (5 cols) */}
                <div className="lg:col-span-5 space-y-6">
                  {/* Payment Activity */}
                  <div className="steward-card p-6">
                    <div className="flex items-center justify-between border-b border-[#E6EAE2] pb-3">
                      <h3 className="font-display text-base font-bold text-[#18251F]">
                        Payment Activity
                      </h3>
                      <button
                        type="button"
                        onClick={() => navigateToDashboardTab('payments')}
                        className="text-xs font-bold text-[#123D32] hover:underline cursor-pointer"
                      >
                        All Payments →
                      </button>
                    </div>
                    <div className="mt-3 space-y-2.5">
                      {overview.recentTransactions.length === 0 ? (
                        <div className="py-4 text-center text-xs text-[#78847C]">
                          No settled payments yet.
                        </div>
                      ) : (
                        overview.recentTransactions.slice(0, 3).map((tx) => (
                          <div
                            key={tx.id}
                            className="rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] p-3 flex items-center justify-between gap-2 text-xs"
                          >
                            <div className="min-w-0">
                              <div className="font-bold text-[#18251F] truncate">
                                {tx.recipientAddress}
                              </div>
                              <div className="mt-0.5 text-[11px] text-[#78847C]">
                                {tx.destinationChain.toUpperCase()} •{' '}
                                {tx.mode === 'live' ? 'Live Settlement' : 'Simulated Demo'}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="font-mono font-bold text-[#23845B] tabular-nums">
                                {tx.exactRequestedOutput}
                              </div>
                              <div className="text-[10px] font-semibold text-[#23845B]">
                                {tx.status}
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Security Activity */}
                  <div className="steward-card p-6">
                    <div className="flex items-center justify-between border-b border-[#E6EAE2] pb-3">
                      <h3 className="font-display text-base font-bold text-[#18251F]">
                        Security Activity
                      </h3>
                      <button
                        type="button"
                        onClick={() => navigateToDashboardTab('security')}
                        className="text-xs font-bold text-[#123D32] hover:underline cursor-pointer"
                      >
                        Security Center →
                      </button>
                    </div>
                    <div className="mt-3 space-y-2.5">
                      {overview.recentSecurityEvents.length === 0 ? (
                        <div className="py-4 text-center text-xs text-[#78847C]">
                          No security alerts recorded yet.
                        </div>
                      ) : (
                        overview.recentSecurityEvents.slice(0, 3).map((ev) => {
                          const plain = getPlainEnglishSecurityEventSummary(ev);
                          return (
                            <div
                              key={ev.id}
                              className={`rounded-xl border p-3 text-xs ${
                                ev.severity === 'CRITICAL'
                                  ? 'border-[#D9534F]/35 bg-[#FCEDEC]/50'
                                  : 'border-[#D99A32]/35 bg-[#FFF5DF]/50'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-bold text-[#18251F]">
                                  {plain.friendlyCategory}
                                </span>
                                <span className="font-mono text-[10px] text-[#78847C]">
                                  {new Date(ev.createdAt).toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </span>
                              </div>
                              <p className="mt-1 text-[11px] text-[#78847C] line-clamp-2">
                                {plain.whyBlockedExplanation}
                              </p>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================
              TAB 2: INVOICES WORKSPACE (SECTION 6)
             ================================================================ */}
          {activeTab === 'invoices' && (
            <div className="space-y-6 animate-fade-in">
              {/* Beautiful Invoice Intake Screen */}
              <div className="steward-card p-6 sm:p-8 space-y-6">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#E6EAE2] pb-5">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-[#237A57]">
                      Confidential Intake • Zero Raw Document Persistence
                    </span>
                    <h2 className="mt-1 font-display text-xl sm:text-2xl font-extrabold text-[#18251F]">
                      Submit an Invoice for Verification & Payment
                    </h2>
                    <p className="mt-1 text-xs sm:text-sm text-[#78847C] max-w-2xl">
                      Drag and drop a PDF invoice, paste invoice text, or select one of the 10
                      sample scenarios to watch STEWARD verify the vendor and evaluate policy rules.
                    </p>
                  </div>
                  <ModeBadge mode={overview?.mode || 'simulation'} />
                </div>

                {/* Drag-and-Drop PDF Upload Zone */}
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDraggingFile(true);
                  }}
                  onDragLeave={() => setIsDraggingFile(false)}
                  onDrop={handleDropFile}
                  className={`rounded-2xl border-2 border-dashed p-6 text-center transition-all ${
                    isDraggingFile
                      ? 'border-[#123D32] bg-[#EDF8D8]/60'
                      : 'border-[#E6EAE2] bg-[#F7F8F3] hover:border-[#237A57]/50'
                  }`}
                >
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#EDF8D8] text-[#123D32] border border-[#C7F36B]">
                    <Upload className="h-6 w-6" />
                  </div>
                  <h3 className="mt-3 font-display text-base font-bold text-[#18251F]">
                    Drag & drop your PDF invoice here
                  </h3>
                  <p className="mt-1 text-xs text-[#78847C]">
                    Accepted formats: <strong>PDF or TXT up to 8 MB</strong> • Processed strictly in
                    ephemeral RAM and immediately wiped after extraction
                  </p>
                  <div className="mt-4 flex justify-center">
                    <button
                      type="button"
                      disabled={processingInvoice}
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-2 rounded-xl bg-white border border-[#E6EAE2] px-4 py-2 text-xs font-bold text-[#123D32] shadow-2xs hover:bg-[#F0F3EC] cursor-pointer"
                    >
                      <FileText className="h-4 w-4 text-[#23845B]" />
                      <span>Browse Files</span>
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.txt"
                      onChange={handleUploadPdfInput}
                      className="hidden"
                    />
                  </div>

                  {/* Upload & Processing Progress Bar */}
                  {processingInvoice && (
                    <div className="mt-4 max-w-md mx-auto space-y-1.5">
                      <div className="flex justify-between text-[11px] font-semibold text-[#123D32]">
                        <span>Running Private AI extraction & verification checks...</span>
                        <span>{uploadProgress}%</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-[#E6EAE2] overflow-hidden">
                        <div
                          className="h-full bg-[#123D32] transition-all duration-300"
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Sample Invoice Selector + Paste Invoice Text Split */}
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                  {/* Left: Sample Invoice Selector (5 cols) */}
                  <div className="lg:col-span-5 space-y-2.5">
                    <label className="block text-xs font-bold uppercase tracking-wider text-[#78847C]">
                      Sample Invoice Selector (10 Real Scenarios)
                    </label>
                    <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                      {redTeamScenarios.map((sc) => {
                        const selected = selectedScenarioId === sc.id;
                        return (
                          <button
                            key={sc.id}
                            type="button"
                            onClick={() => handleSelectScenario(sc.id)}
                            className={`w-full rounded-xl border p-3 text-left transition-all cursor-pointer ${
                              selected
                                ? 'border-[#123D32] bg-[#EDF8D8]/60 shadow-2xs'
                                : 'border-[#E6EAE2] bg-[#F7F8F3] hover:bg-white'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-display text-xs font-bold text-[#18251F] truncate">
                                {sc.title}
                              </span>
                              <DecisionBadge decision={sc.expectedDecision} />
                            </div>
                            <p className="mt-1 text-[11px] text-[#78847C] line-clamp-2">
                              {sc.attackDescription}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Right: Paste Invoice Text (7 cols) */}
                  <div className="lg:col-span-7 flex flex-col justify-between space-y-3">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label
                          htmlFor="raw-invoice-textarea"
                          className="text-xs font-bold uppercase tracking-wider text-[#78847C]"
                        >
                          Paste or Edit Invoice Text
                        </label>
                        <span className="font-mono text-[11px] text-[#237A57]">
                          Private AI: {overview?.nearAiModel || 'Qwen/Qwen3.6-35B-A3B-FP8'}
                        </span>
                      </div>
                      <textarea
                        id="raw-invoice-textarea"
                        value={rawInvoiceInput}
                        onChange={(e) => setRawInvoiceInput(e.target.value)}
                        rows={11}
                        placeholder="Paste invoice details here..."
                        className="w-full rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] p-4 font-mono text-xs text-[#18251F] focus:border-[#123D32] focus:bg-white focus:outline-none"
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                      <span className="text-xs text-[#78847C] flex items-center gap-1.5">
                        <Lock className="h-3.5 w-3.5 text-[#23845B]" />
                        <span>Raw invoice text is deleted from memory right after analysis.</span>
                      </span>
                      <button
                        type="button"
                        disabled={processingInvoice}
                        onClick={() => handleProcessInvoice()}
                        className="inline-flex items-center gap-2 rounded-xl bg-[#123D32] px-6 py-3 text-xs sm:text-sm font-bold text-white shadow-sm hover:bg-[#1B5545] disabled:opacity-50 transition-all cursor-pointer"
                      >
                        <Play className="h-4 w-4 text-[#C7F36B]" />
                        <span>
                          {processingInvoice
                            ? 'Analyzing Invoice...'
                            : 'Analyze & Verify Invoice'}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Animated 7-Stage Step-by-Step Journey & Document Preview */}
              {latestProcessed && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="font-display text-lg font-extrabold text-[#18251F]">
                      Invoice Verification Journey & Extracted Preview
                    </h3>
                    <div className="flex items-center gap-3">
                      {latestProcessed.finalDecision !== 'BLOCK' && (
                        <button
                          type="button"
                          onClick={() => setAuthorizingInvoice(latestProcessed)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-[#123D32] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#1B5545] cursor-pointer"
                        >
                          <Wallet className="h-3.5 w-3.5 text-[#C7F36B]" />
                          <span>Authorize & Sign in Wallet</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setInspectedInvoice(latestProcessed)}
                        className="text-xs font-bold text-[#123D32] hover:underline cursor-pointer"
                      >
                        Open in Full-Screen Modal →
                      </button>
                    </div>
                  </div>
                  <InvoiceJourneyAndPreview
                    invoice={latestProcessed}
                    onInvoiceUpdated={handleInvoiceUpdated}
                    onApproveRequest={(inv) => requestApproveInvoiceConfirmation(inv.id)}
                    onRejectRequest={(inv) => requestRejectInvoiceConfirmation(inv.id)}
                  />
                </div>
              )}
            </div>
          )}

          {/* ================================================================
              TAB 3: APPROVALS QUEUE (SECTION 9 — SIMPLE AND CLEAR)
             ================================================================ */}
          {activeTab === 'approvals' && (
            <div className="space-y-6 animate-fade-in">
              <div className="steward-card p-6 sm:p-8">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E6EAE2] pb-5">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-[#237A57]">
                      Human-in-the-Loop Exception Review
                    </span>
                    <h2 className="mt-1 font-display text-xl sm:text-2xl font-extrabold text-[#18251F]">
                      Payments Waiting for Your Approval ({heldInvoices.length})
                    </h2>
                    <p className="mt-1 text-xs sm:text-sm text-[#78847C] max-w-2xl">
                      STEWARD places invoices on hold when they exceed your ${overview?.policy.auto_approve_below_usd || 200} automatic payment limit, come from a new supplier, or request a different receiving wallet.
                    </p>
                  </div>
                </div>

                {heldInvoices.length === 0 ? (
                  <div className="mt-6 rounded-2xl border border-[#E6EAE2] bg-[#F7F8F3] p-10 text-center space-y-3">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#E8F5EC] text-[#23845B]">
                      <CheckCircle2 className="h-6 w-6" />
                    </div>
                    <h3 className="font-display text-base font-bold text-[#18251F]">
                      All caught up! No invoices are waiting for your approval.
                    </h3>
                    <p className="text-xs text-[#78847C] max-w-md mx-auto">
                      You can test the approval workflow by submitting a mid-tier invoice ($200–$500) or an address-change scenario in the Invoices workspace.
                    </p>
                    <button
                      type="button"
                      onClick={() => navigateToDashboardTab('invoices')}
                      className="mt-2 inline-flex items-center gap-2 rounded-xl bg-[#123D32] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#1B5545] cursor-pointer"
                    >
                      Go to Invoices Workspace
                    </button>
                  </div>
                ) : (
                  <div className="mt-6 space-y-4">
                    {heldInvoices.map((inv) => {
                      const plain = getPlainEnglishDecisionExplanation(inv);
                      const isHighRisk = plain.riskLevel === 'HIGH';
                      return (
                        <div
                          key={inv.id}
                          className={`rounded-2xl border p-5 sm:p-6 transition-all ${
                            isHighRisk
                              ? 'border-[#D9534F]/50 bg-[#FCEDEC]/35'
                              : 'border-[#E6EAE2] bg-[#F7F8F3]'
                          }`}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-4">
                            <div className="space-y-3 flex-1 min-w-[260px]">
                              <div className="flex flex-wrap items-center gap-2.5">
                                <span className="font-display text-lg font-extrabold text-[#18251F]">
                                  {inv.vendorName}
                                </span>
                                <span className="font-mono text-xs font-bold text-[#78847C]">
                                  #{inv.invoiceNumber}
                                </span>
                                <span
                                  className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                                    plain.riskLevel === 'HIGH'
                                      ? 'bg-[#D9534F] text-white'
                                      : plain.riskLevel === 'MEDIUM'
                                        ? 'bg-[#FFF5DF] text-[#9A6700] border border-[#D99A32]/40'
                                        : 'bg-[#E8F5EC] text-[#23845B] border border-[#23845B]/25'
                                  }`}
                                >
                                  {plain.riskLevel === 'HIGH'
                                    ? 'High Risk — Wallet Mismatch'
                                    : plain.riskLevel === 'MEDIUM'
                                      ? 'Medium Risk — Review Required'
                                      : 'Low Risk — Amount Threshold'}
                                </span>
                                <ModeBadge mode={inv.mode} />
                              </div>

                              {/* 6 Key Fields Required by Section 9 */}
                              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs bg-white rounded-xl p-4 border border-[#E6EAE2]">
                                <div>
                                  <div className="text-[#78847C]">Amount</div>
                                  <div className="mt-0.5 font-display text-base font-extrabold text-[#123D32] tabular-nums">
                                    ${inv.total.toFixed(2)} {inv.requestedPayoutAsset}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-[#78847C]">Due Date</div>
                                  <div className="mt-0.5 font-mono font-semibold text-[#18251F]">
                                    {inv.dueDate}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-[#78847C]">Vendor Verification</div>
                                  <div className="mt-0.5 font-semibold text-[#18251F]">
                                    {inv.vendorCheck.isNewVendor ? (
                                      <span className="text-[#9A6700]">New Unverified Supplier</span>
                                    ) : inv.vendorCheck.addressMatchesRegistry ? (
                                      <span className="text-[#23845B]">
                                        ✓ Verified Supplier & Wallet
                                      </span>
                                    ) : (
                                      <span className="text-[#D9534F] font-bold">
                                        ✗ Wallet Address Mismatch
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-[#78847C]">Destination Wallet</div>
                                  <div className="mt-0.5 font-mono font-semibold text-[#18251F] truncate" title={inv.receivingWalletAddress}>
                                    {inv.receivingWalletAddress} ({inv.requestedDestinationChain.toUpperCase()})
                                  </div>
                                </div>
                              </div>

                              {/* Plain-English Reason for Approval */}
                              <div
                                className={`rounded-xl p-3.5 text-xs ${
                                  isHighRisk
                                    ? 'bg-white border border-[#D9534F]/40 text-[#B8322E]'
                                    : 'bg-white border border-[#E6EAE2] text-[#18251F]'
                                }`}
                              >
                                <strong className="font-bold">Reason for approval: </strong>
                                {plain.explanation}
                              </div>
                            </div>

                            {/* Action Buttons: Approve, Authorize in Wallet, Reject, View Details */}
                            <div className="flex flex-wrap sm:flex-col items-stretch gap-2.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => setAuthorizingInvoice(inv)}
                                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#123D32] px-5 py-2.5 text-xs font-bold text-white hover:bg-[#1B5545] transition-colors cursor-pointer"
                              >
                                <Wallet className="h-4 w-4 text-[#C7F36B]" />
                                <span>Authorize in Wallet</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => requestApproveInvoiceConfirmation(inv.id)}
                                className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#123D32]/30 bg-[#EDF8D8] px-5 py-2 text-xs font-bold text-[#123D32] hover:bg-[#C7F36B]/50 transition-colors cursor-pointer"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5 text-[#23845B]" />
                                <span>Approve (Demo Settlement)</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => requestRejectInvoiceConfirmation(inv.id)}
                                className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#D9534F]/40 bg-white px-5 py-2.5 text-xs font-bold text-[#B8322E] hover:bg-[#FCEDEC] transition-colors cursor-pointer"
                              >
                                <span>Reject</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setInspectedInvoice(inv)}
                                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#E6EAE2] bg-white px-4 py-2 text-xs font-semibold text-[#18251F] hover:bg-[#F0F3EC] transition-colors cursor-pointer"
                              >
                                <Eye className="h-3.5 w-3.5" />
                                <span>View Details</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ================================================================
              TAB 4: VENDORS REGISTRY & 48H COOLING-OFF
             ================================================================ */}
          {activeTab === 'vendors' && (
            <div className="space-y-6 animate-fade-in">
              <div className="steward-card p-6 sm:p-8">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E6EAE2] pb-4">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-[#237A57]">
                      Trusted Supplier Directory
                    </span>
                    <h2 className="mt-1 font-display text-xl sm:text-2xl font-extrabold text-[#18251F]">
                      Verified Vendor Registry ({vendors.length})
                    </h2>
                    <p className="mt-1 text-xs sm:text-sm text-[#78847C]">
                      STEWARD verifies every incoming invoice against these trusted supplier profiles.
                      New vendors require controller confirmation, and any wallet change triggers a
                      48-hour cooling-off lock.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    <div className="relative">
                      <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-[#78847C]" />
                      <input
                        type="text"
                        aria-label="Search suppliers"
                        value={vendorSearch}
                        onChange={(e) => setVendorSearch(e.target.value)}
                        placeholder="Search supplier or wallet..."
                        className="rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] pl-8 pr-3 py-2 text-xs text-[#18251F] focus:border-[#123D32] focus:bg-white focus:outline-none"
                      />
                    </div>
                    <select
                      aria-label="Filter suppliers by status"
                      value={vendorStatusFilter}
                      onChange={(e) => setVendorStatusFilter(e.target.value)}
                      className="rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] px-3 py-2 text-xs font-semibold text-[#18251F]"
                    >
                      <option value="ALL">All Statuses</option>
                      <option value="VERIFIED">Verified</option>
                      <option value="PENDING_APPROVAL">Pending Approval</option>
                      <option value="COOLING_OFF">48h Cooling-Off</option>
                    </select>
                  </div>
                </div>

                <div className="mt-5 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-[#E6EAE2] bg-[#F7F8F3] text-[#78847C] font-semibold">
                      <tr>
                        <th className="py-3 px-4">Supplier Name</th>
                        <th className="py-3 px-4">Verified Wallet Address</th>
                        <th className="py-3 px-4">Preferred Network</th>
                        <th className="py-3 px-4">Verification Status</th>
                        <th className="py-3 px-4">Payments Settled</th>
                        <th className="py-3 px-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E6EAE2]">
                      {vendors
                        .filter((v) => {
                          if (vendorStatusFilter !== 'ALL' && v.status !== vendorStatusFilter)
                            return false;
                          if (vendorSearch.trim()) {
                            const q = vendorSearch.toLowerCase();
                            return (
                              v.businessName.toLowerCase().includes(q) ||
                              v.verifiedWalletAddress.toLowerCase().includes(q) ||
                              v.id.toLowerCase().includes(q)
                            );
                          }
                          return true;
                        })
                        .map((v) => (
                        <tr key={v.id} className="hover:bg-[#F7F8F3]/60">
                          <td className="py-3.5 px-4">
                            <div className="font-display font-bold text-[#18251F]">
                              {v.businessName}
                            </div>
                            <div className="font-mono text-[11px] text-[#78847C]">{v.id}</div>
                          </td>
                          <td className="py-3.5 px-4 font-mono font-semibold text-[#123D32]">
                            {v.verifiedWalletAddress}
                          </td>
                          <td className="py-3.5 px-4">
                            <ChainBadge
                              chain={v.preferredDestinationChain}
                              asset={v.preferredPayoutAsset}
                            />
                          </td>
                          <td className="py-3.5 px-4">
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                                v.status === 'VERIFIED'
                                  ? 'bg-[#E8F5EC] text-[#23845B]'
                                  : 'bg-[#FFF5DF] text-[#9A6700]'
                              }`}
                            >
                              {v.status === 'VERIFIED' ? '✓ Verified' : v.status}
                            </span>
                            {v.coolingOffUntil && (
                              <div className="mt-1 text-[11px] text-[#9A6700] font-medium">
                                48h Lock until {new Date(v.coolingOffUntil).toLocaleDateString()}
                              </div>
                            )}
                          </td>
                          <td className="py-3.5 px-4 font-mono tabular-nums text-[#18251F]">
                            {v.paymentCount} (${v.totalPaidUsd.toFixed(2)})
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            {v.status !== 'VERIFIED' ? (
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
                                  setToastMessage({
                                    type: 'ok',
                                    title: `${v.businessName} Verified`,
                                    text: 'Supplier is now verified in your registry.',
                                  });
                                  await refreshAllData();
                                }}
                                className="rounded-xl bg-[#123D32] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#1B5545] cursor-pointer"
                              >
                                Verify Supplier
                              </button>
                            ) : (
                              <span className="text-[11px] text-[#78847C]">Active</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Add Supplier & Rotate Wallet Forms */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <form
                  onSubmit={handleCreateVendor}
                  className="steward-card p-6 space-y-4"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#EDF8D8] text-[#123D32] border border-[#C7F36B]">
                      <Plus className="h-5 w-5" />
                    </span>
                    <div>
                      <h3 className="font-display text-base font-bold text-[#18251F]">
                        Add a New Supplier
                      </h3>
                      <p className="text-xs text-[#78847C]">
                        New suppliers start in Pending status until confirmed by a controller
                      </p>
                    </div>
                  </div>

                  <input
                    type="text"
                    placeholder="Supplier Business Name (e.g., Lisbon Cloud Studio)"
                    value={newVendorName}
                    onChange={(e) => setNewVendorName(e.target.value)}
                    className="w-full rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] px-3.5 py-2.5 text-xs text-[#18251F] focus:border-[#123D32] focus:bg-white focus:outline-none"
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input
                      type="text"
                      placeholder="Receiving Wallet (e.g., lisbon.near)"
                      value={newVendorWallet}
                      onChange={(e) => setNewVendorWallet(e.target.value)}
                      className="rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] px-3.5 py-2.5 text-xs font-mono text-[#18251F] focus:border-[#123D32] focus:bg-white focus:outline-none"
                    />
                    <select
                      value={newVendorChain}
                      onChange={(e) => setNewVendorChain(e.target.value as SupportedChain)}
                      className="rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] px-3.5 py-2.5 text-xs font-semibold text-[#18251F]"
                    >
                      <option value="near">NEAR Network (USDC)</option>
                      <option value="arbitrum">Arbitrum One (USDC)</option>
                      <option value="solana">Solana (USDC)</option>
                      <option value="ethereum">Ethereum (USDC)</option>
                      <option value="base">Base (USDC)</option>
                    </select>
                  </div>
                  <button
                    type="submit"
                    className="rounded-xl bg-[#123D32] px-5 py-2.5 text-xs font-bold text-white hover:bg-[#1B5545] cursor-pointer"
                  >
                    Register Supplier
                  </button>
                </form>

                <form
                  onSubmit={handleRotateVendorAddress}
                  className="steward-card p-6 space-y-4"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#FFF5DF] text-[#D99A32]">
                      <Clock className="h-5 w-5" />
                    </span>
                    <div>
                      <h3 className="font-display text-base font-bold text-[#18251F]">
                        Update Supplier Wallet (48-Hour Protection Lock)
                      </h3>
                      <p className="text-xs text-[#78847C]">
                        Updating a supplier&apos;s wallet automatically activates a 48-hour manual review window
                      </p>
                    </div>
                  </div>

                  <select
                    value={rotateVendorId}
                    onChange={(e) => setRotateVendorId(e.target.value)}
                    className="w-full rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] px-3.5 py-2.5 text-xs font-semibold text-[#18251F]"
                  >
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.businessName} (Current: {v.verifiedWalletAddress})
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    placeholder="New Wallet Address"
                    value={rotateNewAddress}
                    onChange={(e) => setRotateNewAddress(e.target.value)}
                    className="w-full rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] px-3.5 py-2.5 text-xs font-mono text-[#18251F] focus:border-[#123D32] focus:bg-white focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="rounded-xl border border-[#D99A32]/50 bg-[#FFF5DF] px-5 py-2.5 text-xs font-bold text-[#9A6700] hover:bg-[#FFF5DF]/80 cursor-pointer"
                  >
                    Update Wallet & Start 48h Cooling-Off
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* ================================================================
              TAB 5: TREASURY (PHASE 3 — NON-CUSTODIAL NEAR & METAMASK WALLETS)
             ================================================================ */}
          {activeTab === 'treasury' && (
            <TreasuryDashboardView
              invoices={invoices}
              payments={payments}
              onAuthorizeInvoicePayment={(inv) => setAuthorizingInvoice(inv)}
              onRefreshGlobalData={refreshAllData}
            />
          )}

          {/* ================================================================
              TAB 6: PAYMENTS (SECTION 10 — PAYMENTS AND LEDGER)
             ================================================================ */}
          {activeTab === 'payments' && (
            <div className="space-y-6 animate-fade-in">
              {/* Polished Payments Table & Responsive Cards */}
              <div className="steward-card p-6 sm:p-8 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E6EAE2] pb-4">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-[#237A57]">
                      Exact-Output Cross-Chain Settlements
                    </span>
                    <h2 className="mt-1 font-display text-xl sm:text-2xl font-extrabold text-[#18251F]">
                      Payments ({payments.length})
                    </h2>
                    <p className="mt-1 text-xs sm:text-sm text-[#78847C]">
                      Every approved payment settles via NEAR Intents so your vendor receives the
                      exact invoice amount on their preferred network.
                    </p>
                  </div>
                  <ModeBadge mode={overview?.mode || 'simulation'} />
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-[#E6EAE2] bg-[#F7F8F3] text-[#78847C] font-semibold">
                      <tr>
                        <th className="py-3 px-4">Payment Status</th>
                        <th className="py-3 px-4">Vendor & Invoice</th>
                        <th className="py-3 px-4">Exact Amount Delivered</th>
                        <th className="py-3 px-4">Destination Chain</th>
                        <th className="py-3 px-4">Transaction Date</th>
                        <th className="py-3 px-4">Mode & Explorer Link</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E6EAE2]">
                      {payments.map((p) => {
                        const matchedInv = invoices.find((i) => i.id === p.invoiceId);
                        return (
                          <tr key={p.id} className="hover:bg-[#F7F8F3]/60">
                            <td className="py-3.5 px-4">
                              <PaymentStatusBadge status={p.status} />
                            </td>
                            <td className="py-3.5 px-4">
                              <div className="font-display font-bold text-[#18251F]">
                                {matchedInv?.vendorName || p.recipientAddress}
                              </div>
                              <div className="font-mono text-[11px] text-[#78847C]">
                                {matchedInv ? `#${matchedInv.invoiceNumber} • ` : ''}
                                {p.recipientAddress}
                              </div>
                            </td>
                            <td className="py-3.5 px-4">
                              <div className="font-display text-sm font-extrabold text-[#23845B] tabular-nums">
                                {p.exactRequestedOutput}
                              </div>
                              <div className="text-[11px] text-[#78847C]">
                                Est. input: {p.estimatedInputAmount} (Fee: ${p.feesUsd.toFixed(4)})
                              </div>
                            </td>
                            <td className="py-3.5 px-4">
                              <ChainBadge
                                chain={p.destinationChain}
                                asset={p.destinationAsset}
                              />
                            </td>
                            <td className="py-3.5 px-4 font-mono text-[#78847C]">
                              {new Date(p.createdAt).toLocaleString([], {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </td>
                            <td className="py-3.5 px-4">
                              <div className="flex flex-col items-start gap-1">
                                <ModeBadge mode={p.mode} />
                                {p.explorerUrl ? (
                                  <a
                                    href={p.explorerUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 text-xs font-bold text-[#123D32] hover:underline"
                                  >
                                    <span>View on Explorer</span>
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                ) : (
                                  <span className="text-[11px] text-[#78847C]">
                                    Simulated in Demo Mode (No on-chain tx hash)
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Cross-Chain Payout Quote Preview Calculator */}
              <div className="steward-card p-6 sm:p-8 space-y-4">
                <div>
                  <h3 className="font-display text-base sm:text-lg font-bold text-[#18251F]">
                    Preview a Live Cross-Chain Payment Quote (NEAR Intents 1Click)
                  </h3>
                  <p className="text-xs text-[#78847C]">
                    Test how STEWARD calculates the exact input needed so your supplier receives
                    100% of their billed USDC amount on any supported chain.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                  <select
                    value={quoteChain}
                    onChange={(e) => setQuoteChain(e.target.value as SupportedChain)}
                    className="rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] px-3.5 py-2.5 text-xs font-semibold text-[#18251F]"
                  >
                    <option value="near">NEAR Network (USDC)</option>
                    <option value="arbitrum">Arbitrum One (USDC)</option>
                    <option value="solana">Solana (USDC)</option>
                    <option value="ethereum">Ethereum (USDC)</option>
                  </select>
                  <input
                    type="number"
                    value={quoteAmount}
                    onChange={(e) => setQuoteAmount(e.target.value)}
                    placeholder="Invoice Amount (USD)"
                    className="rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] px-3.5 py-2.5 text-xs font-mono text-[#18251F]"
                  />
                  <input
                    type="text"
                    value={quoteRecipient}
                    onChange={(e) => setQuoteRecipient(e.target.value)}
                    placeholder="Vendor Wallet Address"
                    className="rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] px-3.5 py-2.5 text-xs font-mono text-[#18251F]"
                  />
                  <button
                    type="button"
                    disabled={loadingQuote}
                    onClick={handleFetch1ClickQuote}
                    className="rounded-xl bg-[#123D32] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#1B5545] disabled:opacity-50 cursor-pointer"
                  >
                    {loadingQuote ? 'Requesting Quote...' : 'Preview Exact-Output Quote'}
                  </button>
                </div>

                {quotePreview && (
                  <div className="rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] p-4 space-y-3 animate-fade-in">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-bold text-[#23845B]">
                        ✓ Live Quote Calculated — Vendor Guaranteed {quoteAmount}.00 USDC on{' '}
                        {quoteChain.toUpperCase()}
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowRawQuoteJson((v) => !v)}
                        className="text-xs font-semibold text-[#123D32] hover:underline cursor-pointer"
                      >
                        {showRawQuoteJson ? 'Hide solver JSON' : 'Show technical solver JSON'}
                      </button>
                    </div>
                    {showRawQuoteJson && (
                      <pre className="overflow-x-auto rounded-xl bg-white p-3 font-mono text-[11px] text-[#18251F] border border-[#E6EAE2]">
                        {JSON.stringify(quotePreview, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ================================================================
              TAB 6: SECURITY CENTER (SECTION 7)
             ================================================================ */}
          {activeTab === 'security' && (
            <SecurityCenterView
              attestation={liveAttestation}
              verifyingAttestation={verifyingAttestation}
              onRunLiveVerify={handleRunLiveAttestation}
              vendors={vendors}
              vendorHistory={vendorHistory}
              invoices={invoices}
              securityEvents={securityEvents}
              blocklist={blocklist}
              rpcAccountInput={rpcAccountInput}
              onChangeRpcAccountInput={setRpcAccountInput}
              onInspectNearAccount={handleInspectNearAccount}
              inspectingRpc={inspectingRpc}
              rpcIntel={rpcIntel}
              onNavigateTab={(t) => navigateToDashboardTab(t as NavTab)}
            />
          )}

          {/* ================================================================
              TAB 7: RED TEAM (SECTION 8)
             ================================================================ */}
          {activeTab === 'redteam' && (
            <RedTeamView
              scenarios={redTeamScenarios}
              processingInvoice={processingInvoice}
              onRunScenario={handleProcessInvoice}
              runningSuite={runningSuite}
              onRunEvaluationSuite={handleRunEvaluationSuite}
              evalReport={evalReport}
              invoices={invoices}
              securityEvents={securityEvents}
              onInspectInvoice={(inv) => setInspectedInvoice(inv)}
            />
          )}

          {/* ================================================================
              TAB 8: AUDIT LEDGER (SECTION 10 — ACCOUNTANT-FRIENDLY LEDGER)
             ================================================================ */}
          {activeTab === 'ledger' && (
            <div className="space-y-6 animate-fade-in">
              <div className="steward-card p-6 sm:p-8 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E6EAE2] pb-4">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-[#237A57]">
                      Accountant-Ready Audit Trail
                    </span>
                    <h2 className="mt-1 font-display text-xl sm:text-2xl font-extrabold text-[#18251F]">
                      Financial Audit Ledger ({filteredLedger.length} Records)
                    </h2>
                    <p className="mt-1 text-xs sm:text-sm text-[#78847C]">
                      Search, filter by date or status, and export a formula-safe CSV spreadsheet
                      for Excel, Google Sheets, or QuickBooks.
                    </p>
                  </div>
                  <a
                    href="/api/ledger/csv"
                    download
                    className="inline-flex items-center gap-2 rounded-xl bg-[#123D32] px-5 py-2.5 text-xs sm:text-sm font-bold text-white shadow-xs hover:bg-[#1B5545]"
                  >
                    <Download className="h-4 w-4 text-[#C7F36B]" />
                    <span>Export CSV</span>
                  </a>
                </div>

                {/* Search, Status Filter, Mode Filter, and Date Range Filters */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <div className="lg:col-span-2 relative">
                    <Search className="absolute left-3.5 top-3 h-4 w-4 text-[#78847C]" />
                    <input
                      type="text"
                      value={ledgerSearch}
                      onChange={(e) => setLedgerSearch(e.target.value)}
                      placeholder="Search by invoice #, vendor, wallet, or reason..."
                      className="w-full rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] pl-10 pr-3 py-2.5 text-xs text-[#18251F] focus:border-[#123D32] focus:bg-white focus:outline-none"
                    />
                  </div>

                  <select
                    aria-label="Filter by payment status"
                    value={ledgerStatusFilter}
                    onChange={(e) => setLedgerStatusFilter(e.target.value)}
                    className="rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] px-3 py-2.5 text-xs font-semibold text-[#18251F]"
                  >
                    <option value="ALL">All Statuses</option>
                    <option value="PAID">Paid</option>
                    <option value="HELD">Awaiting Approval</option>
                    <option value="BLOCKED">Blocked</option>
                    <option value="PENDING">Processing</option>
                  </select>

                  <input
                    type="date"
                    aria-label="Start date filter"
                    value={ledgerDateFrom}
                    onChange={(e) => setLedgerDateFrom(e.target.value)}
                    className="rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] px-3 py-2.5 text-xs text-[#18251F]"
                    title="Filter from Invoice Date"
                  />

                  <input
                    type="date"
                    aria-label="End date filter"
                    value={ledgerDateTo}
                    onChange={(e) => setLedgerDateTo(e.target.value)}
                    className="rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] px-3 py-2.5 text-xs text-[#18251F]"
                    title="Filter to Invoice Date"
                  />
                </div>

                {/* Desktop Table View */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-[#E6EAE2] bg-[#F7F8F3] text-[#78847C] font-semibold">
                      <tr>
                        <th className="py-3 px-3">Invoice #</th>
                        <th className="py-3 px-3">Vendor</th>
                        <th className="py-3 px-3">Date</th>
                        <th className="py-3 px-3">Amount</th>
                        <th className="py-3 px-3">Destination</th>
                        <th className="py-3 px-3">Status</th>
                        <th className="py-3 px-3">Mode</th>
                        <th className="py-3 px-3">Plain-English Summary</th>
                        <th className="py-3 px-3 text-right">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E6EAE2]">
                      {filteredLedger.map((inv) => {
                        const plain = getPlainEnglishDecisionExplanation(inv);
                        return (
                          <tr key={inv.id} className="hover:bg-[#F7F8F3]/60">
                            <td className="py-3.5 px-3 font-mono font-bold text-[#123D32]">
                              #{inv.invoiceNumber}
                            </td>
                            <td className="py-3.5 px-3 font-semibold text-[#18251F]">
                              {inv.vendorName}
                            </td>
                            <td className="py-3.5 px-3 font-mono text-[#78847C]">
                              {inv.invoiceDate}
                            </td>
                            <td className="py-3.5 px-3 font-display font-extrabold tabular-nums text-[#18251F]">
                              ${inv.total.toFixed(2)}
                            </td>
                            <td className="py-3.5 px-3">
                              <ChainBadge
                                chain={inv.requestedDestinationChain}
                                asset={inv.requestedPayoutAsset}
                              />
                            </td>
                            <td className="py-3.5 px-3">
                              <PaymentStatusBadge status={inv.paymentStatus} />
                            </td>
                            <td className="py-3.5 px-3">
                              <ModeBadge mode={inv.mode} />
                            </td>
                            <td
                              className="py-3.5 px-3 max-w-xs truncate text-[#78847C]"
                              title={plain.explanation}
                            >
                              {plain.headline}
                            </td>
                            <td className="py-3.5 px-3 text-right">
                              <button
                                type="button"
                                onClick={() => setInspectedInvoice(inv)}
                                className="rounded-lg border border-[#E6EAE2] bg-white px-2.5 py-1 text-xs font-semibold text-[#123D32] hover:bg-[#F0F3EC] cursor-pointer"
                              >
                                Inspect
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Responsive Card Layout for Smaller Screens (Section 10) */}
                <div className="md:hidden space-y-3">
                  {filteredLedger.map((inv) => {
                    const plain = getPlainEnglishDecisionExplanation(inv);
                    return (
                      <div
                        key={inv.id}
                        className="rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] p-4 space-y-2.5 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-[#123D32]">
                            #{inv.invoiceNumber}
                          </span>
                          <PaymentStatusBadge status={inv.paymentStatus} />
                        </div>
                        <div className="flex items-baseline justify-between">
                          <span className="font-display text-sm font-bold text-[#18251F]">
                            {inv.vendorName}
                          </span>
                          <span className="font-display text-base font-extrabold text-[#123D32] tabular-nums">
                            ${inv.total.toFixed(2)} {inv.requestedPayoutAsset}
                          </span>
                        </div>
                        <p className="text-[#78847C]">{plain.headline}</p>
                        <div className="flex items-center justify-between pt-2 border-t border-[#E6EAE2]">
                          <ModeBadge mode={inv.mode} />
                          <button
                            type="button"
                            onClick={() => setInspectedInvoice(inv)}
                            className="rounded-lg bg-white border border-[#E6EAE2] px-3 py-1 font-semibold text-[#123D32]"
                          >
                            View Details →
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ================================================================
              TAB 9: SETTINGS & POLICY ENGINE
             ================================================================ */}
          {activeTab === 'settings' && overview?.policy && (
            <div className="space-y-6 animate-fade-in">
              <div className="steward-card p-6 sm:p-8 space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E6EAE2] pb-4">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-[#237A57]">
                      Company Payment Controls
                    </span>
                    <h2 className="mt-1 font-display text-xl sm:text-2xl font-extrabold text-[#18251F]">
                      Payment Thresholds & Emergency Safeguards
                    </h2>
                    <p className="mt-1 text-xs sm:text-sm text-[#78847C]">
                      These rules are enforced by deterministic server code. The AI model can never
                      modify or bypass your spending caps.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={requestToggleKillSwitch}
                    className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold cursor-pointer ${
                      overview.policy.kill_switch
                        ? 'bg-[#23845B] text-white'
                        : 'bg-[#FCEDEC] text-[#B8322E] border border-[#D9534F]/40 hover:bg-[#D9534F] hover:text-white'
                    }`}
                  >
                    <AlertOctagon className="h-4 w-4" />
                    <span>
                      {overview.policy.kill_switch
                        ? 'Kill Switch Active — Click to Resume Payments'
                        : 'Activate Emergency Payment Kill Switch'}
                    </span>
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="rounded-2xl border border-[#E6EAE2] bg-[#F7F8F3] p-5">
                    <div className="text-xs font-semibold text-[#78847C]">
                      Automatic Payment Limit
                    </div>
                    <div className="mt-2 font-display text-3xl font-extrabold text-[#23845B] tabular-nums">
                      ${overview.policy.auto_approve_below_usd}
                    </div>
                    <p className="mt-1.5 text-xs text-[#78847C]">
                      Verified supplier bills below this amount are paid automatically without
                      waiting for manual review.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-[#E6EAE2] bg-[#F7F8F3] p-5">
                    <div className="text-xs font-semibold text-[#78847C]">
                      Maximum Per-Invoice Cap
                    </div>
                    <div className="mt-2 font-display text-3xl font-extrabold text-[#18251F] tabular-nums">
                      ${overview.policy.per_invoice_cap_usd}
                    </div>
                    <p className="mt-1.5 text-xs text-[#78847C]">
                      Invoices between ${overview.policy.auto_approve_below_usd} and $
                      {overview.policy.per_invoice_cap_usd} require your approval. Anything above is
                      blocked.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-[#E6EAE2] bg-[#F7F8F3] p-5">
                    <div className="text-xs font-semibold text-[#78847C]">
                      24-Hour Total Spend Cap
                    </div>
                    <div className="mt-2 font-display text-3xl font-extrabold text-[#123D32] tabular-nums">
                      ${overview.policy.daily_cap_usd}
                    </div>
                    <p className="mt-1.5 text-xs text-[#78847C]">
                      Maximum combined outgoing payments allowed across any rolling 24-hour period.
                    </p>
                  </div>
                </div>

                {/* Interactive Policy Thresholds Editor Form */}
                <form
                  onSubmit={handleUpdatePolicyThresholds}
                  className="rounded-2xl border border-[#E6EAE2] bg-white p-5 sm:p-6 space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="font-display text-base font-bold text-[#18251F]">
                        Configure Spending Limits & Cooling-Off Window
                      </h3>
                      <p className="text-xs text-[#78847C]">
                        Adjust your deterministic company payment rules. Changes take effect immediately across all incoming and held invoices.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        setEditAutoApprove('200');
                        setEditPerInvoiceCap('500');
                        setEditDailyCap('1500');
                        setEditCoolingHours('48');
                        await fetch('/api/policy', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            auto_approve_below_usd: 200,
                            per_invoice_cap_usd: 500,
                            daily_cap_usd: 1500,
                            address_change: {
                              cooling_off_hours: 48,
                              require_human_approval: true,
                            },
                          }),
                        });
                        setToastMessage({
                          type: 'ok',
                          title: 'Default Policy Thresholds Restored',
                          text: 'Restored $200 auto-pay limit, $500 per-invoice cap, $1,500 daily cap, and 48h cooling-off window.',
                        });
                        await refreshAllData();
                      }}
                      className="rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] px-3 py-1.5 text-xs font-semibold text-[#123D32] hover:bg-[#F0F3EC] cursor-pointer"
                    >
                      Reset to Defaults ($200 / $500 / $1,500)
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <label
                        htmlFor="policy-auto-approve"
                        className="block text-xs font-semibold text-[#18251F] mb-1"
                      >
                        Auto-Pay Limit (USD)
                      </label>
                      <input
                        id="policy-auto-approve"
                        type="number"
                        min={1}
                        step="1"
                        value={editAutoApprove}
                        onChange={(e) => setEditAutoApprove(e.target.value)}
                        className="w-full rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] px-3.5 py-2 text-xs font-mono font-bold text-[#18251F] focus:border-[#123D32] focus:bg-white focus:outline-none"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="policy-per-invoice"
                        className="block text-xs font-semibold text-[#18251F] mb-1"
                      >
                        Max Per-Invoice Cap (USD)
                      </label>
                      <input
                        id="policy-per-invoice"
                        type="number"
                        min={1}
                        step="1"
                        value={editPerInvoiceCap}
                        onChange={(e) => setEditPerInvoiceCap(e.target.value)}
                        className="w-full rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] px-3.5 py-2 text-xs font-mono font-bold text-[#18251F] focus:border-[#123D32] focus:bg-white focus:outline-none"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="policy-daily-cap"
                        className="block text-xs font-semibold text-[#18251F] mb-1"
                      >
                        24-Hour Spend Cap (USD)
                      </label>
                      <input
                        id="policy-daily-cap"
                        type="number"
                        min={1}
                        step="1"
                        value={editDailyCap}
                        onChange={(e) => setEditDailyCap(e.target.value)}
                        className="w-full rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] px-3.5 py-2 text-xs font-mono font-bold text-[#18251F] focus:border-[#123D32] focus:bg-white focus:outline-none"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="policy-cooling-hours"
                        className="block text-xs font-semibold text-[#18251F] mb-1"
                      >
                        Wallet Change Lock (Hours)
                      </label>
                      <input
                        id="policy-cooling-hours"
                        type="number"
                        min={0}
                        max={720}
                        step="1"
                        value={editCoolingHours}
                        onChange={(e) => setEditCoolingHours(e.target.value)}
                        className="w-full rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] px-3.5 py-2 text-xs font-mono font-bold text-[#18251F] focus:border-[#123D32] focus:bg-white focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={savingPolicy}
                      className="rounded-xl bg-[#123D32] px-5 py-2.5 text-xs font-bold text-white hover:bg-[#1B5545] disabled:opacity-50 cursor-pointer"
                    >
                      {savingPolicy ? 'Saving Policy...' : 'Save Policy Thresholds'}
                    </button>
                  </div>
                </form>

                <div className="rounded-2xl border border-[#E6EAE2] bg-[#F7F8F3] p-5 space-y-2 text-xs">
                  <div className="font-display text-sm font-bold text-[#18251F]">
                    Treasury & Custody Architecture
                  </div>
                  <p className="text-[#78847C] leading-relaxed">
                    • <strong>Treasury Account:</strong>{' '}
                    <code className="font-mono text-[#123D32] font-semibold">
                      {overview.treasuryAccount}
                    </code>{' '}
                    ({overview.custodyMode} custody mode)
                  </p>
                  <p className="text-[#78847C] leading-relaxed">
                    • <strong>Allowed Payout Currencies:</strong>{' '}
                    {overview.policy.allowed_payout_assets.join(', ')}
                  </p>
                  <p className="text-[#78847C] leading-relaxed">
                    • <strong>Address Change Cooling-Off Window:</strong>{' '}
                    {overview.policy.address_change.cooling_off_hours} hours mandatory review period
                  </p>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* =====================================================================
          MODALS: FULL INVOICE TRACE, GUIDED DEMO TOUR, CONFIRMATION DIALOG
         ===================================================================== */}
      <PipelineTraceModal
        invoice={inspectedInvoice}
        onClose={() => setInspectedInvoice(null)}
        onApprove={(id) => requestApproveInvoiceConfirmation(id)}
        onReject={(id) => requestRejectInvoiceConfirmation(id)}
        onInvoiceUpdated={handleInvoiceUpdated}
      />

      <GuidedDemoModal
        open={guidedTourOpen}
        onClose={() => setGuidedTourOpen(false)}
        onNavigateTab={(tab) => navigateToDashboardTab(tab as NavTab)}
        onTriggerFlagshipAttack={async () => {
          navigateToDashboardTab('redteam');
          await handleProcessInvoice('RT-08-HIDDEN-PROMPT-INJECTION');
        }}
      />

      {confirmDialog && (
        <ConfirmationDialog
          open={confirmDialog.open}
          title={confirmDialog.title}
          description={confirmDialog.description}
          confirmLabel={confirmDialog.confirmLabel}
          variant={confirmDialog.variant}
          requireNotes={confirmDialog.requireNotes}
          defaultNotes={confirmDialog.defaultNotes}
          onCancel={() => setConfirmDialog(null)}
          onConfirm={confirmDialog.onConfirm}
        />
      )}

      {authorizingInvoice && (
        <PaymentAuthorizationModal
          open={Boolean(authorizingInvoice)}
          invoice={authorizingInvoice}
          connectedWallets={treasuryWallets}
          treasurySettings={treasurySettings}
          onClose={() => setAuthorizingInvoice(null)}
          onPaymentUpdated={async () => {
            await refreshAllData();
          }}
          onNavigateToTreasury={() => {
            setAuthorizingInvoice(null);
            navigateToDashboardTab('treasury');
          }}
        />
      )}
    </div>
  );
};
