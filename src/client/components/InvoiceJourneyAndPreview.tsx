import React, { useState } from 'react';
import {
  CheckCircle2,
  Clock,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  FileText,
  Lock,
  Building2,
  ShieldCheck,
  Scale,
  ArrowRightLeft,
  AlertTriangle,
  Check,
  X,
  Edit3,
  HelpCircle,
  History,
  Calculator,
  Wallet,
  Sparkles,
  Info,
} from 'lucide-react';
import type { ProcessedInvoiceRecord, FieldCorrectionEntry } from '../../shared/types.js';
import {
  ChainBadge,
  DecisionBadge,
  ModeBadge,
  PaymentStatusBadge,
  getPlainEnglishDecisionExplanation,
} from './StewardLogo.js';

interface JourneyStage {
  stepNumber: number;
  title: string;
  status: 'passed' | 'warning' | 'blocked';
  shortExplanation: string;
  timestamp: string;
  technicalDetails: Array<{ label: string; value: string }>;
}

export const InvoiceJourneyAndPreview: React.FC<{
  invoice: ProcessedInvoiceRecord;
  onApproveRequest?: (invoice: ProcessedInvoiceRecord) => void;
  onRejectRequest?: (invoice: ProcessedInvoiceRecord) => void;
  onInvoiceUpdated?: (updated: ProcessedInvoiceRecord) => void;
}> = ({ invoice, onApproveRequest, onRejectRequest, onInvoiceUpdated }) => {
  const [activeTab, setActiveTab] = useState<'verification' | 'journey'>('verification');
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  // Field Correction Modal State
  const [showCorrectionModal, setShowCorrectionModal] = useState(false);
  const [selectedField, setSelectedField] = useState<string>('receivingWalletAddress');
  const [correctedValue, setCorrectedValue] = useState<string>('');
  const [correctionReason, setCorrectionReason] = useState<string>('');
  const [isSubmittingCorrection, setIsSubmittingCorrection] = useState(false);
  const [correctionError, setCorrectionError] = useState<string | null>(null);

  const timeFormatted = new Date(invoice.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const isAttestationVerified =
    invoice.attestation.verified &&
    invoice.attestation.failedChecks.length === 0 &&
    invoice.attestation.nonceVerified;

  const isValidationClean =
    invoice.validation.schemaValid &&
    invoice.validation.arithmeticValid &&
    !invoice.validation.promptInjectionDetected;

  const isVendorClean =
    invoice.vendorCheck.isVerifiedVendor &&
    invoice.vendorCheck.addressMatchesRegistry &&
    !invoice.vendorCheck.inCoolingOffPeriod;

  const stages: JourneyStage[] = [
    {
      stepNumber: 1,
      title: '1. Invoice received',
      status: 'passed',
      shortExplanation: invoice.rawTextDeleted
        ? 'Document read in ephemeral memory and raw text deleted immediately after extraction.'
        : 'Invoice received for processing.',
      timestamp: timeFormatted,
      technicalDetails: [
        { label: 'Record ID', value: invoice.id },
        { label: 'Raw Text Scrubbed from RAM', value: String(invoice.rawTextDeleted) },
        { label: 'Extraction Method', value: invoice.extractionMethod },
        { label: 'Processing Duration', value: `${invoice.processingTimeMs} ms` },
      ],
    },
    {
      stepNumber: 2,
      title: '2. Private AI analysis',
      status: !isValidationClean
        ? 'blocked'
        : isAttestationVerified
          ? 'passed'
          : 'warning',
      shortExplanation: !isValidationClean
        ? invoice.validation.promptInjectionDetected
          ? 'Hidden prompt-injection instructions detected inside invoice text.'
          : 'Invoice math or schema failed verification ($' +
            invoice.validation.calculatedLineItemSum.toFixed(2) +
            ' line items vs $' +
            invoice.total.toFixed(2) +
            ' stated total).'
        : isAttestationVerified
          ? 'Private AI environment verified and invoice math confirmed to the cent.'
          : 'Structured fields extracted; hardware attestation was offline or unverified.',
      timestamp: new Date(invoice.attestation.verifiedAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
      technicalDetails: [
        { label: 'TEE Model', value: invoice.attestation.modelId },
        { label: 'Hardware Enclave', value: invoice.attestation.teeType },
        { label: 'Session Nonce Verified', value: String(invoice.attestation.nonceVerified) },
        {
          label: 'Calculated Line-Item Sum',
          value: `$${invoice.validation.calculatedLineItemSum.toFixed(2)} (Stated Total: $${invoice.total.toFixed(2)})`,
        },
        {
          label: 'Prompt Injection Findings',
          value:
            invoice.validation.injectionFindings.length > 0
              ? invoice.validation.injectionFindings.map((f) => f.code).join(', ')
              : '0 (Clean)',
        },
      ],
    },
    {
      stepNumber: 3,
      title: '3. Vendor verified',
      status: isVendorClean ? 'passed' : 'warning',
      shortExplanation: isVendorClean
        ? `${invoice.vendorName} matched your Verified Vendor Registry and wallet on file.`
        : invoice.vendorCheck.isNewVendor
          ? `${invoice.vendorName} is a new supplier not yet in your Verified Vendor Registry.`
          : !invoice.vendorCheck.addressMatchesRegistry
            ? `Requested wallet (${invoice.receivingWalletAddress}) does not match the vendor's verified wallet on file.`
            : `Vendor wallet is in a 48-hour address change cooling-off window (${invoice.vendorCheck.coolingOffRemainingHours}h left).`,
      timestamp: timeFormatted,
      technicalDetails: [
        {
          label: 'Registry Match',
          value: invoice.vendorCheck.matchedVendor
            ? `${invoice.vendorCheck.matchedVendor.businessName} (${invoice.vendorCheck.matchedVendor.id})`
            : 'Unregistered Vendor',
        },
        {
          label: 'Verified Wallet on File',
          value: invoice.vendorCheck.matchedVendor?.verifiedWalletAddress || 'None',
        },
        { label: 'Invoice Requested Wallet', value: invoice.receivingWalletAddress },
        {
          label: 'Discrepancy Codes',
          value:
            invoice.vendorCheck.discrepancies.length > 0
              ? invoice.vendorCheck.discrepancies.map((d) => d.code).join(', ')
              : 'None',
        },
      ],
    },
    {
      stepNumber: 4,
      title: '4. Counterparty checked',
      status:
        invoice.riskAssessment.decision === 'ALLOW'
          ? 'passed'
          : invoice.riskAssessment.decision === 'WARN'
            ? 'warning'
            : 'blocked',
      shortExplanation:
        invoice.riskAssessment.decision === 'ALLOW'
          ? 'Vendor payment details checked — wallet format valid and clear of blocklists.'
          : invoice.riskAssessment.isBlocklisted
            ? 'Destination wallet matched the threat-intelligence blocklist.'
            : 'Vendor payment details flagged for controller review.',
      timestamp: new Date(invoice.riskAssessment.evaluatedAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
      technicalDetails: [
        {
          label: 'Risk Engine Decision',
          value: `${invoice.riskAssessment.decision} (Score: ${invoice.riskAssessment.riskScore}/100)`,
        },
        {
          label: 'Address Format Valid',
          value: String(invoice.riskAssessment.addressFormatValid),
        },
        { label: 'Blocklist Hit', value: String(invoice.riskAssessment.isBlocklisted) },
        {
          label: 'Prior Verified Transactions',
          value: String(invoice.riskAssessment.previousTransactionsCount),
        },
        {
          label: 'Risk Findings',
          value: invoice.riskAssessment.reasons.map((r) => `${r.code}: ${r.message}`).join(' | '),
        },
      ],
    },
    {
      stepNumber: 5,
      title: '5. Policy evaluated',
      status:
        invoice.policyEvaluation.decision === 'PAY'
          ? 'passed'
          : invoice.policyEvaluation.decision === 'HOLD'
            ? 'warning'
            : 'blocked',
      shortExplanation:
        invoice.policyEvaluation.decision === 'PAY'
          ? `Within your $${invoice.policyEvaluation.policySnapshot.auto_approve_below_usd} automatic approval limit and $${invoice.policyEvaluation.policySnapshot.daily_cap_usd} daily cap.`
          : invoice.policyEvaluation.decision === 'HOLD'
            ? 'Payment waiting for your approval based on your company safety rules.'
            : 'Blocked automatically by company spending or security policy.',
      timestamp: new Date(invoice.policyEvaluation.evaluatedAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
      technicalDetails: [
        { label: 'Policy Engine Decision', value: invoice.policyEvaluation.decision },
        { label: 'Duplicate Invoice Check', value: String(invoice.policyEvaluation.isDuplicateInvoice) },
        {
          label: 'Daily Spend Remaining',
          value: `$${invoice.policyEvaluation.dailySpendRemainingUsd.toFixed(2)} of $${invoice.policyEvaluation.policySnapshot.daily_cap_usd}`,
        },
        {
          label: 'Policy Rules Triggered',
          value: invoice.policyEvaluation.reasons
            .map((r) => `[${r.decisionImpact}] ${r.code}: ${r.message}`)
            .join(' | '),
        },
      ],
    },
    {
      stepNumber: 6,
      title: '6. Approval or payment',
      status:
        invoice.paymentStatus === 'PAID'
          ? 'passed'
          : invoice.paymentStatus === 'HELD' || invoice.paymentStatus === 'PENDING'
            ? 'warning'
            : 'blocked',
      shortExplanation:
        invoice.paymentStatus === 'PAID'
          ? invoice.approvedBy
            ? `Approved by ${invoice.approvedBy} and settled via NEAR Intents (${invoice.paymentExecution?.exactRequestedOutput || `${invoice.total.toFixed(2)} ${invoice.requestedPayoutAsset}`}).`
            : `Settled automatically via NEAR Intents Exact-Output (${invoice.paymentExecution?.exactRequestedOutput || `${invoice.total.toFixed(2)} ${invoice.requestedPayoutAsset}`}).`
          : invoice.paymentStatus === 'HELD'
            ? 'Held safely in your Approval Queue until a controller approves or rejects.'
            : 'No payment executed ($0.00 moved).',
      timestamp: invoice.approvedAt
        ? new Date(invoice.approvedAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })
        : timeFormatted,
      technicalDetails: invoice.paymentExecution
        ? [
            { label: '1Click Quote ID', value: invoice.paymentExecution.quoteId || 'N/A' },
            {
              label: 'Exact Requested Output',
              value: invoice.paymentExecution.exactRequestedOutput,
            },
            {
              label: 'Estimated Input (w/ Buffer)',
              value: invoice.paymentExecution.estimatedInputAmount,
            },
            {
              label: 'Refund Treasury Account',
              value: invoice.paymentExecution.refundAddress,
            },
            { label: 'Settlement Source', value: invoice.paymentExecution.statusSource },
          ]
        : [
            { label: 'Payment Execution', value: 'None (Payment not authorized)' },
            { label: 'Approved By', value: invoice.approvedBy || 'N/A' },
          ],
    },
    {
      stepNumber: 7,
      title: '7. Final status',
      status:
        invoice.paymentStatus === 'PAID'
          ? 'passed'
          : invoice.paymentStatus === 'HELD'
            ? 'warning'
            : 'blocked',
      shortExplanation: getPlainEnglishDecisionExplanation(invoice).headline,
      timestamp: new Date(invoice.updatedAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
      technicalDetails: [
        { label: 'Final Decision', value: invoice.finalDecision },
        { label: 'Payment Status', value: invoice.paymentStatus },
        { label: 'Operating Mode', value: invoice.mode.toUpperCase() },
        { label: 'Audit Summary', value: invoice.decisionReasonSummary },
      ],
    },
  ];

  const plainDecision = getPlainEnglishDecisionExplanation(invoice);
  const hasAddressDiscrepancy =
    invoice.vendorCheck.matchedVendor &&
    !invoice.vendorCheck.addressMatchesRegistry;
  const hasMathDiscrepancy = !invoice.validation.arithmeticValid;

  // Confidence & Discrepancy Classification
  const confidenceMap = invoice.confidenceMap || invoice.validation.confidenceMap || {};
  const uncertainFields = invoice.uncertainFields || invoice.validation.uncertainFields || [];
  const discrepancyType =
    invoice.discrepancyClassification ||
    (hasAddressDiscrepancy || hasMathDiscrepancy
      ? 'GENUINE_DISCREPANCY'
      : uncertainFields.length > 0
        ? 'AMBIGUOUS_FIELD'
        : 'NONE');

  // Arithmetic Breakdown Details
  const rawArith = invoice.arithmeticDetails || invoice.validation.arithmeticDetails || {
    calculatedSubtotal: invoice.validation.calculatedLineItemSum,
    extractedSubtotal: invoice.subtotal,
    calculatedTotal: invoice.subtotal + invoice.tax,
    extractedTotal: invoice.total,
    tax: invoice.tax,
    discounts: 0,
    additionalCharges: 0,
    verificationResult: (invoice.validation.arithmeticValid ? 'PASS' : 'FAIL') as 'PASS' | 'FAIL',
    lineItemCount: invoice.lineItems.length,
    difference: invoice.validation.arithmeticDiff,
  };

  const arith = {
    ...rawArith,
    calculatedLineItemSum: rawArith.calculatedSubtotal,
    statedSubtotal: rawArith.extractedSubtotal,
    subtotalMatches: Math.abs(rawArith.calculatedSubtotal - rawArith.extractedSubtotal) <= 0.02,
    calculatedTax: rawArith.tax,
    statedTax: invoice.tax,
    taxMatches: Math.abs(rawArith.tax - invoice.tax) <= 0.02,
    calculatedTotal: rawArith.calculatedTotal,
    statedTotal: rawArith.extractedTotal,
    totalMatches: Math.abs(rawArith.calculatedTotal - rawArith.extractedTotal) <= 0.02,
    isValid: rawArith.verificationResult === 'PASS',
  };

  const registeredWallet = invoice.vendorCheck.matchedVendor?.verifiedWalletAddress;
  const isWalletMatched =
    invoice.vendorCheck.matchedVendor &&
    invoice.vendorCheck.addressMatchesRegistry;

  const handleOpenCorrection = (fieldName?: string) => {
    const f = fieldName || 'receivingWalletAddress';
    setSelectedField(f);
    let val = '';
    if (f === 'receivingWalletAddress') val = invoice.receivingWalletAddress;
    else if (f === 'vendorId') val = invoice.vendorId || '';
    else if (f === 'vendorName') val = invoice.vendorName;
    else if (f === 'subtotal') val = String(invoice.subtotal);
    else if (f === 'tax') val = String(invoice.tax);
    else if (f === 'total') val = String(invoice.total);
    setCorrectedValue(val);
    setCorrectionReason('');
    setCorrectionError(null);
    setShowCorrectionModal(true);
  };

  const handleSelectFieldChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const f = e.target.value;
    setSelectedField(f);
    let val = '';
    if (f === 'receivingWalletAddress') val = invoice.receivingWalletAddress;
    else if (f === 'vendorId') val = invoice.vendorId || '';
    else if (f === 'vendorName') val = invoice.vendorName;
    else if (f === 'subtotal') val = String(invoice.subtotal);
    else if (f === 'tax') val = String(invoice.tax);
    else if (f === 'total') val = String(invoice.total);
    setCorrectedValue(val);
  };

  const submitFieldCorrection = async () => {
    if (!selectedField || correctedValue.trim() === '') {
      setCorrectionError('Please provide a corrected value.');
      return;
    }
    if (!correctionReason.trim()) {
      setCorrectionError('Please provide a reason for this correction (audit trail requirement).');
      return;
    }

    setIsSubmittingCorrection(true);
    setCorrectionError(null);

    try {
      const res = await fetch(`/api/invoices/${invoice.id}/correct-field`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-steward-role': 'Owner',
          'x-steward-actor-email': 'controller@steward-ap.finance',
        },
        body: JSON.stringify({
          field: selectedField,
          correctedValue: correctedValue.trim(),
          reason: correctionReason.trim(),
          operator: 'controller@steward-ap.finance',
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit field correction.');
      }

      setShowCorrectionModal(false);
      if (onInvoiceUpdated && data.invoice) {
        onInvoiceUpdated(data.invoice);
      }
    } catch (err: unknown) {
      setCorrectionError(
        err instanceof Error ? err.message : 'An error occurred while updating the invoice.'
      );
    } finally {
      setIsSubmittingCorrection(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Plain-English Outcome Summary Banner */}
      <div
        className={`rounded-2xl border p-5 sm:p-6 ${
          invoice.finalDecision === 'PAY'
            ? 'border-[#23845B]/30 bg-[#E8F5EC]/60'
            : invoice.finalDecision === 'HOLD'
              ? 'border-[#D99A32]/40 bg-[#FFF5DF]/70'
              : 'border-[#D9534F]/40 bg-[#FCEDEC]/70'
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <DecisionBadge decision={invoice.finalDecision} size="md" />
              <PaymentStatusBadge status={invoice.paymentStatus} />
              <ModeBadge mode={invoice.mode} />
              <span className="font-mono text-xs text-[#78847C]">
                Processed in {invoice.processingTimeMs} ms
              </span>
            </div>
            <h3 className="font-display text-lg sm:text-xl font-bold text-[#18251F] pt-1">
              {plainDecision.headline}
            </h3>
            <p className="text-xs sm:text-sm text-[#18251F]/85 leading-relaxed">
              {plainDecision.explanation}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => handleOpenCorrection()}
              className="rounded-xl border border-[#123D32]/30 bg-white px-3.5 py-2 text-xs font-bold text-[#123D32] hover:bg-[#F0F3EC] transition-colors cursor-pointer flex items-center gap-1.5 shadow-xs"
            >
              <Edit3 className="h-3.5 w-3.5" />
              <span>Inspect & Correct</span>
            </button>

            {invoice.paymentStatus === 'HELD' && (onApproveRequest || onRejectRequest) && (
              <>
                {onRejectRequest && (
                  <button
                    type="button"
                    onClick={() => onRejectRequest(invoice)}
                    className="rounded-xl border border-[#D9534F]/40 bg-white px-4 py-2 text-xs font-bold text-[#B8322E] hover:bg-[#FCEDEC] transition-colors cursor-pointer"
                  >
                    Reject Bill
                  </button>
                )}
                {onApproveRequest && (
                  <button
                    type="button"
                    onClick={() => onApproveRequest(invoice)}
                    className="rounded-xl bg-[#123D32] px-4 py-2 text-xs font-bold text-white hover:bg-[#1B5545] transition-colors cursor-pointer shadow-xs"
                  >
                    Approve & Pay ${invoice.total.toFixed(2)}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Discrepancy Classification Notice (Task 4: Clear distinction between Fraud vs Parsing vs Ambiguity) */}
      {discrepancyType === 'EXTRACTION_FAILURE' && (
        <div className="rounded-xl border border-[#237A57]/30 bg-[#F0F3EC] p-4 flex items-start gap-3">
          <Info className="h-5 w-5 text-[#237A57] shrink-0 mt-0.5" />
          <div className="text-xs text-[#18251F]">
            <strong className="text-[#123D32] uppercase tracking-wide font-bold">
              Layout Extraction Review Required:
            </strong>{' '}
            A multiline layout wrapping or field structure could not be parsed unambiguously.
            This is an extraction limitation, <span className="font-bold underline">NOT a confirmed fraud attempt</span>.
            Please review the reconstructed fields below or click &quot;Inspect & Correct&quot; to confirm the vendor address.
          </div>
        </div>
      )}

      {discrepancyType === 'AMBIGUOUS_FIELD' && (
        <div className="rounded-xl border border-[#D99A32]/40 bg-[#FFF5DF] p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-[#D99A32] shrink-0 mt-0.5" />
          <div className="text-xs text-[#18251F]">
            <strong className="text-[#D99A32] uppercase tracking-wide font-bold">
              Disambiguation Review Needed:
            </strong>{' '}
            Multiple candidate values were observed for fields:{' '}
            <span className="font-mono font-semibold">
              {uncertainFields.join(', ') || 'Receiving Address / Amounts'}
            </span>
            . Please verify the extracted values before controller sign-off.
          </div>
        </div>
      )}

      {discrepancyType === 'GENUINE_DISCREPANCY' && (
        <div className="rounded-xl border border-[#D9534F]/40 bg-[#FCEDEC] p-4 flex items-start gap-3">
          <ShieldAlert className="h-5 w-5 text-[#D9534F] shrink-0 mt-0.5" />
          <div className="text-xs text-[#18251F]">
            <strong className="text-[#D9534F] uppercase tracking-wide font-bold">
              Security Discrepancy Alert:
            </strong>{' '}
            {hasAddressDiscrepancy
              ? `The requested receiving address does not match ${invoice.vendorName}'s registered wallet on file.`
              : hasMathDiscrepancy
                ? 'Arithmetic mismatch: Stated invoice amounts do not sum correctly.'
                : 'Invoice data deviates from policy controls.'}{' '}
            STEWARD has held or blocked this invoice to protect treasury funds.
          </div>
        </div>
      )}

      {/* View Mode Switcher Tabs */}
      <div className="flex border-b border-[#E6EAE2] space-x-1">
        <button
          type="button"
          onClick={() => setActiveTab('verification')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-all cursor-pointer ${
            activeTab === 'verification'
              ? 'border-[#123D32] text-[#123D32]'
              : 'border-transparent text-[#78847C] hover:text-[#18251F]'
          }`}
        >
          <FileText className="h-4 w-4" />
          <span>Invoice Verification View</span>
          {uncertainFields.length > 0 && (
            <span className="rounded-full bg-[#FCEDEC] text-[#D9534F] px-1.5 py-0.2 text-[10px] font-bold">
              {uncertainFields.length} Uncertain
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('journey')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-all cursor-pointer ${
            activeTab === 'journey'
              ? 'border-[#123D32] text-[#123D32]'
              : 'border-transparent text-[#78847C] hover:text-[#18251F]'
          }`}
        >
          <ShieldCheck className="h-4 w-4" />
          <span>7-Stage Pipeline Journey</span>
        </button>
      </div>

      {/* =========================================================================
          TAB 1: DEDICATED INVOICE VERIFICATION VIEW (TASK 5)
         ========================================================================= */}
      {activeTab === 'verification' && (
        <div className="space-y-6 animate-fade-in">
          {/* SECTION 1: INVOICE INFORMATION */}
          <div className="steward-card p-5 sm:p-7 space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#E6EAE2] pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#237A57]">
                    Section 1: Invoice Information
                  </span>
                  <ConfidenceBadge confidence={confidenceMap.vendorIdentity?.confidence} />
                </div>
                <h4 className="mt-1 font-display text-2xl font-extrabold text-[#18251F]">
                  {invoice.vendorName}
                </h4>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
                  <span className="font-mono text-[#78847C]">
                    Vendor ID:{' '}
                    <strong className="text-[#18251F] font-bold">
                      {invoice.vendorId || 'Unregistered Supplier'}
                    </strong>
                  </span>
                  {invoice.vendorId && (
                    <ConfidenceBadge confidence={confidenceMap.vendorId?.confidence} />
                  )}
                  {invoice.vendorCheck.matchedVendor ? (
                    <span className="inline-flex items-center gap-1 rounded bg-[#E8F5EC] px-2 py-0.5 text-[11px] font-semibold text-[#23845B]">
                      <Check className="h-3 w-3" />
                      Registry Verified
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded bg-[#FFF5DF] px-2 py-0.5 text-[11px] font-semibold text-[#D99A32]">
                      New Supplier
                    </span>
                  )}
                </div>
              </div>

              <div className="text-right space-y-1">
                <div className="flex items-center justify-end gap-2">
                  <span className="font-mono text-base font-bold text-[#123D32]">
                    #{invoice.invoiceNumber}
                  </span>
                  <ConfidenceBadge confidence={confidenceMap.invoiceNumber?.confidence} />
                </div>
                <div className="text-xs text-[#78847C]">
                  Issued Date: <span className="font-mono font-medium text-[#18251F]">{invoice.invoiceDate}</span>
                </div>
                <div className="text-xs text-[#78847C]">
                  Payment Due: <span className="font-mono font-medium text-[#18251F]">{invoice.dueDate}</span>
                </div>
              </div>
            </div>

            {/* Line Items Table */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-[#78847C]">
                  Itemized Line Items
                </span>
                <ConfidenceBadge confidence={confidenceMap.lineItems?.confidence} />
              </div>
              <div className="overflow-x-auto rounded-xl border border-[#E6EAE2]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#F7F8F3] border-b border-[#E6EAE2] text-[#78847C] font-semibold">
                    <tr>
                      <th className="py-2.5 px-3">Description</th>
                      <th className="py-2.5 px-3 text-right">Qty</th>
                      <th className="py-2.5 px-3 text-right">Unit Price</th>
                      <th className="py-2.5 px-3 text-right">Total Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6EAE2] bg-white">
                    {invoice.lineItems.map((item, idx) => (
                      <tr key={idx} className="hover:bg-[#F7F8F3]/60 transition-colors">
                        <td className="py-2.5 px-3 font-medium text-[#18251F]">
                          {item.description}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#78847C]">
                          {item.quantity}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#78847C]">
                          ${item.unitPrice.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-semibold tabular-nums text-[#18251F]">
                          ${item.amount.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Subtotal, Tax Rate, Tax Amount & Total Due with Confidence Badges */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-xl bg-[#F7F8F3] p-3.5 border border-[#E6EAE2]">
                <div className="flex items-center justify-between text-xs text-[#78847C] mb-1">
                  <span>Subtotal</span>
                  <ConfidenceBadge confidence={confidenceMap.amounts?.confidence} />
                </div>
                <div className="font-mono text-lg font-bold text-[#18251F] tabular-nums">
                  ${invoice.subtotal.toFixed(2)}
                </div>
              </div>

              <div className="rounded-xl bg-[#F7F8F3] p-3.5 border border-[#E6EAE2]">
                <div className="flex items-center justify-between text-xs text-[#78847C] mb-1">
                  <span>Tax Amount</span>
                  <ConfidenceBadge confidence={confidenceMap.amounts?.confidence} />
                </div>
                <div className="font-mono text-lg font-bold text-[#18251F] tabular-nums">
                  ${invoice.tax.toFixed(2)}
                </div>
              </div>

              <div className="rounded-xl bg-[#F7F8F3] p-3.5 border border-[#E6EAE2]">
                <div className="flex items-center justify-between text-xs text-[#78847C] mb-1">
                  <span>Total Due ({invoice.currency})</span>
                  <ConfidenceBadge confidence={confidenceMap.amounts?.confidence} />
                </div>
                <div
                  className={`font-mono text-xl font-extrabold tabular-nums ${
                    hasMathDiscrepancy ? 'text-[#D9534F]' : 'text-[#123D32]'
                  }`}
                >
                  ${invoice.total.toFixed(2)}
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 2: PAYMENT INFORMATION */}
          <div className="steward-card p-5 sm:p-7 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E6EAE2] pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#237A57]">
                    Section 2: Payment Information
                  </span>
                  <ConfidenceBadge confidence={confidenceMap.paymentDetails?.confidence} />
                </div>
                <h4 className="mt-1 font-display text-lg font-bold text-[#18251F]">
                  Receiving Address & Registry Comparison
                </h4>
              </div>

              {/* Visual Match Status Badge */}
              <div>
                {isWalletMatched ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E8F5EC] border border-[#23845B]/30 px-3 py-1 text-xs font-bold text-[#23845B]">
                    <CheckCircle2 className="h-4 w-4" />
                    MATCH (Verified Address)
                  </span>
                ) : invoice.vendorCheck.matchedVendor ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FCEDEC] border border-[#D9534F]/40 px-3 py-1 text-xs font-bold text-[#D9534F] animate-pulse">
                    <ShieldAlert className="h-4 w-4" />
                    MISMATCH (Address Conflict)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFF5DF] border border-[#D99A32]/40 px-3 py-1 text-xs font-bold text-[#D99A32]">
                    <Clock className="h-4 w-4" />
                    NEW SUPPLIER (Unregistered)
                  </span>
                )}
              </div>
            </div>

            {/* Payout Asset & Destination Network */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-[#F7F8F3] border border-[#E6EAE2] text-xs">
              <span className="text-[#78847C] font-medium">Payout Asset & Target Network:</span>
              <ChainBadge
                chain={invoice.requestedDestinationChain}
                asset={invoice.requestedPayoutAsset}
              />
            </div>

            {/* Address Comparison Display (Diff Highlighting if Mismatch) */}
            <div className="space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider text-[#78847C]">
                Side-by-Side Address Verification
              </div>

              {hasAddressDiscrepancy && registeredWallet ? (
                <div className="space-y-2">
                  <AddressDiffView
                    extracted={invoice.receivingWalletAddress}
                    registered={registeredWallet}
                  />
                  <p className="text-xs text-[#D9534F] font-medium">
                    Warning: The invoice requests payment to a wallet that is different from {invoice.vendorName}&apos;s verified on-file address.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] p-4 space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-[#78847C]">
                      <span className="font-semibold uppercase tracking-wider text-[10px]">
                        Extracted Receiving Address
                      </span>
                      <ConfidenceBadge confidence={confidenceMap.receivingWallet?.confidence} />
                    </div>
                    <code className="block font-mono text-xs font-bold text-[#18251F] break-all bg-white p-2.5 rounded-lg border border-[#E6EAE2]">
                      {invoice.receivingWalletAddress}
                    </code>
                  </div>

                  <div className="rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] p-4 space-y-1.5">
                    <div className="text-xs text-[#78847C] font-semibold uppercase tracking-wider text-[10px]">
                      Registered Vendor Payout Address (On File)
                    </div>
                    <code className="block font-mono text-xs font-bold text-[#23845B] break-all bg-white p-2.5 rounded-lg border border-[#E6EAE2]">
                      {registeredWallet || 'No registered wallet on file (New Supplier)'}
                    </code>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* SECTION 3: ARITHMETIC VERIFICATION */}
          <div className="steward-card p-5 sm:p-7 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E6EAE2] pb-4">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#237A57]">
                  Section 3: Arithmetic Verification
                </span>
                <h4 className="mt-1 font-display text-lg font-bold text-[#18251F]">
                  Deterministic Calculation Breakdown
                </h4>
              </div>

              <div>
                {arith.isValid ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E8F5EC] border border-[#23845B]/30 px-3 py-1 text-xs font-bold text-[#23845B]">
                    <CheckCircle2 className="h-4 w-4" />
                    ARITHMETIC VERIFIED (PASS)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FCEDEC] border border-[#D9534F]/40 px-3 py-1 text-xs font-bold text-[#D9534F]">
                    <ShieldAlert className="h-4 w-4" />
                    ARITHMETIC MISMATCH (FAIL)
                  </span>
                )}
              </div>
            </div>

            {/* Arithmetic Breakdown Rows */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Row 1: Subtotal vs Line Items */}
              <div className="rounded-xl border border-[#E6EAE2] bg-white p-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[#78847C]">Subtotal Check</span>
                  {arith.subtotalMatches ? (
                    <span className="text-[10px] font-bold text-[#23845B] bg-[#E8F5EC] px-2 py-0.5 rounded">MATCH</span>
                  ) : (
                    <span className="text-[10px] font-bold text-[#D9534F] bg-[#FCEDEC] px-2 py-0.5 rounded">MISMATCH</span>
                  )}
                </div>
                <div className="space-y-1 font-mono text-xs">
                  <div className="flex justify-between text-[#78847C]">
                    <span>Line Items Sum:</span>
                    <span className="font-semibold text-[#18251F]">${arith.calculatedLineItemSum.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-[#78847C]">
                    <span>Stated Subtotal:</span>
                    <span className="font-semibold text-[#18251F]">${arith.statedSubtotal.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Row 2: Tax Calculation */}
              <div className="rounded-xl border border-[#E6EAE2] bg-white p-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[#78847C]">Tax Verification</span>
                  {arith.taxMatches ? (
                    <span className="text-[10px] font-bold text-[#23845B] bg-[#E8F5EC] px-2 py-0.5 rounded">MATCH</span>
                  ) : (
                    <span className="text-[10px] font-bold text-[#D9534F] bg-[#FCEDEC] px-2 py-0.5 rounded">MISMATCH</span>
                  )}
                </div>
                <div className="space-y-1 font-mono text-xs">
                  <div className="flex justify-between text-[#78847C]">
                    <span>Calculated Tax:</span>
                    <span className="font-semibold text-[#18251F]">${arith.calculatedTax.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-[#78847C]">
                    <span>Stated Tax:</span>
                    <span className="font-semibold text-[#18251F]">${arith.statedTax.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Row 3: Total Due Calculation */}
              <div className="rounded-xl border border-[#E6EAE2] bg-white p-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[#78847C]">Total Due Check</span>
                  {arith.totalMatches ? (
                    <span className="text-[10px] font-bold text-[#23845B] bg-[#E8F5EC] px-2 py-0.5 rounded">MATCH</span>
                  ) : (
                    <span className="text-[10px] font-bold text-[#D9534F] bg-[#FCEDEC] px-2 py-0.5 rounded">MISMATCH</span>
                  )}
                </div>
                <div className="space-y-1 font-mono text-xs">
                  <div className="flex justify-between text-[#78847C]">
                    <span>Calculated Total:</span>
                    <span className="font-semibold text-[#18251F]">${arith.calculatedTotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-[#78847C]">
                    <span>Stated Total:</span>
                    <span className={`font-semibold ${arith.totalMatches ? 'text-[#18251F]' : 'text-[#D9534F]'}`}>
                      ${arith.statedTotal.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-[#78847C] bg-[#F7F8F3] p-3 rounded-lg border border-[#E6EAE2]">
              <Calculator className="h-4 w-4 text-[#237A57]" />
              <span>
                Calculation formula:{' '}
                <code className="font-mono text-[#18251F]">Total Due = Subtotal + Tax</code> (Decimal precision tolerance: $0.02)
              </span>
            </div>
          </div>

          {/* SECTION 4: CORRECTION AUDIT TRAIL (If Any Corrections Exist) */}
          {(invoice.fieldCorrections || []).length > 0 && (
            <div className="steward-card p-5 sm:p-7 space-y-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#237A57]">
                <History className="h-4 w-4" />
                <span>Field Correction Audit Trail ({(invoice.fieldCorrections || []).length})</span>
              </div>
              <div className="overflow-x-auto rounded-xl border border-[#E6EAE2]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#F7F8F3] border-b border-[#E6EAE2] text-[#78847C] font-semibold">
                    <tr>
                      <th className="py-2.5 px-3">Timestamp</th>
                      <th className="py-2.5 px-3">Field</th>
                      <th className="py-2.5 px-3">Original Value</th>
                      <th className="py-2.5 px-3">Corrected Value</th>
                      <th className="py-2.5 px-3">Operator</th>
                      <th className="py-2.5 px-3">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6EAE2] bg-white font-mono">
                    {(invoice.fieldCorrections || []).map((entry) => (
                      <tr key={entry.id}>
                        <td className="py-2.5 px-3 text-[#78847C]">
                          {new Date(entry.timestamp).toLocaleString([], {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-[#18251F]">{entry.field}</td>
                        <td className="py-2.5 px-3 text-[#D9534F] break-all">{entry.originalValue || '∅'}</td>
                        <td className="py-2.5 px-3 text-[#23845B] font-bold break-all">{entry.correctedValue}</td>
                        <td className="py-2.5 px-3 text-[#78847C]">{entry.correctedBy}</td>
                        <td className="py-2.5 px-3 font-sans text-[#18251F] max-w-xs">{entry.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =========================================================================
          TAB 2: 7-STAGE PIPELINE JOURNEY & DOCUMENT PREVIEW
         ========================================================================= */}
      {activeTab === 'journey' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 animate-fade-in">
          {/* Left Column: 7-Stage Processing Journey */}
          <div className="lg:col-span-6 steward-card p-5 sm:p-6">
            <div className="flex items-center justify-between border-b border-[#E6EAE2] pb-3.5">
              <div>
                <h4 className="font-display text-base font-bold text-[#18251F]">
                  Step-by-Step Verification Journey
                </h4>
                <p className="text-xs text-[#78847C]">
                  Click any stage to inspect technical verification details
                </p>
              </div>
              <span className="rounded-full bg-[#F0F3EC] px-2.5 py-1 text-[11px] font-semibold text-[#123D32]">
                7 Checkpoints
              </span>
            </div>

            <div className="mt-4 space-y-2.5">
              {stages.map((st) => {
                const isOpen = expandedStep === st.stepNumber;
                return (
                  <div
                    key={st.stepNumber}
                    className={`rounded-xl border transition-all ${
                      st.status === 'passed'
                        ? 'border-[#E6EAE2] bg-[#F7F8F3]/70'
                        : st.status === 'warning'
                          ? 'border-[#D99A32]/40 bg-[#FFF5DF]/40'
                          : 'border-[#D9534F]/40 bg-[#FCEDEC]/40'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedStep(isOpen ? null : st.stepNumber)}
                      className="flex w-full items-start justify-between gap-3 p-3.5 text-left cursor-pointer"
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 shrink-0">
                          {st.status === 'passed' ? (
                            <CheckCircle2 className="h-5 w-5 text-[#23845B]" />
                          ) : st.status === 'warning' ? (
                            <Clock className="h-5 w-5 text-[#D99A32]" />
                          ) : (
                            <ShieldAlert className="h-5 w-5 text-[#D9534F]" />
                          )}
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-display text-xs sm:text-sm font-bold text-[#18251F]">
                              {st.title}
                            </span>
                            <span className="font-mono text-[11px] text-[#78847C]">
                              {st.timestamp}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-[#78847C] leading-relaxed">
                            {st.shortExplanation}
                          </p>
                        </div>
                      </div>
                      <div className="text-[#78847C] shrink-0 mt-1">
                        {isOpen ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </div>
                    </button>

                    {isOpen && (
                      <div className="border-t border-[#E6EAE2] bg-white px-4 py-3 rounded-b-xl space-y-1.5 text-xs font-mono">
                        {st.technicalDetails.map((td, idx) => (
                          <div key={idx} className="flex flex-col sm:flex-row sm:justify-between gap-1">
                            <span className="text-[#78847C]">{td.label}:</span>
                            <span className="text-[#18251F] font-medium break-all sm:text-right">
                              {td.value}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Column: Clean Document-Style Extracted Invoice */}
          <div className="lg:col-span-6 steward-card p-5 sm:p-7 flex flex-col justify-between">
            <div className="space-y-5">
              {/* Document Header */}
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#E6EAE2] pb-4">
                <div>
                  <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#237A57]">
                    <FileText className="h-3.5 w-3.5" />
                    <span>Extracted Invoice Document</span>
                  </div>
                  <h4 className="mt-1 font-display text-xl font-extrabold text-[#18251F]">
                    {invoice.vendorName}
                  </h4>
                  <div className="mt-0.5 font-mono text-xs text-[#78847C]">
                    Vendor ID: {invoice.vendorId || 'Unregistered / New Supplier'}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm font-bold text-[#123D32]">
                    #{invoice.invoiceNumber}
                  </div>
                  <div className="mt-1 text-xs text-[#78847C]">
                    Issued: <span className="font-mono text-[#18251F]">{invoice.invoiceDate}</span>
                  </div>
                  <div className="text-xs text-[#78847C]">
                    Due: <span className="font-mono text-[#18251F]">{invoice.dueDate}</span>
                  </div>
                </div>
              </div>

              {/* Line Items Table */}
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-[#78847C] mb-2">
                  Billed Line Items
                </div>
                <div className="overflow-x-auto rounded-xl border border-[#E6EAE2]">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#F7F8F3] border-b border-[#E6EAE2] text-[#78847C] font-semibold">
                      <tr>
                        <th className="py-2.5 px-3">Description</th>
                        <th className="py-2.5 px-3 text-right">Qty</th>
                        <th className="py-2.5 px-3 text-right">Unit Price</th>
                        <th className="py-2.5 px-3 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E6EAE2] bg-white">
                      {invoice.lineItems.map((item, idx) => (
                        <tr key={idx}>
                          <td className="py-2.5 px-3 font-medium text-[#18251F]">
                            {item.description}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#78847C]">
                            {item.quantity}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#78847C]">
                            ${item.unitPrice.toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-semibold tabular-nums text-[#18251F]">
                            ${item.amount.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Subtotal, Tax, Total Summary */}
              <div className="rounded-xl bg-[#F7F8F3] p-4 border border-[#E6EAE2] space-y-2">
                <div className="flex justify-between text-xs text-[#78847C]">
                  <span>Subtotal</span>
                  <span className="font-mono tabular-nums text-[#18251F]">
                    ${invoice.subtotal.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-[#78847C]">
                  <span>Tax</span>
                  <span className="font-mono tabular-nums text-[#18251F]">
                    ${invoice.tax.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between items-baseline border-t border-[#E6EAE2] pt-2">
                  <span className="font-display text-sm font-bold text-[#18251F]">
                    Invoice Total ({invoice.currency})
                  </span>
                  <span
                    className={`font-display text-xl font-extrabold tabular-nums ${
                      hasMathDiscrepancy ? 'text-[#D9534F]' : 'text-[#123D32]'
                    }`}
                  >
                    ${invoice.total.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Payout Asset, Destination Chain, Receiving Address */}
              <div className="rounded-xl border border-[#E6EAE2] bg-white p-4 space-y-2.5 text-xs">
                <div className="text-[11px] font-bold uppercase tracking-wider text-[#78847C]">
                  Payment & Settlement Instructions
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[#78847C]">Payout Asset & Network:</span>
                  <ChainBadge
                    chain={invoice.requestedDestinationChain}
                    asset={invoice.requestedPayoutAsset}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[#78847C]">Receiving Address:</span>
                  <code
                    className={`rounded px-2 py-0.5 font-mono text-xs font-semibold break-all ${
                      hasAddressDiscrepancy || invoice.riskAssessment.isBlocklisted
                        ? 'bg-[#FCEDEC] text-[#B8322E] border border-[#D9534F]/30'
                        : 'bg-[#E8F5EC] text-[#123D32]'
                    }`}
                  >
                    {invoice.receivingWalletAddress}
                  </code>
                </div>
                {invoice.paymentReference && (
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[#E6EAE2]">
                    <span className="text-[#78847C]">Payment Reference:</span>
                    <span className="font-medium text-[#18251F] text-right max-w-xs truncate" title={invoice.paymentReference}>
                      {invoice.paymentReference}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          HUMAN INSPECTION & CORRECTION MODAL (TASK 5)
         ========================================================================= */}
      {showCorrectionModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#18251F]/60 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-2xl border border-[#E6EAE2] bg-white p-6 shadow-2xl space-y-5 animate-fade-in">
            <div className="flex items-start justify-between border-b border-[#E6EAE2] pb-3">
              <div>
                <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#237A57]">
                  <Edit3 className="h-4 w-4" />
                  <span>Inspect & Correct Invoice Field</span>
                </div>
                <h3 className="font-display text-lg font-bold text-[#18251F]">
                  Manual Field Correction
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCorrectionModal(false)}
                className="rounded-lg p-1 text-[#78847C] hover:bg-[#F0F3EC] hover:text-[#18251F] cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {correctionError && (
              <div className="rounded-xl border border-[#D9534F]/40 bg-[#FCEDEC] p-3 text-xs text-[#B8322E]">
                {correctionError}
              </div>
            )}

            <div className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-[#18251F] mb-1">
                  Select Field to Correct:
                </label>
                <select
                  value={selectedField}
                  onChange={handleSelectFieldChange}
                  className="w-full rounded-xl border border-[#E6EAE2] bg-white p-2.5 text-xs text-[#18251F] font-mono focus:outline-hidden focus:border-[#123D32]"
                >
                  <option value="receivingWalletAddress">Receiving Wallet Address</option>
                  <option value="vendorId">Vendor ID</option>
                  <option value="vendorName">Vendor Legal Name</option>
                  <option value="subtotal">Subtotal ($)</option>
                  <option value="tax">Tax ($)</option>
                  <option value="total">Total Due ($)</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-[#18251F] mb-1">
                  Corrected Value:
                </label>
                <input
                  type="text"
                  value={correctedValue}
                  onChange={(e) => setCorrectedValue(e.target.value)}
                  placeholder="Enter corrected value..."
                  className="w-full rounded-xl border border-[#E6EAE2] bg-white p-2.5 text-xs font-mono text-[#18251F] focus:outline-hidden focus:border-[#123D32]"
                />
              </div>

              <div>
                <label className="block font-bold text-[#18251F] mb-1">
                  Reason for Correction (Required for Audit Trail):
                </label>
                <textarea
                  value={correctionReason}
                  onChange={(e) => setCorrectionReason(e.target.value)}
                  placeholder="e.g. Multiline PDF split wrapped wallet address across table boundaries; verified against vendor contract."
                  rows={3}
                  className="w-full rounded-xl border border-[#E6EAE2] bg-white p-2.5 text-xs text-[#18251F] focus:outline-hidden focus:border-[#123D32]"
                />
              </div>

              <div className="rounded-xl bg-[#F7F8F3] p-3 border border-[#E6EAE2] text-[11px] text-[#78847C] space-y-1">
                <div className="font-bold text-[#18251F]">Security Policy Notice:</div>
                <p>
                  Every correction is permanently audited with your user identity and timestamp.
                  Manual correction will trigger automatic re-validation of vendor registry, risk engine, and policy rules.
                  <strong className="text-[#D9534F]">
                    {' '}Corrections CANNOT bypass security BLOCKs for prompt injection, blocklisted addresses, or emergency kill switch.
                  </strong>
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-[#E6EAE2] pt-4">
              <button
                type="button"
                onClick={() => setShowCorrectionModal(false)}
                className="rounded-xl border border-[#E6EAE2] bg-white px-4 py-2 text-xs font-semibold text-[#78847C] hover:bg-[#F0F3EC] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmittingCorrection}
                onClick={submitFieldCorrection}
                className="rounded-xl bg-[#123D32] px-4 py-2 text-xs font-bold text-white hover:bg-[#1B5545] disabled:opacity-50 cursor-pointer shadow-xs"
              >
                {isSubmittingCorrection ? 'Re-evaluating Pipeline...' : 'Apply & Re-validate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

function ConfidenceBadge({ confidence }: { confidence?: import('../../shared/types.js').FieldConfidenceLevel }) {
  const normLevel = (confidence || 'HIGH').toUpperCase();
  if (normLevel === 'HIGH') {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-[#E8F5EC] border border-[#23845B]/30 px-2 py-0.5 text-[10px] font-bold text-[#23845B]"
        title="Extraction Confidence: HIGH (95%+)"
      >
        <Check className="h-2.5 w-2.5" />
        HIGH
      </span>
    );
  }
  if (normLevel === 'MEDIUM') {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-[#F0F3EC] border border-[#237A57]/30 px-2 py-0.5 text-[10px] font-bold text-[#237A57]"
        title="Extraction Confidence: MEDIUM"
      >
        MEDIUM
      </span>
    );
  }
  if (normLevel === 'LOW') {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-[#FFF5DF] border border-[#D99A32]/40 px-2 py-0.5 text-[10px] font-bold text-[#D99A32]"
        title="Extraction Confidence: LOW"
      >
        <AlertTriangle className="h-2.5 w-2.5" />
        LOW
      </span>
    );
  }
  // UNCERTAIN
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-[#FCEDEC] border border-[#D9534F]/40 px-2 py-0.5 text-[10px] font-bold text-[#D9534F] animate-pulse"
      title="Field is ambiguous or uncertain — controller review needed"
    >
      <HelpCircle className="h-2.5 w-2.5" />
      UNCERTAIN
    </span>
  );
}

function AddressDiffView({ extracted, registered }: { extracted: string; registered: string }) {
  if (extracted === registered) {
    return (
      <div className="font-mono text-xs text-[#23845B] font-semibold break-all bg-[#E8F5EC] p-3 rounded-xl border border-[#23845B]/30">
        {extracted}
      </div>
    );
  }

  // Calculate common prefix and suffix
  let start = 0;
  while (start < extracted.length && start < registered.length && extracted[start] === registered[start]) {
    start++;
  }
  let endExt = extracted.length - 1;
  let endReg = registered.length - 1;
  while (endExt >= start && endReg >= start && extracted[endExt] === registered[endReg]) {
    endExt--;
    endReg--;
  }

  const extPrefix = extracted.slice(0, start);
  const extDiff = extracted.slice(start, endExt + 1);
  const extSuffix = extracted.slice(endExt + 1);

  const regPrefix = registered.slice(0, start);
  const regDiff = registered.slice(start, endReg + 1);
  const regSuffix = registered.slice(endReg + 1);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
      <div className="p-3 rounded-xl border border-[#D9534F]/40 bg-[#FCEDEC]">
        <div className="text-[10px] uppercase font-bold text-[#D9534F] mb-1.5 flex items-center justify-between">
          <span>Extracted From Invoice (Requested)</span>
          <span className="text-[10px] font-bold bg-[#D9534F]/20 px-1.5 py-0.2 rounded">Diff Highlighted</span>
        </div>
        <div className="break-all font-semibold text-[#18251F] bg-white p-2 rounded-lg border border-[#D9534F]/30">
          <span>{extPrefix}</span>
          <span className="bg-[#D9534F]/30 text-[#D9534F] font-extrabold px-1 py-0.5 rounded underline">
            {extDiff || '∅'}
          </span>
          <span>{extSuffix}</span>
        </div>
      </div>

      <div className="p-3 rounded-xl border border-[#23845B]/40 bg-[#E8F5EC]">
        <div className="text-[10px] uppercase font-bold text-[#23845B] mb-1.5 flex items-center justify-between">
          <span>Verified In Registry (Expected)</span>
          <span className="text-[10px] font-bold bg-[#23845B]/20 px-1.5 py-0.2 rounded">Expected Target</span>
        </div>
        <div className="break-all font-semibold text-[#18251F] bg-white p-2 rounded-lg border border-[#23845B]/30">
          <span>{regPrefix}</span>
          <span className="bg-[#23845B]/30 text-[#23845B] font-extrabold px-1 py-0.5 rounded underline">
            {regDiff || '∅'}
          </span>
          <span>{regSuffix}</span>
        </div>
      </div>
    </div>
  );
}
