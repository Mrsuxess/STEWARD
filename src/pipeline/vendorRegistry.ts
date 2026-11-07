import type { DatabaseSync } from 'node:sqlite';
import {
  getDb,
  getVendorByIdOrName,
  getPolicyConfig,
} from '../server/db.js';
import type {
  ExtractedInvoice,
  VendorCheckResult,
  VendorRecord,
  SupportedChain,
} from '../shared/types.js';

export function evaluateVendorRegistry(
  invoice: ExtractedInvoice,
  db: DatabaseSync = getDb()
): VendorCheckResult {
  const matchedVendor = getVendorByIdOrName(invoice.vendorId, invoice.vendorName, db);
  const discrepancies: Array<{ code: string; message: string }> = [];

  if (!matchedVendor) {
    discrepancies.push({
      code: 'NEW_UNVERIFIED_VENDOR',
      message: `Vendor "${invoice.vendorName}" is not in the Verified Vendor Registry. Rule #1 requires human onboarding approval before any payout.`,
    });
    return {
      matchedVendor: null,
      isNewVendor: true,
      isVerifiedVendor: false,
      addressMatchesRegistry: false,
      inCoolingOffPeriod: false,
      coolingOffRemainingHours: 0,
      chainMatchesPreference: false,
      assetMatchesPreference: false,
      discrepancies,
    };
  }

  const isVerifiedVendor = matchedVendor.status === 'VERIFIED';
  const normalizedInvoiceAddr = invoice.receivingWalletAddress.trim().toLowerCase();
  const normalizedRegistryAddr = matchedVendor.verifiedWalletAddress.trim().toLowerCase();
  const addressMatchesRegistry = normalizedInvoiceAddr === normalizedRegistryAddr;

  if (!addressMatchesRegistry) {
    discrepancies.push({
      code: 'ADDRESS_MISMATCH_WITH_REGISTRY',
      message: `Invoice requests payment to "${invoice.receivingWalletAddress}", which DOES NOT match the verified registry address "${matchedVendor.verifiedWalletAddress}" for ${matchedVendor.businessName}. Silent address changes are forbidden.`,
    });
  }

  let inCoolingOffPeriod = false;
  let coolingOffRemainingHours = 0;

  if (matchedVendor.coolingOffUntil) {
    const untilMs = new Date(matchedVendor.coolingOffUntil).getTime();
    const nowMs = Date.now();
    if (untilMs > nowMs) {
      inCoolingOffPeriod = true;
      coolingOffRemainingHours = Number(((untilMs - nowMs) / (1000 * 3600)).toFixed(1));
      discrepancies.push({
        code: 'VENDOR_IN_COOLING_OFF_PERIOD',
        message: `Vendor "${matchedVendor.businessName}" recently changed its wallet address and is in a mandatory 48-hour cooling-off period (${coolingOffRemainingHours}h remaining until ${matchedVendor.coolingOffUntil}). Human confirmation required.`,
      });
    }
  }

  if (matchedVendor.status === 'PENDING_APPROVAL') {
    discrepancies.push({
      code: 'VENDOR_PENDING_APPROVAL',
      message: `Vendor "${matchedVendor.businessName}" is registered with status PENDING_APPROVAL and requires human verification.`,
    });
  } else if (matchedVendor.status === 'SUSPENDED') {
    discrepancies.push({
      code: 'VENDOR_SUSPENDED',
      message: `Vendor "${matchedVendor.businessName}" is currently SUSPENDED in the registry.`,
    });
  }

  const chainMatchesPreference =
    invoice.requestedDestinationChain.toLowerCase() ===
    matchedVendor.preferredDestinationChain.toLowerCase();
  if (!chainMatchesPreference) {
    discrepancies.push({
      code: 'DESTINATION_CHAIN_MISMATCH',
      message: `Invoice requests payout on chain "${invoice.requestedDestinationChain}", whereas vendor's registered preferred chain is "${matchedVendor.preferredDestinationChain}".`,
    });
  }

  const assetMatchesPreference =
    invoice.requestedPayoutAsset.toUpperCase() ===
    matchedVendor.preferredPayoutAsset.toUpperCase();
  if (!assetMatchesPreference) {
    discrepancies.push({
      code: 'PAYOUT_ASSET_MISMATCH',
      message: `Invoice requests payout asset "${invoice.requestedPayoutAsset}", whereas vendor's registered preferred asset is "${matchedVendor.preferredPayoutAsset}".`,
    });
  }

  return {
    matchedVendor,
    isNewVendor: false,
    isVerifiedVendor,
    addressMatchesRegistry,
    inCoolingOffPeriod,
    coolingOffRemainingHours,
    chainMatchesPreference,
    assetMatchesPreference,
    discrepancies,
  };
}

export function createNewVendorInRegistry(
  input: {
    businessName: string;
    walletAddress: string;
    preferredPayoutAsset: string;
    preferredDestinationChain: SupportedChain;
    requestedBy?: string;
    autoVerify?: boolean;
  },
  db: DatabaseSync = getDb()
): VendorRecord {
  const now = new Date().toISOString();
  const id = `VND-${Date.now().toString(36).toUpperCase()}`;
  const status = input.autoVerify ? 'VERIFIED' : 'PENDING_APPROVAL';
  const operator = input.requestedBy || 'ap-operator@steward-ap.finance';

  const history = [
    {
      action: input.autoVerify ? 'VENDOR_CREATED_AND_VERIFIED' : 'VENDOR_CREATED_PENDING_APPROVAL',
      approvedBy: operator,
      timestamp: now,
      notes: `Registered wallet ${input.walletAddress} on ${input.preferredDestinationChain}.`,
    },
  ];

  db.prepare(`
    INSERT INTO vendors (
      id, business_name, verified_wallet_address, preferred_payout_asset,
      preferred_destination_chain, status, cooling_off_until, pending_wallet_address,
      created_at, updated_at, approval_history_json, payment_count, total_paid_usd
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
  `).run(
    id,
    input.businessName.trim(),
    input.walletAddress.trim(),
    input.preferredPayoutAsset.trim().toUpperCase(),
    input.preferredDestinationChain,
    status,
    null,
    null,
    now,
    now,
    JSON.stringify(history)
  );

  db.prepare(`
    INSERT INTO vendor_address_history (
      id, vendor_id, business_name, previous_address, new_address,
      changed_by, reason, cooling_off_until, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `HIST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    id,
    input.businessName.trim(),
    null,
    input.walletAddress.trim(),
    operator,
    'Initial vendor onboarding',
    now,
    now
  );

  return getVendorByIdOrName(id, null, db)!;
}

export function requestVendorAddressChange(
  input: {
    vendorId: string;
    newWalletAddress: string;
    newDestinationChain?: SupportedChain;
    changedBy: string;
    reason: string;
  },
  db: DatabaseSync = getDb()
): VendorRecord {
  const existing = getVendorByIdOrName(input.vendorId, null, db);
  if (!existing) {
    throw new Error(`Vendor ${input.vendorId} not found.`);
  }

  const policy = getPolicyConfig(db);
  const coolingOffHours = policy.address_change.cooling_off_hours || 48;
  const now = new Date();
  const coolingOffUntil = new Date(now.getTime() + coolingOffHours * 3600 * 1000).toISOString();
  const nowIso = now.toISOString();

  const updatedHistory = [
    ...existing.approvalHistory,
    {
      action: 'ADDRESS_CHANGE_COOLING_OFF_STARTED',
      approvedBy: input.changedBy,
      timestamp: nowIso,
      notes: `Changed address from ${existing.verifiedWalletAddress} to ${input.newWalletAddress}. Mandatory ${coolingOffHours}h cooling-off until ${coolingOffUntil}. Reason: ${input.reason}`,
    },
  ];

  db.prepare(`
    UPDATE vendors
    SET verified_wallet_address = ?,
        preferred_destination_chain = ?,
        status = 'COOLING_OFF',
        cooling_off_until = ?,
        pending_wallet_address = ?,
        updated_at = ?,
        approval_history_json = ?
    WHERE id = ?
  `).run(
    input.newWalletAddress.trim(),
    input.newDestinationChain || existing.preferredDestinationChain,
    coolingOffUntil,
    input.newWalletAddress.trim(),
    nowIso,
    JSON.stringify(updatedHistory),
    existing.id
  );

  db.prepare(`
    INSERT INTO vendor_address_history (
      id, vendor_id, business_name, previous_address, new_address,
      changed_by, reason, cooling_off_until, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `HIST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    existing.id,
    existing.businessName,
    existing.verifiedWalletAddress,
    input.newWalletAddress.trim(),
    input.changedBy,
    input.reason,
    coolingOffUntil,
    nowIso
  );

  return getVendorByIdOrName(existing.id, null, db)!;
}

export function approveVendorRecord(
  vendorId: string,
  approvedBy: string,
  notes = 'Human verification completed',
  db: DatabaseSync = getDb()
): VendorRecord {
  const existing = getVendorByIdOrName(vendorId, null, db);
  if (!existing) {
    throw new Error(`Vendor ${vendorId} not found.`);
  }

  const nowIso = new Date().toISOString();
  const updatedHistory = [
    ...existing.approvalHistory,
    {
      action: 'HUMAN_VERIFICATION_CONFIRMED',
      approvedBy,
      timestamp: nowIso,
      notes,
    },
  ];

  db.prepare(`
    UPDATE vendors
    SET status = 'VERIFIED',
        cooling_off_until = NULL,
        pending_wallet_address = NULL,
        updated_at = ?,
        approval_history_json = ?
    WHERE id = ?
  `).run(nowIso, JSON.stringify(updatedHistory), existing.id);

  return getVendorByIdOrName(existing.id, null, db)!;
}
