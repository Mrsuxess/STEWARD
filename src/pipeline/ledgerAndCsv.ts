import type { DatabaseSync } from 'node:sqlite';
import { getDb, listInvoices } from '../server/db.js';
import type { ProcessedInvoiceRecord } from '../shared/types.js';

/**
 * Neutralizes spreadsheet formula injection (CSV Injection / DDE attack)
 * per OWASP recommendations. Any cell starting with =, +, -, @, \t, or \r
 * is prefixed with a single quote (') before RFC 4180 CSV escaping.
 */
export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  let str = String(value).replace(/\r?\n/g, ' ').trim();

  // Neutralize formula execution triggers
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }

  // RFC 4180 escaping: wrap in double quotes if it contains comma, quote, or whitespace
  if (/[",\n\r]/.test(str) || str.startsWith("'")) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

export const ACCOUNTANT_CSV_HEADERS = [
  'Invoice Number',
  'Vendor',
  'Vendor ID',
  'Invoice Date',
  'Due Date',
  'Subtotal (USD)',
  'Tax (USD)',
  'Invoice Amount (USD)',
  'Currency',
  'Payout Asset',
  'Destination Chain',
  'Receiving Wallet Address',
  'Execution Mode',
  'Policy Decision',
  'Payment Status',
  'Quote ID',
  'Payment Fees (USD)',
  'Transaction Link',
  'Decision Reason',
  'Approved By',
  'Timestamp (ISO-8601)',
] as const;

export function generateAccountantCsv(
  records?: ProcessedInvoiceRecord[],
  db: DatabaseSync = getDb()
): string {
  const rows = records || listInvoices(undefined, db);

  const csvLines: string[] = [ACCOUNTANT_CSV_HEADERS.map((h) => sanitizeCsvCell(h)).join(',')];

  for (const inv of rows) {
    const payment = inv.paymentExecution;
    const quoteId =
      payment?.quoteId || (inv.mode === 'simulation' ? `SIM-${inv.invoiceNumber}` : 'N/A');
    const txLink =
      payment?.explorerUrl ||
      (inv.mode === 'simulation' && inv.paymentStatus === 'PAID'
        ? 'SIMULATED (No On-Chain Tx)'
        : 'N/A');
    const feesFormatted = payment ? payment.feesUsd.toFixed(4) : '0.0000';

    const rowValues = [
      inv.invoiceNumber,
      inv.vendorName,
      inv.vendorId || 'UNREGISTERED',
      inv.invoiceDate,
      inv.dueDate,
      inv.subtotal.toFixed(2),
      inv.tax.toFixed(2),
      inv.total.toFixed(2),
      inv.currency,
      inv.requestedPayoutAsset,
      inv.requestedDestinationChain.toUpperCase(),
      inv.receivingWalletAddress,
      inv.mode.toUpperCase(),
      inv.finalDecision,
      inv.paymentStatus,
      quoteId,
      feesFormatted,
      txLink,
      inv.decisionReasonSummary,
      inv.approvedBy || (inv.finalDecision === 'PAY' ? 'AUTO_POLICY_ENGINE' : 'N/A'),
      inv.createdAt,
    ];

    csvLines.push(rowValues.map((cell) => sanitizeCsvCell(cell)).join(','));
  }

  return csvLines.join('\n') + '\n';
}
