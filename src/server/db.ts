import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type {
  PolicyConfig,
  VendorRecord,
  VendorAddressHistoryEntry,
  ProcessedInvoiceRecord,
  PaymentExecutionRecord,
  SecurityEventRecord,
  SupportedChain,
} from '../shared/types.js';

let dbInstance: DatabaseSync | null = null;

export function getDb(customPath?: string): DatabaseSync {
  if (dbInstance && !customPath) {
    return dbInstance;
  }

  const resolvedPath =
    customPath ||
    process.env.STEWARD_DB_PATH ||
    path.resolve(process.cwd(), 'data', 'steward.db');

  if (resolvedPath !== ':memory:') {
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(resolvedPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  initSchema(db);
  seedDefaultsIfEmpty(db);

  if (!customPath) {
    dbInstance = db;
  }
  return db;
}

export function resetDbForTesting(customPath = ':memory:'): DatabaseSync {
  dbInstance = null;
  const db = getDb(customPath);
  dbInstance = db;
  return db;
}

function initSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS policy_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      config_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vendors (
      id TEXT PRIMARY KEY,
      business_name TEXT NOT NULL UNIQUE,
      verified_wallet_address TEXT NOT NULL,
      preferred_payout_asset TEXT NOT NULL,
      preferred_destination_chain TEXT NOT NULL,
      status TEXT NOT NULL,
      cooling_off_until TEXT,
      pending_wallet_address TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      approval_history_json TEXT NOT NULL,
      payment_count INTEGER NOT NULL DEFAULT 0,
      total_paid_usd REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS vendor_address_history (
      id TEXT PRIMARY KEY,
      vendor_id TEXT NOT NULL,
      business_name TEXT NOT NULL,
      previous_address TEXT,
      new_address TEXT NOT NULL,
      changed_by TEXT NOT NULL,
      reason TEXT NOT NULL,
      cooling_off_until TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS blocklist (
      address TEXT PRIMARY KEY,
      chain TEXT NOT NULL,
      reason TEXT NOT NULL,
      source TEXT NOT NULL,
      added_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      invoice_number TEXT NOT NULL,
      vendor_id TEXT,
      vendor_name TEXT NOT NULL,
      invoice_date TEXT NOT NULL,
      due_date TEXT NOT NULL,
      subtotal REAL NOT NULL,
      tax REAL NOT NULL,
      total REAL NOT NULL,
      currency TEXT NOT NULL,
      requested_payout_asset TEXT NOT NULL,
      requested_destination_chain TEXT NOT NULL,
      receiving_wallet_address TEXT NOT NULL,
      payment_reference TEXT NOT NULL,
      line_items_json TEXT NOT NULL,
      extraction_method TEXT NOT NULL,
      extraction_model TEXT NOT NULL,
      attestation_json TEXT NOT NULL,
      validation_json TEXT NOT NULL,
      vendor_check_json TEXT NOT NULL,
      risk_assessment_json TEXT NOT NULL,
      policy_evaluation_json TEXT NOT NULL,
      final_decision TEXT NOT NULL,
      payment_status TEXT NOT NULL,
      decision_reason_summary TEXT NOT NULL,
      approved_by TEXT,
      approved_at TEXT,
      rejection_reason TEXT,
      raw_text_deleted INTEGER NOT NULL DEFAULT 1,
      processing_time_ms INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL UNIQUE,
      idempotency_key TEXT NOT NULL UNIQUE,
      mode TEXT NOT NULL,
      custody_mode TEXT NOT NULL,
      status TEXT NOT NULL,
      quote_id TEXT,
      correlation_id TEXT,
      deposit_address TEXT,
      source_asset TEXT NOT NULL,
      destination_asset TEXT NOT NULL,
      source_chain TEXT NOT NULL,
      destination_chain TEXT NOT NULL,
      exact_requested_output TEXT NOT NULL,
      exact_requested_output_raw TEXT NOT NULL,
      estimated_input_amount TEXT NOT NULL,
      actual_received_amount TEXT,
      fees_usd REAL NOT NULL DEFAULT 0,
      refund_address TEXT NOT NULL,
      recipient_address TEXT NOT NULL,
      tx_hash TEXT,
      explorer_url TEXT,
      quote_signature TEXT,
      status_source TEXT NOT NULL,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS security_events (
      id TEXT PRIMARY KEY,
      invoice_id TEXT,
      invoice_number TEXT,
      vendor_name TEXT,
      severity TEXT NOT NULL,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

export function loadDefaultPolicyFromYaml(): PolicyConfig {
  try {
    const yamlPath = path.resolve(process.cwd(), 'config', 'policy.yaml');
    if (fs.existsSync(yamlPath)) {
      const parsed = YAML.parse(fs.readFileSync(yamlPath, 'utf8'));
      return {
        per_invoice_cap_usd: Number(parsed.per_invoice_cap_usd ?? 500),
        daily_cap_usd: Number(parsed.daily_cap_usd ?? 1500),
        auto_approve_below_usd: Number(parsed.auto_approve_below_usd ?? 200),
        allowed_payout_assets: Array.isArray(parsed.allowed_payout_assets)
          ? parsed.allowed_payout_assets
          : ['USDC'],
        new_vendor: parsed.new_vendor === 'block' ? 'block' : 'require_human',
        address_change: {
          cooling_off_hours: Number(parsed.address_change?.cooling_off_hours ?? 48),
          require_human: Boolean(parsed.address_change?.require_human ?? true),
        },
        kill_switch: Boolean(parsed.kill_switch ?? false),
      };
    }
  } catch {
    // Fallback to specification defaults
  }
  return {
    per_invoice_cap_usd: 500,
    daily_cap_usd: 1500,
    auto_approve_below_usd: 200,
    allowed_payout_assets: ['USDC'],
    new_vendor: 'require_human',
    address_change: {
      cooling_off_hours: 48,
      require_human: true,
    },
    kill_switch: false,
  };
}

function seedDefaultsIfEmpty(db: DatabaseSync): void {
  const policyRow = db.prepare('SELECT id FROM policy_config WHERE id = 1').get();
  if (!policyRow) {
    const defaultPolicy = loadDefaultPolicyFromYaml();
    db.prepare(
      'INSERT INTO policy_config (id, config_json, updated_at) VALUES (1, ?, ?)'
    ).run(JSON.stringify(defaultPolicy), new Date().toISOString());
  }

  const vendorCountRow = db.prepare('SELECT COUNT(*) as cnt FROM vendors').get() as { cnt: number };
  if (vendorCountRow.cnt === 0) {
    const now = new Date().toISOString();
    const pastDate = '2026-09-15T10:00:00.000Z';
    const coolingOffFuture = new Date(Date.now() + 36 * 3600 * 1000).toISOString();

    const initialVendors: VendorRecord[] = [
      {
        id: 'VND-LAGOS-01',
        businessName: 'Lagos Design Studio Ltd',
        verifiedWalletAddress: 'lagos-studio.near',
        preferredPayoutAsset: 'USDC',
        preferredDestinationChain: 'near',
        status: 'VERIFIED',
        coolingOffUntil: null,
        pendingWalletAddress: null,
        createdAt: pastDate,
        updatedAt: pastDate,
        approvalHistory: [
          {
            action: 'INITIAL_ONBOARDING_VERIFIED',
            approvedBy: 'controller@steward-ap.finance',
            timestamp: pastDate,
            notes: 'Verified W-8BEN-E and NEAR account ownership via signed challenge.',
          },
        ],
        paymentCount: 4,
        totalPaidUsd: 680.0,
      },
      {
        id: 'VND-ARB-02',
        businessName: 'Apex Cloud Infrastructure Inc',
        verifiedWalletAddress: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
        preferredPayoutAsset: 'USDC',
        preferredDestinationChain: 'arbitrum',
        status: 'VERIFIED',
        coolingOffUntil: null,
        pendingWalletAddress: null,
        createdAt: pastDate,
        updatedAt: pastDate,
        approvalHistory: [
          {
            action: 'INITIAL_ONBOARDING_VERIFIED',
            approvedBy: 'controller@steward-ap.finance',
            timestamp: pastDate,
            notes: 'Verified corporate treasury address on Arbitrum One.',
          },
        ],
        paymentCount: 7,
        totalPaidUsd: 1240.0,
      },
      {
        id: 'VND-SOL-03',
        businessName: 'Solana Rust Auditors Collective',
        verifiedWalletAddress: '13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK',
        preferredPayoutAsset: 'USDC',
        preferredDestinationChain: 'solana',
        status: 'VERIFIED',
        coolingOffUntil: null,
        pendingWalletAddress: null,
        createdAt: pastDate,
        updatedAt: pastDate,
        approvalHistory: [
          {
            action: 'INITIAL_ONBOARDING_VERIFIED',
            approvedBy: 'cfo@steward-ap.finance',
            timestamp: pastDate,
            notes: 'Verified Solana multisig vault for security retainer.',
          },
        ],
        paymentCount: 2,
        totalPaidUsd: 380.0,
      },
      {
        id: 'VND-NEAR-04',
        businessName: 'Nordic Node Operations AB',
        verifiedWalletAddress: 'nordic-nodes.near',
        preferredPayoutAsset: 'USDC',
        preferredDestinationChain: 'near',
        status: 'VERIFIED',
        coolingOffUntil: null,
        pendingWalletAddress: null,
        createdAt: pastDate,
        updatedAt: pastDate,
        approvalHistory: [
          {
            action: 'INITIAL_ONBOARDING_VERIFIED',
            approvedBy: 'controller@steward-ap.finance',
            timestamp: pastDate,
            notes: 'Verified NEAR RPC infrastructure vendor.',
          },
        ],
        paymentCount: 5,
        totalPaidUsd: 890.0,
      },
      {
        id: 'VND-COOL-05',
        businessName: 'Kinetic Marketing Partners',
        verifiedWalletAddress: 'kinetic-agency-v2.near',
        preferredPayoutAsset: 'USDC',
        preferredDestinationChain: 'near',
        status: 'COOLING_OFF',
        coolingOffUntil: coolingOffFuture,
        pendingWalletAddress: 'kinetic-agency-v2.near',
        createdAt: pastDate,
        updatedAt: now,
        approvalHistory: [
          {
            action: 'INITIAL_ONBOARDING_VERIFIED',
            approvedBy: 'controller@steward-ap.finance',
            timestamp: pastDate,
            notes: 'Onboarded with kinetic-agency.near.',
          },
          {
            action: 'ADDRESS_CHANGE_REQUESTED',
            approvedBy: 'ap-clerk@steward-ap.finance',
            timestamp: now,
            notes: '48h mandatory cooling-off period triggered for wallet rotation to kinetic-agency-v2.near.',
          },
        ],
        paymentCount: 3,
        totalPaidUsd: 450.0,
      },
    ];

    const insertVendor = db.prepare(`
      INSERT INTO vendors (
        id, business_name, verified_wallet_address, preferred_payout_asset,
        preferred_destination_chain, status, cooling_off_until, pending_wallet_address,
        created_at, updated_at, approval_history_json, payment_count, total_paid_usd
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertHistory = db.prepare(`
      INSERT INTO vendor_address_history (
        id, vendor_id, business_name, previous_address, new_address,
        changed_by, reason, cooling_off_until, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const v of initialVendors) {
      insertVendor.run(
        v.id,
        v.businessName,
        v.verifiedWalletAddress,
        v.preferredPayoutAsset,
        v.preferredDestinationChain,
        v.status,
        v.coolingOffUntil,
        v.pendingWalletAddress,
        v.createdAt,
        v.updatedAt,
        JSON.stringify(v.approvalHistory),
        v.paymentCount,
        v.totalPaidUsd
      );

      insertHistory.run(
        `HIST-${v.id}-INIT`,
        v.id,
        v.businessName,
        null,
        v.id === 'VND-COOL-05' ? 'kinetic-agency.near' : v.verifiedWalletAddress,
        'controller@steward-ap.finance',
        'Initial verified vendor registration',
        v.createdAt,
        v.createdAt
      );
    }

    insertHistory.run(
      'HIST-VND-COOL-05-ROTATE',
      'VND-COOL-05',
      'Kinetic Marketing Partners',
      'kinetic-agency.near',
      'kinetic-agency-v2.near',
      'ap-clerk@steward-ap.finance',
      'Vendor requested treasury wallet rotation; 48h cooling-off enforced',
      coolingOffFuture,
      now
    );
  }

  const blocklistCount = db.prepare('SELECT COUNT(*) as cnt FROM blocklist').get() as { cnt: number };
  if (blocklistCount.cnt === 0) {
    const now = new Date().toISOString();
    const blocklisted = [
      {
        address: 'attacker-drain.near',
        chain: 'near',
        reason: 'Confirmed BEC prompt-injection drainer wallet reported by NEAR Security Alliance.',
        source: 'NEAR Threat Intelligence Feed',
      },
      {
        address: 'phishing-vault.near',
        chain: 'near',
        reason: 'Fake vendor impersonation cluster targeting Web3 AP departments.',
        source: 'Internal Fraud Operations',
      },
      {
        address: '0xdeadbeef00000000000000000000000000badec0',
        chain: 'arbitrum',
        reason: 'OFAC / Sanctioned exploit consolidator address.',
        source: 'Chainalysis / Shared Blocklist',
      },
      {
        address: 'scam-collector.near',
        chain: 'near',
        reason: 'Flagged for invoice redirection attacks.',
        source: 'Shared AP Defense Blocklist',
      },
      {
        address: 'BadActor11111111111111111111111111111111111',
        chain: 'solana',
        reason: 'Known Solana drainer address.',
        source: 'Shared AP Defense Blocklist',
      },
    ];
    const insertBlock = db.prepare(
      'INSERT INTO blocklist (address, chain, reason, source, added_at) VALUES (?, ?, ?, ?, ?)'
    );
    for (const item of blocklisted) {
      insertBlock.run(item.address.toLowerCase(), item.chain, item.reason, item.source, now);
    }
  }
}

export function getPolicyConfig(db = getDb()): PolicyConfig {
  const row = db.prepare('SELECT config_json FROM policy_config WHERE id = 1').get() as
    | { config_json: string }
    | undefined;
  if (!row) {
    return loadDefaultPolicyFromYaml();
  }
  return JSON.parse(row.config_json) as PolicyConfig;
}

export function updatePolicyConfig(patch: Partial<PolicyConfig>, db = getDb()): PolicyConfig {
  const current = getPolicyConfig(db);
  const updated: PolicyConfig = {
    ...current,
    ...patch,
    address_change: {
      ...current.address_change,
      ...(patch.address_change || {}),
    },
  };
  db.prepare('UPDATE policy_config SET config_json = ?, updated_at = ? WHERE id = 1').run(
    JSON.stringify(updated),
    new Date().toISOString()
  );
  return updated;
}

export function listVendors(db = getDb()): VendorRecord[] {
  const rows = db.prepare('SELECT * FROM vendors ORDER BY business_name ASC').all() as Array<Record<string, unknown>>;
  return rows.map(mapVendorRow);
}

export function getVendorByIdOrName(
  vendorId?: string | null,
  vendorName?: string | null,
  db = getDb()
): VendorRecord | null {
  if (vendorId) {
    const byId = db.prepare('SELECT * FROM vendors WHERE LOWER(id) = LOWER(?)').get(vendorId.trim()) as
      | Record<string, unknown>
      | undefined;
    if (byId) return mapVendorRow(byId);
  }
  if (vendorName) {
    const byName = db
      .prepare('SELECT * FROM vendors WHERE LOWER(business_name) = LOWER(?)')
      .get(vendorName.trim()) as Record<string, unknown> | undefined;
    if (byName) return mapVendorRow(byName);
  }
  return null;
}

function mapVendorRow(row: Record<string, unknown>): VendorRecord {
  return {
    id: String(row.id),
    businessName: String(row.business_name),
    verifiedWalletAddress: String(row.verified_wallet_address),
    preferredPayoutAsset: String(row.preferred_payout_asset),
    preferredDestinationChain: String(row.preferred_destination_chain) as SupportedChain,
    status: String(row.status) as VendorRecord['status'],
    coolingOffUntil: row.cooling_off_until ? String(row.cooling_off_until) : null,
    pendingWalletAddress: row.pending_wallet_address ? String(row.pending_wallet_address) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    approvalHistory: JSON.parse(String(row.approval_history_json || '[]')),
    paymentCount: Number(row.payment_count || 0),
    totalPaidUsd: Number(row.total_paid_usd || 0),
  };
}

export function listVendorAddressHistory(vendorId?: string, db = getDb()): VendorAddressHistoryEntry[] {
  const rows = (
    vendorId
      ? db
          .prepare('SELECT * FROM vendor_address_history WHERE vendor_id = ? ORDER BY timestamp DESC')
          .all(vendorId)
      : db.prepare('SELECT * FROM vendor_address_history ORDER BY timestamp DESC').all()
  ) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    vendorId: String(r.vendor_id),
    businessName: String(r.business_name),
    previousAddress: r.previous_address ? String(r.previous_address) : null,
    newAddress: String(r.new_address),
    changedBy: String(r.changed_by),
    reason: String(r.reason),
    coolingOffUntil: String(r.cooling_off_until),
    timestamp: String(r.timestamp),
  }));
}

export function isAddressBlocklisted(
  address: string,
  db = getDb()
): { blocked: boolean; reason?: string; source?: string } {
  const normalized = address.trim().toLowerCase();
  const row = db
    .prepare('SELECT * FROM blocklist WHERE LOWER(address) = ?')
    .get(normalized) as Record<string, unknown> | undefined;
  if (!row) return { blocked: false };
  return {
    blocked: true,
    reason: String(row.reason),
    source: String(row.source),
  };
}

export function listBlocklist(db = getDb()): Array<{
  address: string;
  chain: string;
  reason: string;
  source: string;
  addedAt: string;
}> {
  const rows = db.prepare('SELECT * FROM blocklist ORDER BY added_at DESC').all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    address: String(r.address),
    chain: String(r.chain),
    reason: String(r.reason),
    source: String(r.source),
    addedAt: String(r.added_at),
  }));
}

export function saveProcessedInvoice(record: ProcessedInvoiceRecord, db = getDb()): void {
  db.prepare(`
    INSERT OR REPLACE INTO invoices (
      id, mode, invoice_number, vendor_id, vendor_name, invoice_date, due_date,
      subtotal, tax, total, currency, requested_payout_asset, requested_destination_chain,
      receiving_wallet_address, payment_reference, line_items_json, extraction_method,
      extraction_model, attestation_json, validation_json, vendor_check_json,
      risk_assessment_json, policy_evaluation_json, final_decision, payment_status,
      decision_reason_summary, approved_by, approved_at, rejection_reason,
      raw_text_deleted, processing_time_ms, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.mode,
    record.invoiceNumber,
    record.vendorId,
    record.vendorName,
    record.invoiceDate,
    record.dueDate,
    record.subtotal,
    record.tax,
    record.total,
    record.currency,
    record.requestedPayoutAsset,
    record.requestedDestinationChain,
    record.receivingWalletAddress,
    record.paymentReference,
    JSON.stringify(record.lineItems),
    record.extractionMethod,
    record.extractionModel,
    JSON.stringify(record.attestation),
    JSON.stringify(record.validation),
    JSON.stringify(record.vendorCheck),
    JSON.stringify(record.riskAssessment),
    JSON.stringify(record.policyEvaluation),
    record.finalDecision,
    record.paymentStatus,
    record.decisionReasonSummary,
    record.approvedBy,
    record.approvedAt,
    record.rejectionReason,
    record.rawTextDeleted ? 1 : 0,
    record.processingTimeMs,
    record.createdAt,
    record.updatedAt
  );
}

export function savePaymentExecution(payment: PaymentExecutionRecord, db = getDb()): void {
  db.prepare(`
    INSERT OR REPLACE INTO payments (
      id, invoice_id, idempotency_key, mode, custody_mode, status,
      quote_id, correlation_id, deposit_address, source_asset, destination_asset,
      source_chain, destination_chain, exact_requested_output, exact_requested_output_raw,
      estimated_input_amount, actual_received_amount, fees_usd, refund_address,
      recipient_address, tx_hash, explorer_url, quote_signature, status_source,
      error_message, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    payment.id,
    payment.invoiceId,
    payment.idempotencyKey,
    payment.mode,
    payment.custodyMode,
    payment.status,
    payment.quoteId,
    payment.correlationId,
    payment.depositAddress,
    payment.sourceAsset,
    payment.destinationAsset,
    payment.sourceChain,
    payment.destinationChain,
    payment.exactRequestedOutput,
    payment.exactRequestedOutputRaw,
    payment.estimatedInputAmount,
    payment.actualReceivedAmount,
    payment.feesUsd,
    payment.refundAddress,
    payment.recipientAddress,
    payment.txHash,
    payment.explorerUrl,
    payment.quoteSignature,
    payment.statusSource,
    payment.errorMessage,
    payment.createdAt,
    payment.updatedAt
  );
}

export function getPaymentByInvoiceId(invoiceId: string, db = getDb()): PaymentExecutionRecord | null {
  const row = db.prepare('SELECT * FROM payments WHERE invoice_id = ?').get(invoiceId) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return mapPaymentRow(row);
}

export function listPayments(mode?: string, db = getDb()): PaymentExecutionRecord[] {
  const rows = (
    mode
      ? db.prepare('SELECT * FROM payments WHERE mode = ? ORDER BY created_at DESC').all(mode)
      : db.prepare('SELECT * FROM payments ORDER BY created_at DESC').all()
  ) as Array<Record<string, unknown>>;
  return rows.map(mapPaymentRow);
}

function mapPaymentRow(row: Record<string, unknown>): PaymentExecutionRecord {
  return {
    id: String(row.id),
    invoiceId: String(row.invoice_id),
    idempotencyKey: String(row.idempotency_key),
    mode: String(row.mode) as PaymentExecutionRecord['mode'],
    custodyMode: String(row.custody_mode) as PaymentExecutionRecord['custodyMode'],
    status: String(row.status) as PaymentExecutionRecord['status'],
    quoteId: row.quote_id ? String(row.quote_id) : null,
    correlationId: row.correlation_id ? String(row.correlation_id) : null,
    depositAddress: row.deposit_address ? String(row.deposit_address) : null,
    sourceAsset: String(row.source_asset),
    destinationAsset: String(row.destination_asset),
    sourceChain: String(row.source_chain) as SupportedChain,
    destinationChain: String(row.destination_chain) as SupportedChain,
    exactRequestedOutput: String(row.exact_requested_output),
    exactRequestedOutputRaw: String(row.exact_requested_output_raw),
    estimatedInputAmount: String(row.estimated_input_amount),
    actualReceivedAmount: row.actual_received_amount ? String(row.actual_received_amount) : null,
    feesUsd: Number(row.fees_usd || 0),
    refundAddress: String(row.refund_address),
    recipientAddress: String(row.recipient_address),
    txHash: row.tx_hash ? String(row.tx_hash) : null,
    explorerUrl: row.explorer_url ? String(row.explorer_url) : null,
    quoteSignature: row.quote_signature ? String(row.quote_signature) : null,
    statusSource: String(row.status_source),
    errorMessage: row.error_message ? String(row.error_message) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function getInvoiceById(id: string, db = getDb()): ProcessedInvoiceRecord | null {
  const row = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return mapInvoiceRow(row, db);
}

export function listInvoices(mode?: string, db = getDb()): ProcessedInvoiceRecord[] {
  const rows = (
    mode
      ? db.prepare('SELECT * FROM invoices WHERE mode = ? ORDER BY created_at DESC').all(mode)
      : db.prepare('SELECT * FROM invoices ORDER BY created_at DESC').all()
  ) as Array<Record<string, unknown>>;
  return rows.map((r) => mapInvoiceRow(r, db));
}

function mapInvoiceRow(row: Record<string, unknown>, db: DatabaseSync): ProcessedInvoiceRecord {
  const id = String(row.id);
  const payment = getPaymentByInvoiceId(id, db);
  return {
    id,
    mode: String(row.mode) as ProcessedInvoiceRecord['mode'],
    invoiceNumber: String(row.invoice_number),
    vendorId: row.vendor_id ? String(row.vendor_id) : null,
    vendorName: String(row.vendor_name),
    invoiceDate: String(row.invoice_date),
    dueDate: String(row.due_date),
    subtotal: Number(row.subtotal),
    tax: Number(row.tax),
    total: Number(row.total),
    currency: String(row.currency),
    requestedPayoutAsset: String(row.requested_payout_asset),
    requestedDestinationChain: String(row.requested_destination_chain) as SupportedChain,
    receivingWalletAddress: String(row.receiving_wallet_address),
    paymentReference: String(row.payment_reference),
    lineItems: JSON.parse(String(row.line_items_json || '[]')),
    extractionMethod: String(row.extraction_method) as ProcessedInvoiceRecord['extractionMethod'],
    extractionModel: String(row.extraction_model),
    attestation: JSON.parse(String(row.attestation_json)),
    validation: JSON.parse(String(row.validation_json)),
    vendorCheck: JSON.parse(String(row.vendor_check_json)),
    riskAssessment: JSON.parse(String(row.risk_assessment_json)),
    policyEvaluation: JSON.parse(String(row.policy_evaluation_json)),
    finalDecision: String(row.final_decision) as ProcessedInvoiceRecord['finalDecision'],
    paymentStatus: String(row.payment_status) as ProcessedInvoiceRecord['paymentStatus'],
    decisionReasonSummary: String(row.decision_reason_summary),
    approvedBy: row.approved_by ? String(row.approved_by) : null,
    approvedAt: row.approved_at ? String(row.approved_at) : null,
    rejectionReason: row.rejection_reason ? String(row.rejection_reason) : null,
    paymentExecution: payment,
    rawTextDeleted: Boolean(row.raw_text_deleted),
    processingTimeMs: Number(row.processing_time_ms || 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function logSecurityEvent(
  event: Omit<SecurityEventRecord, 'id' | 'createdAt'>,
  db = getDb()
): SecurityEventRecord {
  const fullEvent: SecurityEventRecord = {
    ...event,
    id: `SEC-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    createdAt: new Date().toISOString(),
  };
  db.prepare(`
    INSERT INTO security_events (
      id, invoice_id, invoice_number, vendor_name, severity,
      category, title, description, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    fullEvent.id,
    fullEvent.invoiceId,
    fullEvent.invoiceNumber,
    fullEvent.vendorName,
    fullEvent.severity,
    fullEvent.category,
    fullEvent.title,
    fullEvent.description,
    fullEvent.metadataJson,
    fullEvent.createdAt
  );
  return fullEvent;
}

export function listSecurityEvents(db = getDb()): SecurityEventRecord[] {
  const rows = db
    .prepare('SELECT * FROM security_events ORDER BY created_at DESC LIMIT 200')
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    invoiceId: r.invoice_id ? String(r.invoice_id) : null,
    invoiceNumber: r.invoice_number ? String(r.invoice_number) : null,
    vendorName: r.vendor_name ? String(r.vendor_name) : null,
    severity: String(r.severity) as SecurityEventRecord['severity'],
    category: String(r.category) as SecurityEventRecord['category'],
    title: String(r.title),
    description: String(r.description),
    metadataJson: String(r.metadata_json),
    createdAt: String(r.created_at),
  }));
}
