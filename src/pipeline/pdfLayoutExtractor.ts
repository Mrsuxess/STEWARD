import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type {
  ExtractedInvoice,
  FieldConfidenceInfo,
  FieldConfidenceLevel,
  SupportedChain,
  InvoiceLineItem,
} from '../shared/types.js';

interface RawPdfItem {
  str: string;
  raw: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function validateNetworkAddress(addr: string, chain: string): boolean {
  const clean = addr.trim();
  const c = (chain || 'near').toLowerCase();
  if (c === 'near') {
    const isNamed = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*\.(near|tg|testnet)$/.test(clean);
    const isImplicit = /^[0-9a-fA-F]{64}$/.test(clean);
    return isNamed || isImplicit;
  }
  if (['ethereum', 'arbitrum', 'base'].includes(c)) {
    return /^0x[0-9a-fA-F]{40}$/.test(clean);
  }
  if (c === 'solana') {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(clean);
  }
  if (c === 'bitcoin') {
    return /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(clean);
  }
  return clean.length >= 2;
}

export function parseCurrencyAmount(rawStr?: string | null): number {
  if (!rawStr) return 0;
  const cleaned = rawStr.replace(/[^0-9.-]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : Number(num.toFixed(2));
}

export function reassembleWalletAddress(
  linesOrPieces: string[],
  chain: string = 'near'
): { address: string; isValid: boolean; wasSplit: boolean } {
  const cleanedPieces = linesOrPieces
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (cleanedPieces.length === 0) {
    return { address: '', isValid: false, wasSplit: false };
  }
  if (cleanedPieces.length === 1) {
    const single = cleanedPieces[0].replace(/\s+/g, '');
    return {
      address: single,
      isValid: validateNetworkAddress(single, chain),
      wasSplit: false,
    };
  }

  // Multi-piece joining:
  // Candidate A: direct concatenation (meaningful hyphens preserved, e.g. lagos- + studio.near = lagos-studio.near)
  const candidateDirect = cleanedPieces.join('').replace(/\s+/g, '');

  // Candidate B: trailing wrap-hyphen stripped (e.g. 0x742d- + 35Cc... = 0x742d35Cc...)
  const candidateStripWrapHyphen = cleanedPieces
    .map((p, idx) => (idx < cleanedPieces.length - 1 ? p.replace(/-$/, '') : p))
    .join('')
    .replace(/\s+/g, '');

  // Candidate C: hyphen inserted between pieces if missing
  const candidateAddHyphen = cleanedPieces.join('-').replace(/--+/g, '-').replace(/\s+/g, '');

  const candidates = [candidateDirect, candidateStripWrapHyphen, candidateAddHyphen];
  for (const cand of candidates) {
    if (validateNetworkAddress(cand, chain)) {
      return { address: cand, isValid: true, wasSplit: true };
    }
  }

  // Fallback: return direct concatenation without truncation
  return {
    address: candidateDirect,
    isValid: validateNetworkAddress(candidateDirect, chain),
    wasSplit: true,
  };
}

export interface PdfLayoutExtractionResult {
  cleanText: string;
  structuredHint: Partial<ExtractedInvoice>;
  confidenceMap: Record<string, FieldConfidenceInfo>;
  rawItemsCount: number;
}

export async function extractInvoiceFromPdfLayout(
  fileBuffer: Buffer
): Promise<PdfLayoutExtractionResult> {
  let rawItems: RawPdfItem[] = [];

  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    let workerScript = path.join(currentDir, 'pdfWorkerRunner.cjs');
    if (!fs.existsSync(workerScript)) {
      const srcFallback = path.resolve(process.cwd(), 'src', 'pipeline', 'pdfWorkerRunner.cjs');
      const distFallback = path.resolve(process.cwd(), 'dist', 'pipeline', 'pdfWorkerRunner.cjs');
      if (fs.existsSync(distFallback)) {
        workerScript = distFallback;
      } else if (fs.existsSync(srcFallback)) {
        workerScript = srcFallback;
      }
    }
    const stdout = execFileSync('node', [workerScript], {
      input: fileBuffer,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 10000,
    });
    const parsed = JSON.parse(stdout.toString('utf8')) as { items: RawPdfItem[] };
    rawItems = parsed.items || [];
  } catch {
    // If worker fails on malformed buffer, rawItems remains empty
    rawItems = [];
  }

  if (rawItems.length === 0) {
    return {
      cleanText: '',
      structuredHint: {},
      confidenceMap: {},
      rawItemsCount: 0,
    };
  }

  // 1. Detect structural anchors: Table Header and Totals Header
  const tableHeader = rawItems.find((i) =>
    /^(DESCRIPTION|ITEM|QTY|AMOUNT|SERVICES|DETAILS)/i.test(i.str)
  );
  const totalsHeader = rawItems.find((i) =>
    /^(Subtotal|Total Due|Total|Amount Due|Balance Due)/i.test(i.str)
  );

  const tableHeaderY = tableHeader ? tableHeader.y : 460;
  const totalsY = totalsHeader ? totalsHeader.y : 320;

  // 2. Separate Metadata (above table), Table (between table header and totals), and Totals
  const metadataItems = rawItems.filter((i) => i.y > tableHeaderY);

  // Column detection in metadata:
  // Check if items split into left column (x < 300) and right column (x >= 300)
  const leftCol = metadataItems.filter((i) => i.x < 300).sort((a, b) => b.y - a.y);
  const rightCol = metadataItems.filter((i) => i.x >= 300).sort((a, b) => b.y - a.y);

  // Fallback to single column if all items are on one side
  const useTwoColumns = leftCol.length > 2 && rightCol.length > 2;

  let vendorName = '';
  let vendorId: string | null = null;
  let payoutAsset = 'USDC';
  let destinationChain: SupportedChain = 'near';
  let invoiceNumber = '';
  let invoiceDate = '';
  let dueDate = '';
  let paymentReference = '';
  const walletPieces: string[] = [];

  const leftSourceItems = useTwoColumns ? leftCol : metadataItems.sort((a, b) => b.y - a.y);
  const rightSourceItems = useTwoColumns ? rightCol : [];

  // Parse Left / General Metadata
  for (let i = 0; i < leftSourceItems.length; i++) {
    const it = leftSourceItems[i];
    if (/^Vendor ID/i.test(it.str)) {
      if (it.str.includes(':') && it.str.split(':')[1].trim()) {
        vendorId = it.str.split(':')[1].trim();
      } else if (i + 1 < leftSourceItems.length) {
        vendorId = leftSourceItems[i + 1].str;
      }
    } else if (/^(?:Vendor|From|Supplier)$/i.test(it.str)) {
      if (i + 1 < leftSourceItems.length && !/^Vendor ID/i.test(leftSourceItems[i + 1].str)) {
        vendorName = leftSourceItems[i + 1].str;
      }
    } else if (/^Vendor:\s*(.+)$/i.test(it.str)) {
      vendorName = it.str.replace(/^Vendor:\s*/i, '').trim();
    } else if (/^Payout Asset/i.test(it.str)) {
      if (it.str.includes(':') && it.str.split(':')[1].trim()) {
        payoutAsset = it.str.split(':')[1].trim().toUpperCase();
      } else if (i + 1 < leftSourceItems.length) {
        payoutAsset = leftSourceItems[i + 1].str.toUpperCase();
      }
    } else if (/^Destination Chain/i.test(it.str)) {
      let chainStr = '';
      if (it.str.includes(':') && it.str.split(':')[1].trim()) {
        chainStr = it.str.split(':')[1].trim();
      } else if (i + 1 < leftSourceItems.length) {
        chainStr = leftSourceItems[i + 1].str;
      }
      if (/near/i.test(chainStr)) destinationChain = 'near';
      else if (/arbitrum/i.test(chainStr)) destinationChain = 'arbitrum';
      else if (/base/i.test(chainStr)) destinationChain = 'base';
      else if (/eth/i.test(chainStr)) destinationChain = 'ethereum';
      else if (/sol/i.test(chainStr)) destinationChain = 'solana';
      else if (/btc|bitcoin/i.test(chainStr)) destinationChain = 'bitcoin';
    }
  }

  // Parse Right Column (or items in single column)
  const itemsToScanForRight = useTwoColumns ? rightSourceItems : metadataItems.sort((a, b) => b.y - a.y);
  for (let i = 0; i < itemsToScanForRight.length; i++) {
    const it = itemsToScanForRight[i];
    if (/^Invoice Number/i.test(it.str)) {
      invoiceNumber =
        it.str.includes(':') && it.str.split(':')[1].trim()
          ? it.str.split(':')[1].trim()
          : itemsToScanForRight[i + 1]?.str || '';
    } else if (/^Invoice Date/i.test(it.str)) {
      invoiceDate =
        it.str.includes(':') && it.str.split(':')[1].trim()
          ? it.str.split(':')[1].trim()
          : itemsToScanForRight[i + 1]?.str || '';
    } else if (/^Due Date/i.test(it.str)) {
      dueDate =
        it.str.includes(':') && it.str.split(':')[1].trim()
          ? it.str.split(':')[1].trim()
          : itemsToScanForRight[i + 1]?.str || '';
    } else if (/^Payment Reference/i.test(it.str)) {
      const refPart = it.str.split(':')[1]?.trim() || '';
      const nextPart =
        itemsToScanForRight[i + 1] && !/^(Receiving|Invoice|Due|Payout)/i.test(itemsToScanForRight[i + 1].str)
          ? itemsToScanForRight[i + 1].str
          : '';
      paymentReference = [refPart, nextPart].filter(Boolean).join(' ');
    } else if (/^(?:Receiving Wallet|Wallet Address|Remit Wallet|Pay To Wallet)/i.test(it.str)) {
      const afterColon = it.str.split(':')[1]?.trim();
      if (afterColon) walletPieces.push(afterColon);
      for (let j = i + 1; j < itemsToScanForRight.length; j++) {
        const next = itemsToScanForRight[j];
        if (
          /^(Invoice|Due|Payment|Payout|Vendor|Subtotal|Total|Tax|Description|Amount)/i.test(
            next.str
          )
        ) {
          break;
        }
        walletPieces.push(next.str);
      }
    }
  }

  // Reassemble wallet address with full multiline reconstruction
  const walletReassembly = reassembleWalletAddress(walletPieces, destinationChain);
  const receivingWalletAddress = walletReassembly.address;

  // 3. Extract Totals
  let subtotal = 0;
  let tax = 0;
  let total = 0;

  const totalsItems = rawItems
    .filter((i) => i.y <= totalsY && i.y > 150)
    .sort((a, b) => b.y - a.y || a.x - b.x);

  for (let i = 0; i < totalsItems.length; i++) {
    const it = totalsItems[i];
    if (/^Subtotal/i.test(it.str)) {
      subtotal = parseCurrencyAmount(
        it.str.includes(':') && it.str.split(':')[1].trim()
          ? it.str.split(':')[1]
          : totalsItems[i + 1]?.str
      );
    } else if (/^Tax/i.test(it.str)) {
      tax = parseCurrencyAmount(
        it.str.includes(':') && it.str.split(':')[1].trim()
          ? it.str.split(':')[1]
          : totalsItems[i + 1]?.str
      );
    } else if (/^(?:Total Due|Total|Amount Due|Balance Due)/i.test(it.str)) {
      total = parseCurrencyAmount(
        it.str.includes(':') && it.str.split(':')[1].trim()
          ? it.str.split(':')[1]
          : totalsItems[i + 1]?.str
      );
    }
  }

  // 4. Extract Line Items Table
  const lineItems: InvoiceLineItem[] = [];
  const tableItems = rawItems
    .filter((i) => i.y < tableHeaderY && i.y > totalsY)
    .sort((a, b) => b.y - a.y);

  if (tableItems.length > 0) {
    // Cluster table items into rows using vertical proximity (gap > 16 points = new row)
    const clusters: RawPdfItem[][] = [];
    let curCluster: RawPdfItem[] = [];
    let lastY: number | null = null;

    for (const it of tableItems) {
      if (lastY === null || Math.abs(lastY - it.y) < 18) {
        curCluster.push(it);
        lastY = it.y;
      } else {
        clusters.push(curCluster);
        curCluster = [it];
        lastY = it.y;
      }
    }
    if (curCluster.length > 0) clusters.push(curCluster);

    for (const cluster of clusters) {
      const descItems = cluster.filter((it) => it.x < 280).sort((a, b) => b.y - a.y || a.x - b.x);
      const numItems = cluster.filter((it) => it.x >= 280).sort((a, b) => a.x - b.x);
      const desc = descItems.map((i) => i.str).join(' ').trim();
      if (!desc && numItems.length === 0) continue;

      let qty = 1;
      let unitPrice = 0;
      let amount = 0;

      if (numItems.length >= 3) {
        qty = parseCurrencyAmount(numItems[0].str) || 1;
        unitPrice = parseCurrencyAmount(numItems[1].str);
        amount = parseCurrencyAmount(numItems[2].str);
      } else if (numItems.length === 2) {
        unitPrice = parseCurrencyAmount(numItems[0].str);
        amount = parseCurrencyAmount(numItems[1].str);
      } else if (numItems.length === 1) {
        amount = parseCurrencyAmount(numItems[0].str);
        unitPrice = amount;
      }

      if (amount > 0 || desc.length > 0) {
        lineItems.push({
          description: desc || 'Professional services',
          quantity: qty,
          unitPrice: unitPrice > 0 ? unitPrice : amount,
          amount: amount > 0 ? amount : Number((qty * unitPrice).toFixed(2)),
        });
      }
    }
  }

  // Fallback: If line items empty, synthesize from subtotal/total
  if (lineItems.length === 0 && (subtotal > 0 || total > 0)) {
    const fallbackAmount = subtotal > 0 ? subtotal : total;
    lineItems.push({
      description: `Professional services (${invoiceNumber || 'INV'})`,
      quantity: 1,
      unitPrice: fallbackAmount,
      amount: fallbackAmount,
    });
  }

  if (subtotal === 0 && lineItems.length > 0) {
    subtotal = Number(lineItems.reduce((acc, li) => acc + li.amount, 0).toFixed(2));
  }
  if (total === 0) {
    total = Number((subtotal + tax).toFixed(2));
  }

  // 5. Construct Clean Layout-Aware Text
  const textLines: string[] = [];
  textLines.push('INVOICE');
  if (vendorName) textLines.push(`Vendor: ${vendorName}`);
  if (vendorId) textLines.push(`Vendor ID: ${vendorId}`);
  if (invoiceNumber) textLines.push(`Invoice Number: ${invoiceNumber}`);
  if (invoiceDate) textLines.push(`Invoice Date: ${invoiceDate}`);
  if (dueDate) textLines.push(`Due Date: ${dueDate}`);
  if (paymentReference) textLines.push(`Payment Reference: ${paymentReference}`);
  textLines.push(`Payout Asset: ${payoutAsset}`);
  textLines.push(`Destination Chain: ${destinationChain}`);
  textLines.push(`Receiving Wallet: ${receivingWalletAddress}`);
  textLines.push('');
  textLines.push('LINE ITEMS:');
  for (const li of lineItems) {
    textLines.push(
      `- ${li.description} | Qty: ${li.quantity} | Unit: $${li.unitPrice.toFixed(2)} | Amount: $${li.amount.toFixed(2)}`
    );
  }
  textLines.push('');
  textLines.push(`Subtotal: $${subtotal.toFixed(2)}`);
  textLines.push(`Tax: $${tax.toFixed(2)}`);
  textLines.push(`Total Due: $${total.toFixed(2)} USD`);

  const cleanText = textLines.join('\n');

  // 6. Compute Confidence Ratings
  const confidenceMap: Record<string, FieldConfidenceInfo> = {
    vendorName: {
      field: 'vendorName',
      value: vendorName,
      confidence: vendorName && vendorName !== 'Unknown Vendor' ? 'HIGH' : 'UNCERTAIN',
      isUncertain: !vendorName || vendorName === 'Unknown Vendor',
      uncertaintyReason: !vendorName ? 'Vendor name missing in document' : undefined,
    },
    vendorId: {
      field: 'vendorId',
      value: vendorId,
      confidence: vendorId ? 'HIGH' : 'MEDIUM',
      isUncertain: false,
    },
    invoiceNumber: {
      field: 'invoiceNumber',
      value: invoiceNumber,
      confidence: invoiceNumber ? 'HIGH' : 'UNCERTAIN',
      isUncertain: !invoiceNumber,
      uncertaintyReason: !invoiceNumber ? 'Invoice number missing in document' : undefined,
    },
    receivingWallet: {
      field: 'receivingWallet',
      value: receivingWalletAddress,
      confidence: walletReassembly.isValid
        ? walletReassembly.wasSplit
          ? 'MEDIUM'
          : 'HIGH'
        : 'UNCERTAIN',
      isUncertain: !walletReassembly.isValid,
      uncertaintyReason: !walletReassembly.isValid
        ? `Reconstructed wallet "${receivingWalletAddress}" does not conform to ${destinationChain} network address format`
        : undefined,
      rawSource: walletPieces.join(' '),
    },
    lineItems: {
      field: 'lineItems',
      value: lineItems,
      confidence: lineItems.length > 0 ? 'HIGH' : 'UNCERTAIN',
      isUncertain: lineItems.length === 0,
      uncertaintyReason: lineItems.length === 0 ? 'No line items could be parsed' : undefined,
    },
    subtotal: {
      field: 'subtotal',
      value: subtotal,
      confidence: subtotal > 0 ? 'HIGH' : 'MEDIUM',
      isUncertain: subtotal <= 0,
    },
    tax: {
      field: 'tax',
      value: tax,
      confidence: 'HIGH',
      isUncertain: false,
    },
    total: {
      field: 'total',
      value: total,
      confidence: total > 0 ? 'HIGH' : 'UNCERTAIN',
      isUncertain: total <= 0,
    },
  };

  const structuredHint: Partial<ExtractedInvoice> = {
    vendorName: vendorName || undefined,
    vendorId: vendorId || null,
    invoiceNumber: invoiceNumber || undefined,
    invoiceDate: invoiceDate || undefined,
    dueDate: dueDate || undefined,
    requestedPayoutAsset: payoutAsset,
    requestedDestinationChain: destinationChain,
    receivingWalletAddress,
    paymentReference: paymentReference || undefined,
    lineItems,
    subtotal,
    tax,
    total,
    currency: 'USD',
  };

  return {
    cleanText,
    structuredHint,
    confidenceMap,
    rawItemsCount: rawItems.length,
  };
}
