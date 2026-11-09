import React from 'react';
import {
  CheckCircle2,
  Clock,
  ShieldAlert,
  Sparkles,
  Lock,
  AlertTriangle,
} from 'lucide-react';
import type {
  OperatingMode,
  PaymentStatus,
  PolicyDecisionType,
  ProcessedInvoiceRecord,
  SecurityEventRecord,
  SupportedChain,
} from '../../shared/types.js';

export const StewardLogo: React.FC<{
  size?: 'sm' | 'md' | 'lg';
  compact?: boolean;
  lightText?: boolean;
}> = ({ size = 'md', compact = false, lightText = false }) => {
  const dimensions =
    size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-11 w-11' : 'h-9 w-9';
  const textSize =
    size === 'sm' ? 'text-base' : size === 'lg' ? 'text-xl' : 'text-lg';

  return (
    <div className="inline-flex items-center gap-2.5 select-none">
      <div
        className={`${dimensions} relative flex shrink-0 items-center justify-center rounded-xl bg-[#123D32] text-[#C7F36B] shadow-sm ring-1 ring-[#1B5545]`}
      >
        <svg
          viewBox="0 0 28 28"
          fill="none"
          className="h-5 w-5"
          aria-hidden="true"
        >
          <path
            d="M14 2.5L4.5 6.75V13.5C4.5 19.55 8.55 24.95 14 26.5C19.45 24.95 23.5 19.55 23.5 13.5V6.75L14 2.5Z"
            stroke="#C7F36B"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M10.25 14.25L12.85 16.85L18.25 11.45"
            stroke="#FFFFFF"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-[#C7F36B] ring-2 ring-white" />
      </div>
      {!compact && (
        <div className="flex flex-col leading-none">
          <span
            className={`font-display font-extrabold tracking-tight ${textSize} ${
              lightText ? 'text-white' : 'text-[#123D32]'
            }`}
          >
            STEWARD
          </span>
          <span
            className={`text-[10px] font-medium tracking-wide uppercase mt-0.5 ${
              lightText ? 'text-[#C7F36B]' : 'text-[#78847C]'
            }`}
          >
            Protected AP
          </span>
        </div>
      )}
    </div>
  );
};

export const DecisionBadge: React.FC<{ decision: PolicyDecisionType; size?: 'sm' | 'md' }> = ({
  decision,
  size = 'sm',
}) => {
  const padding = size === 'md' ? 'px-3 py-1 text-xs' : 'px-2.5 py-0.5 text-[11px]';
  if (decision === 'PAY') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full bg-[#E8F5EC] text-[#23845B] border border-[#23845B]/25 font-semibold whitespace-nowrap ${padding}`}
      >
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        Approved to Pay
      </span>
    );
  }
  if (decision === 'HOLD') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full bg-[#FFF5DF] text-[#9A6700] border border-[#D99A32]/35 font-semibold whitespace-nowrap ${padding}`}
      >
        <Clock className="h-3.5 w-3.5 shrink-0" />
        Needs Approval
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full bg-[#FCEDEC] text-[#B8322E] border border-[#D9534F]/35 font-semibold whitespace-nowrap ${padding}`}
    >
      <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
      Blocked
    </span>
  );
};

export const PaymentStatusBadge: React.FC<{ status: PaymentStatus }> = ({ status }) => {
  switch (status) {
    case 'PAID':
    case 'COMPLETED':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E8F5EC] px-2.5 py-0.5 text-xs font-semibold text-[#23845B] border border-[#23845B]/25 whitespace-nowrap">
          <span className="h-1.5 w-1.5 rounded-full bg-[#23845B]" />
          {status === 'COMPLETED' ? 'Completed' : 'Paid'}
        </span>
      );
    case 'APPROVED':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EDF8D8] px-2.5 py-0.5 text-xs font-semibold text-[#123D32] border border-[#23845B]/25 whitespace-nowrap">
          <span className="h-1.5 w-1.5 rounded-full bg-[#23845B]" />
          Approved (Ready to Sign)
        </span>
      );
    case 'AWAITING_WALLET_SIGNATURE':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFF5DF] px-2.5 py-0.5 text-xs font-semibold text-[#9A6700] border border-[#D99A32]/35 whitespace-nowrap">
          <span className="h-1.5 w-1.5 rounded-full bg-[#D99A32] animate-pulse" />
          Awaiting Wallet Signature
        </span>
      );
    case 'DEPOSIT_SUBMITTED':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F0F3EC] px-2.5 py-0.5 text-xs font-semibold text-[#123D32] border border-[#E6EAE2] whitespace-nowrap">
          <span className="h-1.5 w-1.5 rounded-full bg-[#237A57] animate-pulse" />
          Deposit Submitted
        </span>
      );
    case 'DEPOSIT_CONFIRMED':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E8F5EC] px-2.5 py-0.5 text-xs font-semibold text-[#123D32] border border-[#23845B]/25 whitespace-nowrap">
          <span className="h-1.5 w-1.5 rounded-full bg-[#23845B] animate-pulse" />
          Deposit Confirmed
        </span>
      );
    case 'HELD':
    case 'AWAITING_APPROVAL':
    case 'DRAFT':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFF5DF] px-2.5 py-0.5 text-xs font-semibold text-[#9A6700] border border-[#D99A32]/35 whitespace-nowrap">
          <span className="h-1.5 w-1.5 rounded-full bg-[#D99A32]" />
          {status === 'DRAFT' ? 'Draft' : 'Awaiting Approval'}
        </span>
      );
    case 'BLOCKED':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FCEDEC] px-2.5 py-0.5 text-xs font-semibold text-[#B8322E] border border-[#D9534F]/35 whitespace-nowrap">
          <span className="h-1.5 w-1.5 rounded-full bg-[#D9534F]" />
          Blocked
        </span>
      );
    case 'PENDING':
    case 'PROCESSING':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F0F3EC] px-2.5 py-0.5 text-xs font-semibold text-[#123D32] border border-[#E6EAE2] whitespace-nowrap">
          <span className="h-1.5 w-1.5 rounded-full bg-[#237A57] animate-pulse" />
          Processing
        </span>
      );
    case 'REFUNDED':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F0F3EC] px-2.5 py-0.5 text-xs font-semibold text-[#78847C] border border-[#E6EAE2] whitespace-nowrap">
          Refunded
        </span>
      );
    case 'EXPIRED':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFF5DF] px-2.5 py-0.5 text-xs font-semibold text-[#9A6700] border border-[#D99A32]/35 whitespace-nowrap">
          Quote Expired
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FCEDEC] px-2.5 py-0.5 text-xs font-semibold text-[#B8322E] border border-[#D9534F]/35 whitespace-nowrap">
          Failed
        </span>
      );
  }
};

export const ModeBadge: React.FC<{ mode: OperatingMode }> = ({ mode }) => {
  if (mode === 'live') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-[#123D32] px-2 py-0.5 text-[11px] font-semibold text-[#C7F36B] whitespace-nowrap">
        <Lock className="h-3 w-3" />
        Live Settlement
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md bg-[#F0F3EC] px-2 py-0.5 text-[11px] font-semibold text-[#123D32] border border-[#E6EAE2] whitespace-nowrap"
      title="Simulated transaction in Demo Mode — no real funds moved"
    >
      <Sparkles className="h-3 w-3 text-[#237A57]" />
      Simulated Demo
    </span>
  );
};

export const ChainBadge: React.FC<{ chain: SupportedChain; asset?: string }> = ({
  chain,
  asset,
}) => {
  const names: Record<SupportedChain, string> = {
    near: 'NEAR',
    arbitrum: 'Arbitrum',
    solana: 'Solana',
    ethereum: 'Ethereum',
    base: 'Base',
    bitcoin: 'Bitcoin',
  };
  const cleanAsset = asset ? asset.replace(/\s*\([^)]*\)\s*/g, '').trim() : '';
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-[#F0F3EC] px-2.5 py-0.5 text-xs font-medium text-[#18251F] border border-[#E6EAE2] whitespace-nowrap">
      {cleanAsset ? `${cleanAsset} on ` : ''}
      <strong className="font-semibold text-[#123D32]">{names[chain] || chain.toUpperCase()}</strong>
    </span>
  );
};

/**
 * Translates technical policy/risk codes and summaries into clear, reassuring plain English
 * while preserving accuracy.
 */
export function getPlainEnglishDecisionExplanation(inv: ProcessedInvoiceRecord): {
  headline: string;
  explanation: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
} {
  if (inv.finalDecision === 'PAY') {
    const isHumanApproved =
      Boolean(inv.approvedBy) &&
      inv.approvedBy !== 'SYSTEM_POLICY_AUTO' &&
      inv.approvedBy !== 'AUTO_POLICY_ENGINE';
    return {
      headline: isHumanApproved
        ? 'Approved by controller and paid'
        : 'Verified vendor bill paid automatically',
      explanation: `Vendor identity and wallet (${inv.receivingWalletAddress}) matched your Verified Vendor Registry, invoice math checked out, and the $${inv.total.toFixed(2)} amount was settled via NEAR Intents.`,
      riskLevel: 'LOW',
    };
  }

  if (inv.finalDecision === 'HOLD') {
    if (inv.vendorCheck.isNewVendor) {
      return {
        headline: 'Payment waiting for your approval — New vendor',
        explanation: `${inv.vendorName} is not yet in your Verified Vendor Registry. STEWARD paused this payment so you can confirm their business details and receiving wallet before sending funds.`,
        riskLevel: 'MEDIUM',
      };
    }
    if (!inv.vendorCheck.addressMatchesRegistry) {
      return {
        headline: 'Payment waiting for your approval — Unfamiliar wallet address',
        explanation: `The payment address on this invoice (${inv.receivingWalletAddress}) does not match ${inv.vendorName}'s verified wallet (${inv.vendorCheck.matchedVendor?.verifiedWalletAddress || 'on file'}). Please verify directly with the vendor before approving.`,
        riskLevel: 'HIGH',
      };
    }
    if (inv.vendorCheck.inCoolingOffPeriod) {
      return {
        headline: 'Payment waiting for your approval — 48-hour address change lock',
        explanation: `${inv.vendorName}'s wallet address was recently updated. STEWARD enforces a 48-hour cooling-off review window (${inv.vendorCheck.coolingOffRemainingHours}h remaining) to protect against unauthorized account changes.`,
        riskLevel: 'MEDIUM',
      };
    }
    return {
      headline: 'Payment waiting for your approval — Above auto-pay limit',
      explanation: `Vendor and payment details are verified, but this $${inv.total.toFixed(2)} invoice exceeds your $${inv.policyEvaluation.policySnapshot.auto_approve_below_usd} automatic approval limit.`,
      riskLevel: 'LOW',
    };
  }

  // BLOCK decisions
  if (inv.validation.promptInjectionDetected) {
    return {
      headline: 'Blocked — Suspicious instructions hidden inside invoice',
      explanation:
        'This invoice contained hidden text trying to trick the AI into redirecting payment to an unauthorized wallet. STEWARD stopped the transaction immediately.',
      riskLevel: 'HIGH',
    };
  }
  if (inv.riskAssessment.isBlocklisted) {
    return {
      headline: 'Blocked — Destination wallet is on the security blocklist',
      explanation: `The requested wallet (${inv.receivingWalletAddress}) is flagged in threat intelligence for fraudulent activity. STEWARD blocked the payment.`,
      riskLevel: 'HIGH',
    };
  }
  if (!inv.validation.arithmeticValid || !inv.validation.schemaValid) {
    return {
      headline: 'Blocked — Invoice math does not add up',
      explanation: `The line items ($${inv.validation.calculatedLineItemSum.toFixed(2)}) do not match the stated total ($${inv.total.toFixed(2)}). STEWARD blocked this bill to prevent overbilling fraud.`,
      riskLevel: 'HIGH',
    };
  }
  if (inv.policyEvaluation.isDuplicateInvoice) {
    return {
      headline: 'Blocked — Duplicate invoice already processed',
      explanation: `Invoice #${inv.invoiceNumber} from ${inv.vendorName} was already submitted earlier. STEWARD prevented a double payment.`,
      riskLevel: 'HIGH',
    };
  }
  if (inv.rejectionReason) {
    return {
      headline: 'Rejected by financial controller',
      explanation: inv.rejectionReason,
      riskLevel: 'MEDIUM',
    };
  }
  return {
    headline: 'Blocked — Exceeds company payment policy limits',
    explanation: `This invoice ($${inv.total.toFixed(2)} in ${inv.requestedPayoutAsset}) violates your company's hard spending cap ($${inv.policyEvaluation.policySnapshot.per_invoice_cap_usd} max per invoice) or allowed currency rules.`,
    riskLevel: 'HIGH',
  };
}

export function getPlainEnglishSecurityEventSummary(ev: SecurityEventRecord): {
  friendlyCategory: string;
  whyBlockedExplanation: string;
} {
  switch (ev.category) {
    case 'PROMPT_INJECTION':
      return {
        friendlyCategory: 'AI Manipulation Attempt Blocked',
        whyBlockedExplanation:
          'The invoice contained hidden commands attempting to override STEWARD’s instructions and redirect funds to an attacker wallet. Because STEWARD separates AI reading from deterministic payment rules, the attack was blocked automatically.',
      };
    case 'ADDRESS_SUBSTITUTION':
      return {
        friendlyCategory: 'Vendor Wallet Mismatch Caught',
        whyBlockedExplanation:
          "The payment address does not match the vendor's previously verified wallet. STEWARD stopped the transaction to prevent possible payment redirection.",
      };
    case 'BLOCKLIST_HIT':
      return {
        friendlyCategory: 'Known Malicious Wallet Blocked',
        whyBlockedExplanation:
          'The receiving wallet address matched a known scam or sanctions blocklist. STEWARD permanently blocked the transfer.',
      };
    case 'DUPLICATE_INVOICE':
      return {
        friendlyCategory: 'Duplicate Bill Prevented',
        whyBlockedExplanation:
          'An invoice with this exact vendor and invoice number was already processed. STEWARD stopped the duplicate bill so you never pay twice.',
      };
    case 'ARITHMETIC_FRAUD':
      return {
        friendlyCategory: 'Invoice Math Discrepancy Blocked',
        whyBlockedExplanation:
          'The individual line items on this invoice did not add up to the requested total. STEWARD blocked the bill to protect against doctored totals.',
      };
    case 'LIMIT_EXCEEDED':
      return {
        friendlyCategory: 'Policy Spending Limit Enforced',
        whyBlockedExplanation:
          'This invoice requested an amount above your company’s maximum per-invoice cap or requested an unapproved currency.',
      };
    case 'ATTESTATION_FAILURE':
      return {
        friendlyCategory: 'Private AI Verification Rejected',
        whyBlockedExplanation:
          'The cryptographic hardware proof from the AI environment was tampered with or failed verification. STEWARD refused to trust the analysis.',
      };
    case 'KILL_SWITCH':
      return {
        friendlyCategory: 'Emergency Payment Lock',
        whyBlockedExplanation:
          'A financial controller toggled the emergency treasury kill switch, pausing or resuming all outgoing payments.',
      };
    default:
      return {
        friendlyCategory: 'Held for Controller Review',
        whyBlockedExplanation:
          'This invoice triggered a safety rule that requires a human controller to review and approve the payment before money moves.',
      };
  }
}
