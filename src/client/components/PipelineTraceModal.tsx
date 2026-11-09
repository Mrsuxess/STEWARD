import React from 'react';
import { X, Lock } from 'lucide-react';
import type { ProcessedInvoiceRecord } from '../../shared/types.js';
import { PrivateAiVerifiedPanel } from './PrivateAiVerifiedPanel.js';
import { InvoiceJourneyAndPreview } from './InvoiceJourneyAndPreview.js';

interface Props {
  invoice: ProcessedInvoiceRecord | null;
  onClose: () => void;
  onApprove?: (invoiceId: string) => void;
  onReject?: (invoiceId: string) => void;
  onInvoiceUpdated?: (updated: ProcessedInvoiceRecord) => void;
}

export const PipelineTraceModal: React.FC<Props> = ({
  invoice,
  onClose,
  onApprove,
  onReject,
  onInvoiceUpdated,
}) => {
  if (!invoice) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#18251F]/60 p-3 sm:p-6 backdrop-blur-xs overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-invoice-title"
    >
      <div className="relative my-6 w-full max-w-6xl rounded-2xl border border-[#E6EAE2] bg-[#F7F8F3] p-5 sm:p-7 shadow-2xl max-h-[92vh] overflow-y-auto animate-fade-in">
        {/* Top Modal Header */}
        <div className="flex items-start justify-between gap-4 border-b border-[#E6EAE2] pb-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#237A57]">
              <Lock className="h-3.5 w-3.5" />
              <span>Invoice Verification & Security Report</span>
            </div>
            <h2
              id="modal-invoice-title"
              className="mt-1 font-display text-xl sm:text-2xl font-extrabold text-[#18251F]"
            >
              Invoice #{invoice.invoiceNumber} — {invoice.vendorName} (${invoice.total.toFixed(2)})
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close invoice details"
            className="rounded-xl border border-[#E6EAE2] bg-white p-2 text-[#78847C] hover:text-[#18251F] hover:bg-[#F0F3EC] transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 7-Stage Journey & Document Preview */}
        <div className="mt-5">
          <InvoiceJourneyAndPreview
            invoice={invoice}
            onInvoiceUpdated={onInvoiceUpdated}
            onApproveRequest={
              onApprove
                ? (inv) => {
                    onApprove(inv.id);
                    onClose();
                  }
                : undefined
            }
            onRejectRequest={
              onReject
                ? (inv) => {
                    onReject(inv.id);
                    onClose();
                  }
                : undefined
            }
          />
        </div>

        {/* Private AI Verification Panel */}
        <div className="mt-6">
          <PrivateAiVerifiedPanel attestation={invoice.attestation} />
        </div>
      </div>
    </div>
  );
};
