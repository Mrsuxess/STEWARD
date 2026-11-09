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
  TreasurySettings,
  ConnectedWalletRecord,
  PaymentLifecycleStatus,
  TreasuryWalletType,
  WorkspaceProfile,
  WorkspaceMemberRecord,
  WorkspaceRole,
  ExperienceMode,
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
      field_corrections_json TEXT NOT NULL DEFAULT '[]',
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
      lifecycle_status TEXT,
      quote_id TEXT,
      correlation_id TEXT,
      deposit_address TEXT,
      source_asset TEXT NOT NULL,
      source_asset_id TEXT,
      destination_asset TEXT NOT NULL,
      destination_asset_id TEXT,
      source_chain TEXT NOT NULL,
      destination_chain TEXT NOT NULL,
      source_wallet_address TEXT,
      source_wallet_type TEXT,
      exact_requested_output TEXT NOT NULL,
      exact_requested_output_raw TEXT NOT NULL,
      estimated_input_amount TEXT NOT NULL,
      estimated_input_raw TEXT,
      min_input_amount_raw TEXT,
      actual_received_amount TEXT,
      fees_usd REAL NOT NULL DEFAULT 0,
      slippage_bps INTEGER DEFAULT 100,
      time_estimate_seconds INTEGER,
      quote_expires_at TEXT,
      is_dry_quote INTEGER DEFAULT 0,
      is_simulated_quote INTEGER DEFAULT 0,
      is_simulated_transaction INTEGER DEFAULT 0,
      refund_address TEXT NOT NULL,
      recipient_address TEXT NOT NULL,
      tx_hash TEXT,
      destination_tx_hash TEXT,
      explorer_url TEXT,
      destination_explorer_url TEXT,
      quote_signature TEXT,
      status_source TEXT NOT NULL,
      refund_reason TEXT,
      error_message TEXT,
      prepared_transaction_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS treasury_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      settings_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS treasury_wallets (
      id TEXT PRIMARY KEY,
      wallet_type TEXT NOT NULL,
      wallet_id TEXT NOT NULL,
      wallet_name TEXT NOT NULL,
      address TEXT NOT NULL,
      network TEXT NOT NULL,
      chain TEXT NOT NULL,
      chain_id_hex TEXT,
      is_simulated INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      native_balance_json TEXT,
      token_balances_json TEXT NOT NULL,
      capabilities_json TEXT NOT NULL,
      unsupported_capabilities_json TEXT NOT NULL,
      last_refreshed_at TEXT NOT NULL,
      connected_at TEXT NOT NULL
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

    CREATE TABLE IF NOT EXISTS workspace_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      company_name TEXT NOT NULL,
      business_email TEXT NOT NULL,
      country TEXT NOT NULL,
      business_type TEXT NOT NULL,
      reporting_currency TEXT NOT NULL,
      experience_mode TEXT NOT NULL,
      onboarding_completed INTEGER NOT NULL DEFAULT 0,
      onboarding_step INTEGER NOT NULL DEFAULT 1,
      checklist_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspace_members (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      invited_at TEXT NOT NULL
    );
  `);

  try {
    db.exec('ALTER TABLE vendors ADD COLUMN contact_email TEXT;');
  } catch {
    // Column already exists
  }

  try {
    db.exec("ALTER TABLE invoices ADD COLUMN field_corrections_json TEXT NOT NULL DEFAULT '[]';");
  } catch {
    // Column already exists
  }

  // Safe non-destructive schema migration for existing SQLite files
  const paymentColumns = [
    ['lifecycle_status', 'TEXT'],
    ['source_asset_id', 'TEXT'],
    ['destination_asset_id', 'TEXT'],
    ['source_wallet_address', 'TEXT'],
    ['source_wallet_type', 'TEXT'],
    ['estimated_input_raw', 'TEXT'],
    ['min_input_amount_raw', 'TEXT'],
    ['slippage_bps', 'INTEGER DEFAULT 100'],
    ['time_estimate_seconds', 'INTEGER'],
    ['quote_expires_at', 'TEXT'],
    ['is_dry_quote', 'INTEGER DEFAULT 0'],
    ['is_simulated_quote', 'INTEGER DEFAULT 0'],
    ['is_simulated_transaction', 'INTEGER DEFAULT 0'],
    ['destination_tx_hash', 'TEXT'],
    ['destination_explorer_url', 'TEXT'],
    ['refund_reason', 'TEXT'],
    ['prepared_transaction_json', 'TEXT'],
  ];
  for (const [col, colType] of paymentColumns) {
    try {
      db.exec(`ALTER TABLE payments ADD COLUMN ${col} ${colType};`);
    } catch {
      // Column already exists
    }
  }
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

  const workspaceRow = db.prepare('SELECT id FROM workspace_profile WHERE id = 1').get();
  if (!workspaceRow) {
    const now = new Date().toISOString();
    const defaultChecklist = {
      businessProfileCompleted: true,
      treasuryConnected: false,
      paymentPoliciesConfigured: true,
      firstVendorAdded: true,
      firstInvoiceUploaded: true,
    };
    db.prepare(`
      INSERT INTO workspace_profile (
        id, company_name, business_email, country, business_type,
        reporting_currency, experience_mode, onboarding_completed,
        onboarding_step, checklist_json, created_at, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'Steward Global Operations Ltd.',
      'finance@steward-ap.finance',
      'United Kingdom',
      'Cross-Border SaaS & Digital Services',
      'USD',
      'simulated',
      0,
      1,
      JSON.stringify(defaultChecklist),
      now,
      now
    );
  }

  const memberCountRow = db.prepare('SELECT COUNT(*) as cnt FROM workspace_members').get() as { cnt: number };
  if (memberCountRow.cnt === 0) {
    const now = new Date().toISOString();
    const initialMembers: WorkspaceMemberRecord[] = [
      {
        id: 'MEM-OWNER-01',
        fullName: 'Elena Rostova',
        email: 'controller@steward-ap.finance',
        role: 'Owner',
        status: 'ACTIVE',
        invitedAt: now,
      },
      {
        id: 'MEM-ADMIN-02',
        fullName: 'Marcus Vance',
        email: 'admin@steward-ap.finance',
        role: 'Finance Administrator',
        status: 'ACTIVE',
        invitedAt: now,
      },
      {
        id: 'MEM-APPROVER-03',
        fullName: 'Amara Okafor',
        email: 'approver@steward-ap.finance',
        role: 'Approver',
        status: 'ACTIVE',
        invitedAt: now,
      },
      {
        id: 'MEM-AUDITOR-04',
        fullName: 'Henrik Lindqvist',
        email: 'auditor@steward-ap.finance',
        role: 'Auditor',
        status: 'ACTIVE',
        invitedAt: now,
      },
    ];
    const insertMem = db.prepare(`
      INSERT INTO workspace_members (id, full_name, email, role, status, invited_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const m of initialMembers) {
      insertMem.run(m.id, m.fullName, m.email.toLowerCase(), m.role, m.status, m.invitedAt);
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
    contactEmail: row.contact_email ? String(row.contact_email) : null,
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

export function recordFieldCorrection(
  invoiceId: string,
  correction: import('../shared/types.js').FieldCorrectionEntry,
  db = getDb()
): ProcessedInvoiceRecord {
  const inv = getInvoiceById(invoiceId, db);
  if (!inv) throw new Error(`Invoice ${invoiceId} not found`);
  const list = inv.fieldCorrections || [];
  list.push(correction);
  inv.fieldCorrections = list;
  inv.updatedAt = new Date().toISOString();
  saveProcessedInvoice(inv, db);
  return inv;
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
      raw_text_deleted, processing_time_ms, field_corrections_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    JSON.stringify(record.fieldCorrections || []),
    record.createdAt,
    record.updatedAt
  );
}

export function savePaymentExecution(payment: PaymentExecutionRecord, db = getDb()): void {
  db.prepare(`
    INSERT OR REPLACE INTO payments (
      id, invoice_id, idempotency_key, mode, custody_mode, status, lifecycle_status,
      quote_id, correlation_id, deposit_address, source_asset, source_asset_id,
      destination_asset, destination_asset_id, source_chain, destination_chain,
      source_wallet_address, source_wallet_type, exact_requested_output, exact_requested_output_raw,
      estimated_input_amount, estimated_input_raw, min_input_amount_raw, actual_received_amount,
      fees_usd, slippage_bps, time_estimate_seconds, quote_expires_at, is_dry_quote,
      is_simulated_quote, is_simulated_transaction, refund_address, recipient_address,
      tx_hash, destination_tx_hash, explorer_url, destination_explorer_url, quote_signature,
      status_source, refund_reason, error_message, prepared_transaction_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    payment.id,
    payment.invoiceId,
    payment.idempotencyKey,
    payment.mode,
    payment.custodyMode,
    payment.status,
    payment.lifecycleStatus || mapStatusToLifecycle(payment.status),
    payment.quoteId,
    payment.correlationId,
    payment.depositAddress,
    payment.sourceAsset,
    payment.sourceAssetId ?? null,
    payment.destinationAsset,
    payment.destinationAssetId ?? null,
    payment.sourceChain,
    payment.destinationChain,
    payment.sourceWalletAddress ?? null,
    payment.sourceWalletType ?? null,
    payment.exactRequestedOutput,
    payment.exactRequestedOutputRaw,
    payment.estimatedInputAmount,
    payment.estimatedInputRaw ?? null,
    payment.minInputAmountRaw ?? null,
    payment.actualReceivedAmount,
    payment.feesUsd,
    payment.slippageBps ?? 100,
    payment.timeEstimateSeconds ?? null,
    payment.quoteExpiresAt ?? null,
    payment.isDryQuote ? 1 : 0,
    payment.isSimulatedQuote ? 1 : 0,
    payment.isSimulatedTransaction ? 1 : 0,
    payment.refundAddress,
    payment.recipientAddress,
    payment.txHash,
    payment.destinationTxHash ?? null,
    payment.explorerUrl,
    payment.destinationExplorerUrl ?? null,
    payment.quoteSignature,
    payment.statusSource,
    payment.refundReason ?? null,
    payment.errorMessage,
    payment.preparedTransaction ? JSON.stringify(payment.preparedTransaction) : null,
    payment.createdAt,
    payment.updatedAt
  );
}

function mapStatusToLifecycle(status: PaymentExecutionRecord['status']): PaymentLifecycleStatus {
  switch (status) {
    case 'PAID':
    case 'COMPLETED':
      return 'COMPLETED';
    case 'HELD':
    case 'AWAITING_APPROVAL':
      return 'AWAITING_APPROVAL';
    case 'APPROVED':
      return 'APPROVED';
    case 'AWAITING_WALLET_SIGNATURE':
      return 'AWAITING_WALLET_SIGNATURE';
    case 'DEPOSIT_SUBMITTED':
      return 'DEPOSIT_SUBMITTED';
    case 'DEPOSIT_CONFIRMED':
      return 'DEPOSIT_CONFIRMED';
    case 'PENDING':
    case 'PROCESSING':
      return 'PROCESSING';
    case 'REFUNDED':
      return 'REFUNDED';
    case 'EXPIRED':
      return 'EXPIRED';
    case 'BLOCKED':
    case 'FAILED':
      return 'FAILED';
    default:
      return 'DRAFT';
  }
}

export function getPaymentById(paymentId: string, db = getDb()): PaymentExecutionRecord | null {
  const row = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return mapPaymentRow(row);
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
  const status = String(row.status) as PaymentExecutionRecord['status'];
  return {
    id: String(row.id),
    invoiceId: String(row.invoice_id),
    idempotencyKey: String(row.idempotency_key),
    mode: String(row.mode) as PaymentExecutionRecord['mode'],
    custodyMode: String(row.custody_mode) as PaymentExecutionRecord['custodyMode'],
    status,
    lifecycleStatus: row.lifecycle_status
      ? (String(row.lifecycle_status) as PaymentLifecycleStatus)
      : mapStatusToLifecycle(status),
    quoteId: row.quote_id ? String(row.quote_id) : null,
    correlationId: row.correlation_id ? String(row.correlation_id) : null,
    depositAddress: row.deposit_address ? String(row.deposit_address) : null,
    sourceAsset: String(row.source_asset),
    sourceAssetId: row.source_asset_id ? String(row.source_asset_id) : null,
    destinationAsset: String(row.destination_asset),
    destinationAssetId: row.destination_asset_id ? String(row.destination_asset_id) : null,
    sourceChain: String(row.source_chain) as SupportedChain,
    destinationChain: String(row.destination_chain) as SupportedChain,
    sourceWalletAddress: row.source_wallet_address ? String(row.source_wallet_address) : null,
    sourceWalletType: row.source_wallet_type
      ? (String(row.source_wallet_type) as TreasuryWalletType)
      : null,
    exactRequestedOutput: String(row.exact_requested_output),
    exactRequestedOutputRaw: String(row.exact_requested_output_raw),
    estimatedInputAmount: String(row.estimated_input_amount),
    estimatedInputRaw: row.estimated_input_raw ? String(row.estimated_input_raw) : null,
    minInputAmountRaw: row.min_input_amount_raw ? String(row.min_input_amount_raw) : null,
    actualReceivedAmount: row.actual_received_amount ? String(row.actual_received_amount) : null,
    feesUsd: Number(row.fees_usd || 0),
    slippageBps: row.slippage_bps !== undefined && row.slippage_bps !== null ? Number(row.slippage_bps) : 100,
    timeEstimateSeconds:
      row.time_estimate_seconds !== undefined && row.time_estimate_seconds !== null
        ? Number(row.time_estimate_seconds)
        : null,
    quoteExpiresAt: row.quote_expires_at ? String(row.quote_expires_at) : null,
    isDryQuote: Boolean(row.is_dry_quote),
    isSimulatedQuote: Boolean(row.is_simulated_quote),
    isSimulatedTransaction: Boolean(row.is_simulated_transaction),
    refundAddress: String(row.refund_address),
    recipientAddress: String(row.recipient_address),
    txHash: row.tx_hash ? String(row.tx_hash) : null,
    destinationTxHash: row.destination_tx_hash ? String(row.destination_tx_hash) : null,
    explorerUrl: row.explorer_url ? String(row.explorer_url) : null,
    destinationExplorerUrl: row.destination_explorer_url ? String(row.destination_explorer_url) : null,
    quoteSignature: row.quote_signature ? String(row.quote_signature) : null,
    statusSource: String(row.status_source),
    refundReason: row.refund_reason ? String(row.refund_reason) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    preparedTransaction: row.prepared_transaction_json
      ? JSON.parse(String(row.prepared_transaction_json))
      : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function getDefaultTreasurySettings(): TreasurySettings {
  return {
    preferredFundingWalletType: 'near',
    preferredFundingWalletAddress: null,
    preferredSourceAsset: 'USDC',
    preferredSourceChain: 'near',
    allowedSourceNetworks: ['near', 'ethereum', 'base', 'arbitrum'],
    approvedDestinationAssets: ['USDC', 'USDT', 'NEAR', 'ETH'],
    approvedDestinationNetworks: ['near', 'arbitrum', 'base', 'ethereum', 'solana', 'bitcoin'],
    requireExplicitWalletConfirmation: true,
    executionMode: 'non_custodial_wallet',
    updatedAt: new Date().toISOString(),
  };
}

export function getTreasurySettings(db = getDb()): TreasurySettings {
  const row = db.prepare('SELECT settings_json FROM treasury_settings WHERE id = 1').get() as
    | { settings_json: string }
    | undefined;
  if (!row) {
    const defaults = getDefaultTreasurySettings();
    db.prepare(
      'INSERT OR REPLACE INTO treasury_settings (id, settings_json, updated_at) VALUES (1, ?, ?)'
    ).run(JSON.stringify(defaults), defaults.updatedAt);
    return defaults;
  }
  try {
    return {
      ...getDefaultTreasurySettings(),
      ...JSON.parse(row.settings_json),
    };
  } catch {
    return getDefaultTreasurySettings();
  }
}

export function updateTreasurySettings(
  partial: Partial<TreasurySettings>,
  db = getDb()
): TreasurySettings {
  const current = getTreasurySettings(db);
  const now = new Date().toISOString();
  const next: TreasurySettings = {
    ...current,
    ...partial,
    updatedAt: now,
  };
  db.prepare(
    'INSERT OR REPLACE INTO treasury_settings (id, settings_json, updated_at) VALUES (1, ?, ?)'
  ).run(JSON.stringify(next), now);
  return next;
}

export function listTreasuryWallets(db = getDb()): ConnectedWalletRecord[] {
  const rows = db
    .prepare('SELECT * FROM treasury_wallets ORDER BY connected_at DESC')
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    walletType: String(r.wallet_type) as TreasuryWalletType,
    walletId: String(r.wallet_id),
    walletName: String(r.wallet_name),
    address: String(r.address),
    network: String(r.network),
    chain: String(r.chain) as SupportedChain,
    chainIdHex: r.chain_id_hex ? String(r.chain_id_hex) : null,
    isSimulated: Boolean(r.is_simulated),
    status: String(r.status) as ConnectedWalletRecord['status'],
    nativeBalance: r.native_balance_json ? JSON.parse(String(r.native_balance_json)) : null,
    tokenBalances: JSON.parse(String(r.token_balances_json || '[]')),
    capabilities: JSON.parse(String(r.capabilities_json || '{}')),
    unsupportedCapabilities: JSON.parse(String(r.unsupported_capabilities_json || '[]')),
    lastRefreshedAt: String(r.last_refreshed_at),
    connectedAt: String(r.connected_at),
  }));
}

export function saveTreasuryWallet(wallet: ConnectedWalletRecord, db = getDb()): ConnectedWalletRecord {
  db.prepare(`
    INSERT OR REPLACE INTO treasury_wallets (
      id, wallet_type, wallet_id, wallet_name, address, network, chain, chain_id_hex,
      is_simulated, status, native_balance_json, token_balances_json,
      capabilities_json, unsupported_capabilities_json, last_refreshed_at, connected_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    wallet.id,
    wallet.walletType,
    wallet.walletId,
    wallet.walletName,
    wallet.address,
    wallet.network,
    wallet.chain,
    wallet.chainIdHex ?? null,
    wallet.isSimulated ? 1 : 0,
    wallet.status,
    wallet.nativeBalance ? JSON.stringify(wallet.nativeBalance) : null,
    JSON.stringify(wallet.tokenBalances || []),
    JSON.stringify(wallet.capabilities || {}),
    JSON.stringify(wallet.unsupportedCapabilities || []),
    wallet.lastRefreshedAt,
    wallet.connectedAt
  );
  return wallet;
}

export function removeTreasuryWallet(idOrAddress: string, db = getDb()): void {
  db.prepare('DELETE FROM treasury_wallets WHERE id = ? OR LOWER(address) = LOWER(?)').run(
    idOrAddress,
    idOrAddress
  );
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
    fieldCorrections: row.field_corrections_json
      ? JSON.parse(String(row.field_corrections_json))
      : [],
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

export function getWorkspaceProfile(db = getDb()): WorkspaceProfile {
  const row = db.prepare('SELECT * FROM workspace_profile WHERE id = 1').get() as
    | Record<string, unknown>
    | undefined;

  const wallets = listTreasuryWallets(db);
  const vendors = listVendors(db);
  const invoices = listInvoices(undefined, db);

  if (!row) {
    const now = new Date().toISOString();
    return {
      companyName: 'Steward Global Operations Ltd.',
      businessEmail: 'finance@steward-ap.finance',
      country: 'United Kingdom',
      businessType: 'Cross-Border SaaS & Digital Services',
      reportingCurrency: 'USD',
      experienceMode: 'simulated',
      onboardingCompleted: false,
      onboardingStep: 1,
      checklistState: {
        businessProfileCompleted: true,
        treasuryConnected: wallets.length > 0,
        paymentPoliciesConfigured: true,
        firstVendorAdded: vendors.length > 0,
        firstInvoiceUploaded: invoices.length > 0,
      },
      createdAt: now,
      updatedAt: now,
    };
  }

  let storedChecklist = {
    businessProfileCompleted: Boolean(row.company_name),
    treasuryConnected: false,
    paymentPoliciesConfigured: true,
    firstVendorAdded: false,
    firstInvoiceUploaded: false,
  };
  try {
    storedChecklist = {
      ...storedChecklist,
      ...JSON.parse(String(row.checklist_json || '{}')),
    };
  } catch {
    // Use defaults
  }

  return {
    companyName: String(row.company_name),
    businessEmail: String(row.business_email),
    country: String(row.country),
    businessType: String(row.business_type),
    reportingCurrency: String(row.reporting_currency) as WorkspaceProfile['reportingCurrency'],
    experienceMode: String(row.experience_mode) as ExperienceMode,
    onboardingCompleted: Boolean(row.onboarding_completed),
    onboardingStep: Number(row.onboarding_step || 1),
    checklistState: {
      businessProfileCompleted:
        storedChecklist.businessProfileCompleted || Boolean(String(row.company_name).trim()),
      treasuryConnected: storedChecklist.treasuryConnected || wallets.length > 0,
      paymentPoliciesConfigured: storedChecklist.paymentPoliciesConfigured,
      firstVendorAdded: storedChecklist.firstVendorAdded || vendors.length > 0,
      firstInvoiceUploaded: storedChecklist.firstInvoiceUploaded || invoices.length > 0,
    },
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function updateWorkspaceProfile(
  patch: Partial<WorkspaceProfile>,
  db = getDb()
): WorkspaceProfile {
  const current = getWorkspaceProfile(db);
  const now = new Date().toISOString();
  const nextChecklist = {
    ...current.checklistState,
    ...(patch.checklistState || {}),
  };
  const next: WorkspaceProfile = {
    ...current,
    ...patch,
    checklistState: nextChecklist,
    updatedAt: now,
  };

  db.prepare(`
    INSERT OR REPLACE INTO workspace_profile (
      id, company_name, business_email, country, business_type,
      reporting_currency, experience_mode, onboarding_completed,
      onboarding_step, checklist_json, created_at, updated_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    next.companyName.trim(),
    next.businessEmail.trim(),
    next.country.trim(),
    next.businessType.trim(),
    next.reportingCurrency,
    next.experienceMode,
    next.onboardingCompleted ? 1 : 0,
    next.onboardingStep,
    JSON.stringify(next.checklistState),
    next.createdAt,
    next.updatedAt
  );

  return getWorkspaceProfile(db);
}

export function listWorkspaceMembers(db = getDb()): WorkspaceMemberRecord[] {
  const rows = db
    .prepare('SELECT * FROM workspace_members ORDER BY invited_at ASC')
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    fullName: String(r.full_name),
    email: String(r.email),
    role: String(r.role) as WorkspaceRole,
    status: String(r.status) as WorkspaceMemberRecord['status'],
    invitedAt: String(r.invited_at),
  }));
}

export function addWorkspaceMember(
  input: {
    fullName: string;
    email: string;
    role: WorkspaceRole;
    status?: 'ACTIVE' | 'INVITED';
  },
  db = getDb()
): WorkspaceMemberRecord {
  const now = new Date().toISOString();
  const cleanEmail = input.email.trim().toLowerCase();
  const existing = db
    .prepare('SELECT * FROM workspace_members WHERE LOWER(email) = ?')
    .get(cleanEmail) as Record<string, unknown> | undefined;

  const id = existing ? String(existing.id) : `MEM-${Date.now().toString(36).toUpperCase()}`;
  const status = input.status || 'ACTIVE';

  db.prepare(`
    INSERT OR REPLACE INTO workspace_members (id, full_name, email, role, status, invited_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, input.fullName.trim(), cleanEmail, input.role, status, now);

  return {
    id,
    fullName: input.fullName.trim(),
    email: cleanEmail,
    role: input.role,
    status,
    invitedAt: now,
  };
}

export function removeWorkspaceMember(memberId: string, db = getDb()): void {
  db.prepare('DELETE FROM workspace_members WHERE id = ?').run(memberId);
}

export function seedSimulatedDemoTreasury(db = getDb()): ConnectedWalletRecord[] {
  const now = new Date().toISOString();
  const demoNearWallet: ConnectedWalletRecord = {
    id: 'WLT-SIM-NEAR-DEMO',
    walletType: 'simulated',
    walletId: 'simulated-near-treasury',
    walletName: 'Simulated NEAR Corporate Treasury (DEMO)',
    address: 'demo-treasury.steward.near',
    network: 'NEAR Mainnet (SIMULATED DEMO)',
    chain: 'near',
    chainIdHex: null,
    isSimulated: true,
    status: 'connected',
    nativeBalance: {
      symbol: 'NEAR',
      name: 'NEAR Protocol (SIMULATED)',
      assetId: 'near:native',
      contractAddress: null,
      decimals: 24,
      rawBalance: '1450000000000000000000000000',
      formattedBalance: '1,450.0000',
      priceUsd: 4.2,
      priceUpdatedAt: now,
      valueUsd: 6090.0,
      isNative: true,
    },
    tokenBalances: [
      {
        symbol: 'USDC',
        name: 'USD Coin on NEAR (SIMULATED)',
        contractAddress: '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
        assetId: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
        decimals: 6,
        rawBalance: '48500000000',
        formattedBalance: '48,500.00',
        priceUsd: 1.0,
        priceUpdatedAt: now,
        valueUsd: 48500.0,
        isNative: false,
      },
      {
        symbol: 'USDT',
        name: 'Tether USD on NEAR (SIMULATED)',
        contractAddress: 'usdt.tether-token.near',
        assetId: 'nep141:usdt.tether-token.near',
        decimals: 6,
        rawBalance: '15250000000',
        formattedBalance: '15,250.00',
        priceUsd: 1.0,
        priceUpdatedAt: now,
        valueUsd: 15250.0,
        isNative: false,
      },
    ],
    capabilities: {
      signAndSendTransaction: true,
      signAndSendTransactions: true,
      switchNetwork: false,
      autoReconnect: true,
    },
    unsupportedCapabilities: [
      'SIMULATED DEMO WALLET — Never broadcasts transactions to real blockchains or 1Click mainnet deposit endpoints.',
    ],
    lastRefreshedAt: now,
    connectedAt: now,
  };

  const demoEvmWallet: ConnectedWalletRecord = {
    id: 'WLT-SIM-EVM-DEMO',
    walletType: 'simulated',
    walletId: 'simulated-evm-treasury',
    walletName: 'Simulated EVM Treasury Vault (DEMO)',
    address: '0x71C000000000000000000000000000000000089A',
    network: 'Base Mainnet (SIMULATED DEMO)',
    chain: 'base',
    chainIdHex: '0x2105',
    isSimulated: true,
    status: 'connected',
    nativeBalance: {
      symbol: 'ETH',
      name: 'Ether on Base (SIMULATED)',
      assetId: 'base:native',
      contractAddress: null,
      decimals: 18,
      rawBalance: '4250000000000000000',
      formattedBalance: '4.2500',
      priceUsd: 2700.0,
      priceUpdatedAt: now,
      valueUsd: 11475.0,
      isNative: true,
    },
    tokenBalances: [
      {
        symbol: 'USDC',
        name: 'USD Coin on Base (SIMULATED)',
        contractAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        assetId: '1cs_v1:base:erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
        decimals: 6,
        rawBalance: '32000000000',
        formattedBalance: '32,000.00',
        priceUsd: 1.0,
        priceUpdatedAt: now,
        valueUsd: 32000.0,
        isNative: false,
      },
    ],
    capabilities: {
      signAndSendTransaction: true,
      signAndSendTransactions: false,
      switchNetwork: true,
      autoReconnect: true,
    },
    unsupportedCapabilities: [
      'SIMULATED DEMO WALLET — Never broadcasts transactions to real blockchains or 1Click mainnet deposit endpoints.',
    ],
    lastRefreshedAt: now,
    connectedAt: now,
  };

  saveTreasuryWallet(demoNearWallet, db);
  saveTreasuryWallet(demoEvmWallet, db);
  updateTreasurySettings(
    {
      executionMode: 'simulation',
      preferredFundingWalletAddress: demoNearWallet.address,
      preferredSourceChain: 'near',
      preferredSourceAsset: 'USDC',
    },
    db
  );
  updateWorkspaceProfile(
    {
      experienceMode: 'simulated',
      checklistState: {
        ...getWorkspaceProfile(db).checklistState,
        treasuryConnected: true,
      },
    },
    db
  );

  return listTreasuryWallets(db);
}
