import React from 'react';
import {
  X,
  CheckCircle2,
  AlertTriangle,
  XOctagon,
  Shield,
  ArrowRight,
  Lock,
} from 'lucide-react';
import type { ProcessedInvoiceRecord } from '../../shared/types.js';
import { PrivateAiVerifiedPanel } from './PrivateAiVerifiedPanel.js';

interface Props {
  invoice: ProcessedInvoiceRecord | null;
  onClose: () => void;
  onApprove?: (invoiceId: string) => void;
  onReject?: (invoiceId: string) => void;
}

export const PipelineTraceModal: React.FC<Props> = ({
  invoice,
  onClose,
  onApprove,
  onReject,
}) => {
  if (!invoice) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="relative my-8 w-full max-w-4xl rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-sm font-bold text-slate-200">
                Invoice #{invoice.invoiceNumber}
              </span>
              <span
                className={`rounded-md px-2.5 py-0.5 text-xs font-bold uppercase ${
                  invoice.finalDecision === 'PAY'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : invoice.finalDecision === 'HOLD'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                }`}
              >
                Decision: {invoice.finalDecision}
              </span>
              <span className="rounded-md border border-slate-700 bg-slate-800 px-2 py-0.5 font-mono text-xs text-slate-300">
                Status: {invoice.paymentStatus}
              </span>
              <span className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 font-mono text-xs text-indigo-300 uppercase">
                {invoice.mode}
              </span>
            </div>
            <h3 className="mt-1 text-lg font-bold text-white">
              {invoice.vendorName} — ${invoice.total.toFixed(2)} {invoice.requestedPayoutAsset} on{' '}
              {invoice.requestedDestinationChain.toUpperCase()}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-700 bg-slate-800/80 p-1.5 text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Security Architecture Banner */}
        <div className="mt-4 flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/90 px-4 py-2.5 text-xs text-slate-300">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-emerald-400" />
            <span>
              <strong>Security Invariant:</strong> AI extracts & explains (zero payment tools).
              Deterministic code decides. Humans authorize HOLD exceptions.
            </span>
          </div>
          <span className="font-mono text-slate-400">{invoice.processingTimeMs} ms</span>
        </div>

        {/* Stage 1 & 2: Private AI Extraction & Cryptographic TEE Attestation */}
        <div className="mt-4">
          <PrivateAiVerifiedPanel attestation={invoice.attestation} compact />
        </div>

        {/* Stage 3, 4, 5, 6 Breakdown Grid */}
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Schema & Arithmetic Validation */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                1. Schema, Math & Injection Guard
              </h4>
              {invoice.validation.schemaValid &&
              invoice.validation.arithmeticValid &&
              !invoice.validation.promptInjectionDetected ? (
                <span className="text-xs font-semibold text-emerald-400">PASSED</span>
              ) : (
                <span className="text-xs font-semibold text-rose-400">VIOLATION</span>
              )}
            </div>
            <div className="mt-2 space-y-1 text-xs text-slate-300">
              <div>
                Line Items Sum: <strong>${invoice.validation.calculatedLineItemSum.toFixed(2)}</strong>{' '}
                (Stated Subtotal: ${invoice.subtotal.toFixed(2)}, Tax: ${invoice.tax.toFixed(2)})
              </div>
              <div>
                Prompt Injection Scan:{' '}
                {invoice.validation.promptInjectionDetected ? (
                  <span className="font-bold text-rose-400">
                    CRITICAL ATTACK DETECTED ({invoice.validation.injectionFindings.length})
                  </span>
                ) : (
                  <span className="text-emerald-400">Clean (0 embedded commands)</span>
                )}
              </div>
              {invoice.validation.errors.length > 0 && (
                <div className="mt-2 rounded border border-rose-500/40 bg-rose-950/40 p-2 font-mono text-[11px] text-rose-200">
                  {invoice.validation.errors.map((e, i) => (
                    <div key={i}>• {e}</div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Vendor Registry Verification */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                2. Verified Vendor Registry
              </h4>
              {invoice.vendorCheck.isVerifiedVendor &&
              invoice.vendorCheck.addressMatchesRegistry &&
              !invoice.vendorCheck.inCoolingOffPeriod ? (
                <span className="text-xs font-semibold text-emerald-400">MATCHED</span>
              ) : (
                <span className="text-xs font-semibold text-amber-400">DISCREPANCY</span>
              )}
            </div>
            <div className="mt-2 space-y-1 text-xs text-slate-300">
              <div>
                Invoice Wallet:{' '}
                <code className="text-slate-100">{invoice.receivingWalletAddress}</code>
              </div>
              <div>
                Registry Wallet:{' '}
                <code className="text-emerald-300">
                  {invoice.vendorCheck.matchedVendor?.verifiedWalletAddress || 'UNREGISTERED VENDOR'}
                </code>
              </div>
              {invoice.vendorCheck.discrepancies.map((d, i) => (
                <div
                  key={i}
                  className="mt-1 rounded border border-amber-500/30 bg-amber-950/30 p-1.5 text-[11px] text-amber-200"
                >
                  [{d.code}] {d.message}
                </div>
              ))}
            </div>
          </div>

          {/* Counterparty Risk Assessment */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                3. Counterparty Risk Engine
              </h4>
              <span
                className={`text-xs font-bold ${
                  invoice.riskAssessment.decision === 'ALLOW'
                    ? 'text-emerald-400'
                    : invoice.riskAssessment.decision === 'WARN'
                      ? 'text-amber-400'
                      : 'text-rose-400'
                }`}
              >
                {invoice.riskAssessment.decision} (Score: {invoice.riskAssessment.riskScore}/100)
              </span>
            </div>
            <div className="mt-2 space-y-1.5 text-xs text-slate-300">
              {invoice.riskAssessment.reasons.map((r, i) => (
                <div key={i} className="text-[11px]">
                  <span className="font-mono font-semibold text-slate-200">[{r.code}]</span>{' '}
                  {r.message}
                </div>
              ))}
            </div>
          </div>

          {/* Deterministic Policy Decision */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                4. Deterministic Policy Engine
              </h4>
              <span
                className={`text-xs font-bold ${
                  invoice.policyEvaluation.decision === 'PAY'
                    ? 'text-emerald-400'
                    : invoice.policyEvaluation.decision === 'HOLD'
                      ? 'text-amber-400'
                      : 'text-rose-400'
                }`}
              >
                {invoice.policyEvaluation.decision}
              </span>
            </div>
            <div className="mt-2 space-y-1.5 text-xs text-slate-300">
              {invoice.policyEvaluation.reasons.map((r, i) => (
                <div key={i} className="text-[11px]">
                  <span className="font-mono font-semibold text-slate-200">
                    [{r.decisionImpact} / {r.code}]
                  </span>{' '}
                  {r.message}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Stage 5: NEAR Intents 1Click Payment Execution Record */}
        {invoice.paymentExecution && (
          <div className="mt-4 rounded-xl border border-indigo-500/30 bg-indigo-950/20 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-300">
                5. NEAR Intents 1Click Exact-Output Settlement ({invoice.paymentExecution.mode.toUpperCase()})
              </h4>
              <span className="font-mono text-xs text-indigo-200">
                Quote ID: {invoice.paymentExecution.quoteId || 'N/A'}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-2 text-xs text-slate-300 sm:grid-cols-3">
              <div>
                <span className="text-slate-400">Exact Output Guaranteed:</span>{' '}
                <strong className="text-emerald-300">
                  {invoice.paymentExecution.exactRequestedOutput}
                </strong>
              </div>
              <div>
                <span className="text-slate-400">Estimated Input (w/ Buffer):</span>{' '}
                <strong className="text-white">
                  {invoice.paymentExecution.estimatedInputAmount}
                </strong>
              </div>
              <div>
                <span className="text-slate-400">Refund Treasury:</span>{' '}
                <code className="text-slate-200">{invoice.paymentExecution.refundAddress}</code>
              </div>
            </div>
            <div className="mt-2 text-[11px] font-mono text-slate-400">
              Status Source: {invoice.paymentExecution.statusSource}
            </div>
          </div>
        )}

        {/* Action Footer for HELD Invoices */}
        {invoice.paymentStatus === 'HELD' && (onApprove || onReject) && (
          <div className="mt-5 flex items-center justify-end gap-3 border-t border-slate-800 pt-4">
            {onReject && (
              <button
                type="button"
                onClick={() => {
                  onReject(invoice.id);
                  onClose();
                }}
                className="rounded-lg border border-rose-500/40 bg-rose-500/15 px-4 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-500/25 cursor-pointer"
              >
                Reject Invoice (BLOCK)
              </button>
            )}
            {onApprove && (
              <button
                type="button"
                onClick={() => {
                  onApprove(invoice.id);
                  onClose();
                }}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 cursor-pointer"
              >
                Approve Exception & Execute Exact-Output Payment
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
