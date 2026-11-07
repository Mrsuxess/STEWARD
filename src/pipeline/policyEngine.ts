import type { DatabaseSync } from 'node:sqlite';
import { getDb, getPolicyConfig } from '../server/db.js';
import type {
  AttestationVerificationResult,
  CounterpartyRiskResult,
  ExtractedInvoice,
  OperatingMode,
  PolicyDecisionType,
  PolicyEvaluationResult,
  PolicyReason,
  ValidationOutcome,
  VendorCheckResult,
} from '../shared/types.js';

export function checkDuplicateInvoice(
  invoiceNumber: string,
  vendorName: string,
  db: DatabaseSync = getDb()
): { isDuplicate: boolean; existingInvoiceId?: string; existingStatus?: string } {
  const row = db
    .prepare(
      `SELECT id, payment_status FROM invoices
       WHERE LOWER(invoice_number) = LOWER(?)
         AND LOWER(vendor_name) = LOWER(?)
       LIMIT 1`
    )
    .get(invoiceNumber.trim(), vendorName.trim()) as
    | { id: string; payment_status: string }
    | undefined;

  if (!row) {
    return { isDuplicate: false };
  }
  return {
    isDuplicate: true,
    existingInvoiceId: row.id,
    existingStatus: row.payment_status,
  };
}

export function getDailySpendSoFarUsd(
  mode: OperatingMode,
  db: DatabaseSync = getDb()
): number {
  const todayPrefix = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(total), 0) as spent
       FROM invoices
       WHERE mode = ?
         AND payment_status IN ('PAID', 'PENDING')
         AND substr(created_at, 1, 10) = ?`
    )
    .get(mode, todayPrefix) as { spent: number } | undefined;

  return Number((row?.spent || 0).toFixed(2));
}

export function evaluatePaymentPolicy(
  input: {
    mode: OperatingMode;
    invoice: ExtractedInvoice;
    validation: ValidationOutcome;
    attestation: AttestationVerificationResult;
    vendorCheck: VendorCheckResult;
    riskAssessment: CounterpartyRiskResult;
  },
  db: DatabaseSync = getDb()
): PolicyEvaluationResult {
  const policy = getPolicyConfig(db);
  const reasons: PolicyReason[] = [];
  const dailySpendSoFarUsd = getDailySpendSoFarUsd(input.mode, db);
  const dailySpendRemainingUsd = Number(
    Math.max(0, policy.daily_cap_usd - dailySpendSoFarUsd).toFixed(2)
  );

  // ---------------------------------------------------------------------------
  // 1. MANDATORY BLOCK RULES (Cannot be overridden by AI or Human Approval)
  // ---------------------------------------------------------------------------

  // Rule B1: Kill Switch
  if (policy.kill_switch) {
    reasons.push({
      code: 'KILL_SWITCH_ACTIVE',
      rule: 'kill_switch',
      decisionImpact: 'BLOCK',
      message: 'Emergency Treasury Kill Switch is ACTIVE. All automated and manual payouts are halted.',
    });
  }

  // Rule B2: Prompt Injection / Security Violation
  if (input.validation.promptInjectionDetected) {
    reasons.push({
      code: 'PROMPT_INJECTION_DETECTED',
      rule: 'security.prompt_injection_defense',
      decisionImpact: 'BLOCK',
      message: `Malicious instruction or prompt-injection attempt detected inside invoice: ${input.validation.injectionFindings.map((f) => f.code).join(', ')}.`,
    });
  }

  // Rule B3: Schema or Arithmetic Inconsistency
  if (!input.validation.schemaValid || !input.validation.arithmeticValid) {
    reasons.push({
      code: 'ARITHMETIC_OR_SCHEMA_INVALID',
      rule: 'integrity.invoice_arithmetic',
      decisionImpact: 'BLOCK',
      message:
        input.validation.errors.join(' ') ||
        'Invoice failed schema validation or line-item/tax/total arithmetic consistency check.',
    });
  }

  // Rule B4: Duplicate Invoice Detection
  const dupCheck = checkDuplicateInvoice(
    input.invoice.invoiceNumber,
    input.invoice.vendorName,
    db
  );
  if (dupCheck.isDuplicate) {
    reasons.push({
      code: 'DUPLICATE_INVOICE',
      rule: 'integrity.duplicate_prevention',
      decisionImpact: 'BLOCK',
      message: `Duplicate invoice detected: Invoice #${input.invoice.invoiceNumber} from "${input.invoice.vendorName}" was already processed (Record ${dupCheck.existingInvoiceId}, status: ${dupCheck.existingStatus}).`,
    });
  }

  // Rule B5: Blocklisted Address or Counterparty Risk BLOCK
  if (input.riskAssessment.isBlocklisted || input.riskAssessment.decision === 'BLOCK') {
    const blockReasons = input.riskAssessment.reasons
      .filter((r) => r.severity === 'CRITICAL')
      .map((r) => r.message)
      .join(' ');
    reasons.push({
      code: input.riskAssessment.isBlocklisted ? 'BLOCKLISTED_ADDRESS' : 'COUNTERPARTY_RISK_BLOCK',
      rule: 'counterparty.risk_engine',
      decisionImpact: 'BLOCK',
      message:
        blockReasons ||
        `Counterparty Risk Engine returned BLOCK (score ${input.riskAssessment.riskScore}/100).`,
    });
  }

  // Rule B6: Unauthorized Payout Asset
  const requestedAssetUpper = input.invoice.requestedPayoutAsset.trim().toUpperCase();
  const allowedAssetsUpper = policy.allowed_payout_assets.map((a) => a.toUpperCase());
  if (!allowedAssetsUpper.includes(requestedAssetUpper)) {
    reasons.push({
      code: 'UNAUTHORIZED_PAYOUT_ASSET',
      rule: 'allowed_payout_assets',
      decisionImpact: 'BLOCK',
      message: `Invoice requests payout in "${requestedAssetUpper}", which is not in allowed_payout_assets ([${allowedAssetsUpper.join(', ')}]).`,
    });
  }

  // Rule B7: Hard Per-Invoice Cap Exceeded ($500 default)
  if (input.invoice.total > policy.per_invoice_cap_usd) {
    reasons.push({
      code: 'EXCEEDS_PER_INVOICE_HARD_CAP',
      rule: 'per_invoice_cap_usd',
      decisionImpact: 'BLOCK',
      message: `Invoice total ($${input.invoice.total.toFixed(2)}) exceeds the hard per-invoice policy cap of $${policy.per_invoice_cap_usd.toFixed(2)}.`,
    });
  }

  // Rule B8: Hard Daily Cap Exceeded ($1,500 default)
  if (dailySpendSoFarUsd + input.invoice.total > policy.daily_cap_usd) {
    reasons.push({
      code: 'EXCEEDS_DAILY_SPEND_CAP',
      rule: 'daily_cap_usd',
      decisionImpact: 'BLOCK',
      message: `Paying $${input.invoice.total.toFixed(2)} would bring today's total spend to $${(dailySpendSoFarUsd + input.invoice.total).toFixed(2)}, exceeding the daily hard cap of $${policy.daily_cap_usd.toFixed(2)} (spent today: $${dailySpendSoFarUsd.toFixed(2)}).`,
    });
  }

  // Rule B9: Suspended Vendor
  if (input.vendorCheck.matchedVendor?.status === 'SUSPENDED') {
    reasons.push({
      code: 'VENDOR_SUSPENDED',
      rule: 'vendor.status',
      decisionImpact: 'BLOCK',
      message: `Vendor "${input.invoice.vendorName}" is marked SUSPENDED in the registry.`,
    });
  }

  // ---------------------------------------------------------------------------
  // 2. MANDATORY HOLD RULES (Require Human Controller Authorization)
  // ---------------------------------------------------------------------------

  // Rule H1: New Vendor
  if (input.vendorCheck.isNewVendor) {
    const impact: PolicyDecisionType = policy.new_vendor === 'block' ? 'BLOCK' : 'HOLD';
    reasons.push({
      code: 'NEW_VENDOR_REQUIRES_HUMAN_APPROVAL',
      rule: 'new_vendor',
      decisionImpact: impact,
      message: `Vendor "${input.invoice.vendorName}" is not in the Verified Vendor Registry. Policy new_vendor=${policy.new_vendor} requires human review.`,
    });
  }

  // Rule H2: Address Change / Mismatch with Verified Vendor Registry
  if (!input.vendorCheck.isNewVendor && !input.vendorCheck.addressMatchesRegistry) {
    reasons.push({
      code: 'ADDRESS_MISMATCH_WITH_REGISTRY',
      rule: 'address_change.require_human',
      decisionImpact: 'HOLD',
      message: `Invoice receiving wallet ("${input.invoice.receivingWalletAddress}") differs from verified vendor registry address ("${input.vendorCheck.matchedVendor?.verifiedWalletAddress}"). Silent address changes cannot auto-pay; requires 48h cooling-off & human confirmation.`,
    });
  }

  // Rule H3: Active 48-Hour Address Cooling-Off Period
  if (input.vendorCheck.inCoolingOffPeriod) {
    reasons.push({
      code: 'ADDRESS_COOLING_OFF_ACTIVE',
      rule: 'address_change.cooling_off_hours',
      decisionImpact: 'HOLD',
      message: `Vendor "${input.invoice.vendorName}" is in a ${policy.address_change.cooling_off_hours}-hour address-change cooling-off period (${input.vendorCheck.coolingOffRemainingHours}h remaining). Human confirmation required.`,
    });
  }

  // Rule H4: Exceeds Automatic Approval Threshold ($200 default, up to $500 cap)
  if (
    input.invoice.total >= policy.auto_approve_below_usd &&
    input.invoice.total <= policy.per_invoice_cap_usd
  ) {
    reasons.push({
      code: 'EXCEEDS_AUTO_APPROVE_THRESHOLD',
      rule: 'auto_approve_below_usd',
      decisionImpact: 'HOLD',
      message: `Invoice amount ($${input.invoice.total.toFixed(2)}) is at or above the automatic payment limit ($${policy.auto_approve_below_usd.toFixed(2)}). Queued for human approval.`,
    });
  }

  // Rule H5: Counterparty Risk Engine returned WARN
  if (input.riskAssessment.decision === 'WARN') {
    const warnMsgs = input.riskAssessment.reasons
      .filter((r) => r.severity === 'WARN' || r.severity === 'CRITICAL')
      .map((r) => r.message)
      .join(' ');
    reasons.push({
      code: 'COUNTERPARTY_RISK_WARN',
      rule: 'counterparty.risk_engine',
      decisionImpact: 'HOLD',
      message:
        warnMsgs ||
        `Counterparty Risk Engine returned WARN (score ${input.riskAssessment.riskScore}/100).`,
    });
  }

  // Rule H6: Destination Chain Differs from Vendor's Registered Preference
  if (!input.vendorCheck.isNewVendor && !input.vendorCheck.chainMatchesPreference) {
    reasons.push({
      code: 'CHAIN_PREFERENCE_MISMATCH',
      rule: 'vendor.preferred_destination_chain',
      decisionImpact: 'HOLD',
      message: `Invoice requests settlement on "${input.invoice.requestedDestinationChain}", which differs from vendor's registered preference ("${input.vendorCheck.matchedVendor?.preferredDestinationChain}").`,
    });
  }

  // Rule H7: Attestation Verification Failure in Live Mode
  if (input.mode === 'live' && !input.attestation.verified) {
    reasons.push({
      code: 'TEE_ATTESTATION_UNVERIFIED',
      rule: 'privacy.tee_attestation_required',
      decisionImpact: 'HOLD',
      message:
        'NEAR AI Cloud TEE hardware attestation failed verification; holding invoice for manual verification.',
    });
  }

  // ---------------------------------------------------------------------------
  // 3. DETERMINE FINAL DETERMINISTIC OUTCOME (BLOCK > HOLD > PAY)
  // ---------------------------------------------------------------------------
  const hasBlock = reasons.some((r) => r.decisionImpact === 'BLOCK');
  const hasHold = reasons.some((r) => r.decisionImpact === 'HOLD');

  let decision: PolicyDecisionType = 'PAY';
  if (hasBlock) {
    decision = 'BLOCK';
  } else if (hasHold) {
    decision = 'HOLD';
  } else {
    reasons.push({
      code: 'ALL_POLICY_CHECKS_PASSED',
      rule: 'auto_approve_below_usd',
      decisionImpact: 'PAY',
      message: `Verified vendor (${input.invoice.vendorName}), matching registry address (${input.invoice.receivingWalletAddress}), valid math, risk ALLOW, and amount ($${input.invoice.total.toFixed(2)}) below $${policy.auto_approve_below_usd.toFixed(2)} auto-approval limit.`,
    });
  }

  return {
    decision,
    requiresHumanApproval: decision === 'HOLD',
    canHumanOverride: decision === 'HOLD', // BLOCK can NEVER be overridden by human approval
    dailySpendSoFarUsd,
    dailySpendRemainingUsd,
    isDuplicateInvoice: dupCheck.isDuplicate,
    reasons,
    policySnapshot: policy,
    evaluatedAt: new Date().toISOString(),
  };
}
