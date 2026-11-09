import type { DatabaseSync } from 'node:sqlite';
import {
  getDb,
  getInvoiceById,
  saveProcessedInvoice,
  logSecurityEvent,
} from '../server/db.js';
import {
  executeAuthorizedPayment,
  independentlyRevalidateBeforeExecution,
} from './paymentExecutionService.js';
import type { ProcessedInvoiceRecord } from '../shared/types.js';

export async function approveHeldInvoice(
  input: {
    invoiceId: string;
    approvedBy: string;
    notes?: string;
    allowNetwork?: boolean;
  },
  db: DatabaseSync = getDb()
): Promise<ProcessedInvoiceRecord> {
  const invoice = getInvoiceById(input.invoiceId, db);
  if (!invoice) {
    throw new Error(`Invoice "${input.invoiceId}" not found.`);
  }

  // Mandatory Security Rule: An approval must NEVER override a BLOCK decision!
  if (invoice.finalDecision === 'BLOCK' || invoice.paymentStatus === 'BLOCKED') {
    logSecurityEvent(
      {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        vendorName: invoice.vendorName,
        severity: 'CRITICAL',
        category: 'POLICY_HOLD',
        title: 'Blocked Approval Override Attempt Rejected',
        description: `Operator "${input.approvedBy}" attempted to approve BLOCKED invoice #${invoice.invoiceNumber}. STEWARD strictly prohibits overriding BLOCK decisions.`,
        metadataJson: JSON.stringify({ approvedBy: input.approvedBy }),
      },
      db
    );
    throw new Error(
      `Cannot approve invoice #${invoice.invoiceNumber}: Invoice was BLOCKED by deterministic security policy (${invoice.decisionReasonSummary}). Human approvals cannot override BLOCK decisions.`
    );
  }

  if (invoice.paymentStatus === 'PAID') {
    return invoice;
  }

  const nowIso = new Date().toISOString();
  const operator = input.approvedBy.trim() || 'controller@steward-ap.finance';

  const updatedRecord: ProcessedInvoiceRecord = {
    ...invoice,
    approvedBy: operator,
    approvedAt: nowIso,
    decisionReasonSummary: `${invoice.decisionReasonSummary} | Approved by ${operator}${input.notes ? ` (${input.notes})` : ''}`,
    updatedAt: nowIso,
  };

  // Pre-execution re-validation: verify kill_switch, daily_cap_usd, blocklist, and vendor status
  const revalidation = independentlyRevalidateBeforeExecution(updatedRecord, db);
  if (!revalidation.allowed) {
    logSecurityEvent(
      {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        vendorName: invoice.vendorName,
        severity: 'CRITICAL',
        category: 'LIMIT_EXCEEDED',
        title: `Approval Execution Blocked for Invoice #${invoice.invoiceNumber}`,
        description: `Controller "${operator}" attempted to approve invoice #${invoice.invoiceNumber}, but pre-execution revalidation blocked settlement: ${revalidation.reason}`,
        metadataJson: JSON.stringify({ approvedBy: operator, reason: revalidation.reason }),
      },
      db
    );
    throw new Error(
      `Approval blocked by pre-execution policy verification: ${revalidation.reason}`
    );
  }

  // Payment service independently revalidates and settles
  const paymentExecution = await executeAuthorizedPayment(updatedRecord, {
    allowNetwork: input.allowNetwork,
    db,
  });

  // When a HELD invoice is approved and settled, update finalDecision to PAY
  updatedRecord.finalDecision = 'PAY';
  updatedRecord.paymentStatus = paymentExecution.status;
  updatedRecord.paymentExecution = paymentExecution;

  saveProcessedInvoice(updatedRecord, db);
  return getInvoiceById(invoice.id, db)!;
}

export function rejectHeldInvoice(
  input: {
    invoiceId: string;
    rejectedBy: string;
    reason: string;
  },
  db: DatabaseSync = getDb()
): ProcessedInvoiceRecord {
  const invoice = getInvoiceById(input.invoiceId, db);
  if (!invoice) {
    throw new Error(`Invoice "${input.invoiceId}" not found.`);
  }

  if (invoice.paymentStatus === 'PAID') {
    throw new Error(`Invoice #${invoice.invoiceNumber} has already been paid.`);
  }

  const nowIso = new Date().toISOString();
  const operator = input.rejectedBy.trim() || 'controller@steward-ap.finance';

  const updatedRecord: ProcessedInvoiceRecord = {
    ...invoice,
    finalDecision: 'BLOCK',
    paymentStatus: 'BLOCKED',
    rejectionReason: `Rejected by ${operator}: ${input.reason}`,
    decisionReasonSummary: `Manually rejected by ${operator}: ${input.reason}`,
    updatedAt: nowIso,
  };

  saveProcessedInvoice(updatedRecord, db);

  logSecurityEvent(
    {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      vendorName: invoice.vendorName,
      severity: 'WARNING',
      category: 'POLICY_HOLD',
      title: `Invoice #${invoice.invoiceNumber} Rejected by Human Reviewer`,
      description: `Operator ${operator} rejected held invoice #${invoice.invoiceNumber} from ${invoice.vendorName}: ${input.reason}`,
      metadataJson: JSON.stringify({ rejectedBy: operator, reason: input.reason }),
    },
    db
  );

  return getInvoiceById(invoice.id, db)!;
}
