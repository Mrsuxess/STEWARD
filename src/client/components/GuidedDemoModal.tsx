import React, { useState } from 'react';
import {
  X,
  Sparkles,
  FileText,
  Building2,
  CheckSquare,
  ShieldAlert,
  Swords,
  BookOpenCheck,
  Download,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Lock,
} from 'lucide-react';

export interface GuidedTourProps {
  open: boolean;
  onClose: () => void;
  onNavigateTab: (tab: string) => void;
  onTriggerFlagshipAttack: () => void;
}

export const GuidedDemoModal: React.FC<GuidedTourProps> = ({
  open,
  onClose,
  onNavigateTab,
  onTriggerFlagshipAttack,
}) => {
  if (!open) return null;

  const tourItems = [
    {
      title: '1. Sample Invoices & Live Intake',
      desc: 'Upload a PDF or test 10 pre-built invoice scenarios (legitimate, over-limit, duplicate, and tampered) and watch the 7-stage verification journey.',
      icon: <FileText className="h-5 w-5 text-[#123D32]" />,
      actionLabel: 'Open Invoices Workspace',
      onClick: () => {
        onNavigateTab('invoices');
        onClose();
      },
    },
    {
      title: '2. Vendor Verification & 48h Lock',
      desc: 'Explore your Verified Vendor Registry, onboard a new supplier, or test how a wallet change triggers a mandatory 48-hour cooling-off lock.',
      icon: <Building2 className="h-5 w-5 text-[#123D32]" />,
      actionLabel: 'Explore Vendors',
      onClick: () => {
        onNavigateTab('vendors');
        onClose();
      },
    },
    {
      title: '3. Controller Approval Queue',
      desc: 'Review bills held for human approval (such as mid-tier invoices above $200 or address mismatches) and approve or reject them with confirmation.',
      icon: <CheckSquare className="h-5 w-5 text-[#123D32]" />,
      actionLabel: 'Review Approvals',
      onClick: () => {
        onNavigateTab('approvals');
        onClose();
      },
    },
    {
      title: '4. Private AI & Security Center',
      desc: 'Verify live NEAR AI Cloud hardware certificates, test tampered TEE quotes, and inspect live NEAR Mainnet accounts in plain English.',
      icon: <ShieldAlert className="h-5 w-5 text-[#123D32]" />,
      actionLabel: 'Open Security Center',
      onClick: () => {
        onNavigateTab('security');
        onClose();
      },
    },
    {
      title: '5. Red-Team Attack & 30-Invoice Suite',
      desc: 'Launch the flagship prompt-injection wallet redirection attack or run all 30 synthetic test cases to see STEWARD achieve 0 unauthorized payments.',
      icon: <Swords className="h-5 w-5 text-[#D9534F]" />,
      actionLabel: 'Launch Red Team Lab',
      onClick: () => {
        onNavigateTab('redteam');
        onClose();
      },
    },
    {
      title: '6. Audit History & Accountant CSV Export',
      desc: 'Search and filter every processed invoice and download a formula-injection-safe CSV spreadsheet ready for Excel or QuickBooks.',
      icon: <BookOpenCheck className="h-5 w-5 text-[#123D32]" />,
      actionLabel: 'Open Audit Ledger',
      onClick: () => {
        onNavigateTab('ledger');
        onClose();
      },
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#18251F]/60 p-4 backdrop-blur-xs overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="guided-demo-title"
    >
      <div className="relative my-6 w-full max-w-4xl rounded-2xl border border-[#E6EAE2] bg-[#F7F8F3] p-6 sm:p-8 shadow-2xl max-h-[90vh] overflow-y-auto animate-fade-in">
        <div className="flex items-start justify-between gap-4 border-b border-[#E6EAE2] pb-4">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-[#EDF8D8] px-3 py-1 text-xs font-bold text-[#123D32] border border-[#C7F36B]">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Interactive Guided Tour • Demo Mode</span>
            </div>
            <h2
              id="guided-demo-title"
              className="mt-2 font-display text-2xl font-extrabold text-[#18251F]"
            >
              Explore STEWARD in 60 Seconds
            </h2>
            <p className="mt-1 text-xs sm:text-sm text-[#78847C]">
              In <strong>Demo Mode</strong>, all security checks, Private AI hardware verifications,
              NEAR RPC lookups, and 1Click quotes run live, while final fund transfers are safely
              simulated—so you can test every feature without funding a wallet.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close guided tour"
            className="rounded-xl border border-[#E6EAE2] bg-white p-2 text-[#78847C] hover:text-[#18251F] cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {tourItems.map((item) => (
            <div
              key={item.title}
              className="steward-card steward-card-interactive p-5 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EDF8D8] border border-[#C7F36B]">
                    {item.icon}
                  </span>
                  <h3 className="font-display text-sm sm:text-base font-bold text-[#18251F]">
                    {item.title}
                  </h3>
                </div>
                <p className="mt-2.5 text-xs text-[#78847C] leading-relaxed">{item.desc}</p>
              </div>
              <button
                type="button"
                onClick={item.onClick}
                className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-[#123D32] hover:text-[#237A57] cursor-pointer"
              >
                <span>{item.actionLabel}</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-[#123D32] p-5 text-white">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-[#C7F36B]">
              One-Click Hackathon Highlight
            </div>
            <div className="mt-0.5 font-display text-sm sm:text-base font-bold">
              Want to see a malicious wallet redirection attack get caught right now?
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href="/api/ledger/csv"
              download
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-xs font-semibold text-white hover:bg-white/20"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Download Sample CSV</span>
            </a>
            <button
              type="button"
              onClick={() => {
                onClose();
                onTriggerFlagshipAttack();
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-[#C7F36B] px-4 py-2.5 text-xs font-bold text-[#123D32] hover:bg-[#d4f788] cursor-pointer"
            >
              <Swords className="h-4 w-4" />
              <span>Run Flagship Red-Team Attack</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export interface ConfirmationDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  variant: 'approve' | 'danger' | 'warning';
  requireNotes?: boolean;
  notesPlaceholder?: string;
  defaultNotes?: string;
  onCancel: () => void;
  onConfirm: (notes: string) => void;
}

export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  open,
  title,
  description,
  confirmLabel,
  variant,
  requireNotes = false,
  notesPlaceholder = 'Add optional controller review notes...',
  defaultNotes = '',
  onCancel,
  onConfirm,
}) => {
  const [notes, setNotes] = useState(defaultNotes);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#18251F]/60 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-2xl border border-[#E6EAE2] bg-white p-6 shadow-2xl animate-fade-in">
        <div className="flex items-start gap-3.5">
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
              variant === 'approve'
                ? 'bg-[#E8F5EC] text-[#23845B]'
                : variant === 'danger'
                  ? 'bg-[#FCEDEC] text-[#D9534F]'
                  : 'bg-[#FFF5DF] text-[#D99A32]'
            }`}
          >
            {variant === 'approve' ? (
              <CheckCircle2 className="h-6 w-6" />
            ) : variant === 'danger' ? (
              <AlertTriangle className="h-6 w-6" />
            ) : (
              <Lock className="h-6 w-6" />
            )}
          </div>
          <div className="flex-1">
            <h3 className="font-display text-lg font-bold text-[#18251F]">{title}</h3>
            <p className="mt-1.5 text-xs sm:text-sm text-[#78847C] leading-relaxed">
              {description}
            </p>
          </div>
        </div>

        {requireNotes && (
          <div className="mt-4">
            <label className="block text-xs font-semibold text-[#18251F] mb-1.5">
              Audit Log Note / Reason
            </label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={notesPlaceholder}
              className="w-full rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] p-3 text-xs text-[#18251F] focus:border-[#123D32] focus:outline-none"
            />
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] px-4 py-2.5 text-xs font-semibold text-[#18251F] hover:bg-[#F0F3EC] cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(notes)}
            className={`rounded-xl px-4 py-2.5 text-xs font-bold text-white cursor-pointer ${
              variant === 'approve'
                ? 'bg-[#123D32] hover:bg-[#1B5545]'
                : variant === 'danger'
                  ? 'bg-[#D9534F] hover:bg-[#B8322E]'
                  : 'bg-[#D99A32] hover:bg-[#B87D1E]'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
