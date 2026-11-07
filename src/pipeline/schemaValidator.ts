import { z } from 'zod';
import type {
  ExtractedInvoice,
  PromptInjectionFinding,
  ValidationOutcome,
} from '../shared/types.js';

export const InvoiceLineItemSchema = z.object({
  description: z.string().min(1, 'Line item description is required'),
  quantity: z.number().positive('Line item quantity must be positive'),
  unitPrice: z.number().nonnegative('Line item unitPrice must be non-negative'),
  amount: z.number().nonnegative('Line item amount must be non-negative'),
});

export const ExtractedInvoiceSchema = z.object({
  vendorName: z.string().min(1, 'Vendor name is required'),
  vendorId: z.string().nullable().optional(),
  invoiceNumber: z.string().min(1, 'Invoice number is required'),
  invoiceDate: z.string().min(4, 'Invoice date is required'),
  dueDate: z.string().min(4, 'Due date is required'),
  lineItems: z.array(InvoiceLineItemSchema).min(1, 'At least one line item is required'),
  subtotal: z.number().positive('Subtotal must be positive'),
  tax: z.number().nonnegative('Tax cannot be negative'),
  total: z.number().positive('Total must be positive'),
  currency: z.string().min(1, 'Currency is required'),
  requestedPayoutAsset: z.string().min(1, 'Requested payout asset is required'),
  requestedDestinationChain: z.enum([
    'near',
    'ethereum',
    'arbitrum',
    'solana',
    'base',
    'bitcoin',
  ]),
  receivingWalletAddress: z.string().min(2, 'Receiving wallet address is required'),
  paymentReference: z.string().min(1, 'Payment reference is required'),
});

interface InjectionPatternRule {
  code: string;
  severity: 'HIGH' | 'CRITICAL';
  regex: RegExp;
  message: string;
}

const PROMPT_INJECTION_RULES: InjectionPatternRule[] = [
  {
    code: 'IGNORE_PREVIOUS_INSTRUCTIONS',
    severity: 'CRITICAL',
    regex: /ignore\s+(all\s+)?(previous|prior|existing|above)\s+(instructions|policies|rules|prompts|checks)/i,
    message: 'Invoice contains an explicit prompt-injection command attempting to override prior instructions or policies.',
  },
  {
    code: 'SYSTEM_ROLE_SPOOFING',
    severity: 'CRITICAL',
    regex: /(\[?\s*SYSTEM\s*(OVERRIDE|MESSAGE|INSTRUCTION|PROMPT|ADMIN)\s*\]?|<\|im_start\|>system|###\s*SYSTEM\s*INSTRUCTION)/i,
    message: 'Invoice embeds a spoofed SYSTEM prompt/instruction block attempting privilege escalation.',
  },
  {
    code: 'WALLET_REDIRECT_INJECTION',
    severity: 'CRITICAL',
    regex: /(override|replace|disregard|ignore)\s+(the\s+)?(verified|registered|vendor)\s+(wallet|address|account)|send\s+payment\s+instead\s+to/i,
    message: 'Invoice contains embedded instructions attempting to redirect the payout wallet away from the verified vendor registry.',
  },
  {
    code: 'POLICY_OR_APPROVAL_BYPASS_COMMAND',
    severity: 'CRITICAL',
    regex: /(mark|set|force)\s+(this\s+)?(invoice|payment|transaction|vendor)\s+as\s+(approved|verified|authorized|paid)|bypass\s+(human\s+approval|policy\s+engine|spending\s+limit)/i,
    message: 'Invoice attempts to command the system to bypass human approval or deterministic policy limits.',
  },
  {
    code: 'TOOL_OR_SECRET_EXFILTRATION',
    severity: 'CRITICAL',
    regex: /(execute_payment|sign_transaction|reveal\s+(api\s+key|private\s+key|seed\s+phrase|env|secrets)|process\.env)/i,
    message: 'Invoice attempts to invoke privileged payment tools or exfiltrate secrets/credentials.',
  },
];

export function scanForPromptInjection(
  rawText: string,
  extracted?: Partial<ExtractedInvoice>
): PromptInjectionFinding[] {
  const findings: PromptInjectionFinding[] = [];
  const combinedTargets = [
    rawText,
    extracted?.vendorName || '',
    extracted?.paymentReference || '',
    ...(extracted?.lineItems || []).map((li) => li.description),
  ].join('\n');

  for (const rule of PROMPT_INJECTION_RULES) {
    const match = combinedTargets.match(rule.regex);
    if (match) {
      const idx = match.index ?? 0;
      const excerpt = combinedTargets
        .slice(Math.max(0, idx - 30), Math.min(combinedTargets.length, idx + match[0].length + 45))
        .replace(/\s+/g, ' ')
        .trim();
      findings.push({
        code: rule.code,
        severity: rule.severity,
        pattern: rule.regex.source,
        excerpt,
        message: rule.message,
      });
    }
  }

  return findings;
}

export function validateExtractedInvoice(
  candidate: unknown,
  rawTextForSecurityScan = ''
): { parsed: ExtractedInvoice | null; outcome: ValidationOutcome } {
  const errors: string[] = [];
  const parseResult = ExtractedInvoiceSchema.safeParse(candidate);

  if (!parseResult.success) {
    for (const issue of parseResult.error.issues) {
      errors.push(`${issue.path.join('.')}: ${issue.message}`);
    }
    const injectionFindings = scanForPromptInjection(rawTextForSecurityScan);
    return {
      parsed: null,
      outcome: {
        schemaValid: false,
        arithmeticValid: false,
        promptInjectionDetected: injectionFindings.length > 0,
        calculatedLineItemSum: 0,
        calculatedTotal: 0,
        arithmeticDiff: 0,
        errors,
        injectionFindings,
      },
    };
  }

  const inv = parseResult.data;

  // Verify each line item quantity * unitPrice == amount (tolerance $0.02)
  let calculatedLineItemSum = 0;
  let lineMathValid = true;

  for (const [idx, item] of inv.lineItems.entries()) {
    const expectedLineAmount = Number((item.quantity * item.unitPrice).toFixed(2));
    if (Math.abs(expectedLineAmount - item.amount) > 0.02) {
      lineMathValid = false;
      errors.push(
        `Line item #${idx + 1} ("${item.description}") arithmetic mismatch: ${item.quantity} × ${item.unitPrice.toFixed(2)} = ${expectedLineAmount.toFixed(2)}, but line amount states ${item.amount.toFixed(2)}.`
      );
    }
    calculatedLineItemSum += item.amount;
  }

  calculatedLineItemSum = Number(calculatedLineItemSum.toFixed(2));
  const calculatedTotal = Number((calculatedLineItemSum + inv.tax).toFixed(2));

  const subtotalDiff = Math.abs(calculatedLineItemSum - inv.subtotal);
  const totalDiff = Math.abs(calculatedTotal - inv.total);
  const arithmeticDiff = Number(Math.max(subtotalDiff, totalDiff).toFixed(2));

  if (subtotalDiff > 0.02) {
    errors.push(
      `Subtotal mismatch: sum of line items is ${calculatedLineItemSum.toFixed(2)}, but invoice subtotal states ${inv.subtotal.toFixed(2)}.`
    );
  }
  if (totalDiff > 0.02) {
    errors.push(
      `Total mismatch: subtotal (${inv.subtotal.toFixed(2)}) + tax (${inv.tax.toFixed(2)}) = ${(inv.subtotal + inv.tax).toFixed(2)} (from lines: ${calculatedTotal.toFixed(2)}), but invoice total states ${inv.total.toFixed(2)}.`
    );
  }

  const arithmeticValid = lineMathValid && subtotalDiff <= 0.02 && totalDiff <= 0.02;
  const injectionFindings = scanForPromptInjection(rawTextForSecurityScan, inv);

  if (injectionFindings.length > 0) {
    for (const f of injectionFindings) {
      errors.push(`[SECURITY/${f.code}] ${f.message}`);
    }
  }

  return {
    parsed: inv,
    outcome: {
      schemaValid: true,
      arithmeticValid,
      promptInjectionDetected: injectionFindings.length > 0,
      calculatedLineItemSum,
      calculatedTotal,
      arithmeticDiff,
      errors,
      injectionFindings,
    },
  };
}
