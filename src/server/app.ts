import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import {
  getDb,
  getPolicyConfig,
  updatePolicyConfig,
  listVendors,
  listVendorAddressHistory,
  listBlocklist,
  listInvoices,
  getInvoiceById,
  listPayments,
  listSecurityEvents,
  logSecurityEvent,
} from './db.js';
import {
  processInvoiceThroughStewardPipeline,
} from '../pipeline/orchestrator.js';
import {
  approveHeldInvoice,
  rejectHeldInvoice,
} from '../pipeline/approvalService.js';
import {
  createNewVendorInRegistry,
  requestVendorAddressChange,
  approveVendorRecord,
} from '../pipeline/vendorRegistry.js';
import {
  fetchAndVerifyNearAiAttestation,
} from '../pipeline/attestationVerifier.js';
import {
  listAvailableNearAiModels,
} from '../pipeline/nearAiExtraction.js';
import {
  inspectNearAccountViaRpc,
} from '../pipeline/counterpartyRiskEngine.js';
import {
  requestOneClickExactOutputQuote,
  pollOneClickExecutionStatus,
} from '../pipeline/paymentExecutionService.js';
import {
  generateAccountantCsv,
} from '../pipeline/ledgerAndCsv.js';
import {
  FEATURED_RED_TEAM_SCENARIOS,
  EVALUATION_SUITE_30_CASES,
  runAttackEvaluationSuite,
} from '../evaluation/redTeamAndSuite.js';
import type { OperatingMode, SupportedChain } from '../shared/types.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB max PDF size, kept strictly in memory
});

export async function seedInitialDemoInvoicesIfEmpty(): Promise<void> {
  const db = getDb();
  const existing = listInvoices(undefined, db);
  if (existing.length > 0) return;

  const initialScenarioIds = [
    'RT-01-LEGIT-LAGOS',
    'EVAL-11-LEGIT-ARB',
    'EVAL-14-MIDTIER-HOLD',
    'RT-04-ADDRESS-CHANGE',
    'RT-08-HIDDEN-PROMPT-INJECTION',
  ];

  for (const id of initialScenarioIds) {
    const scenario = EVALUATION_SUITE_30_CASES.find((c) => c.id === id);
    if (scenario) {
      await processInvoiceThroughStewardPipeline({
        rawText: scenario.rawInvoiceText,
        structuredHint: scenario.structuredInvoice,
        mode: 'simulation',
        allowNetwork: false,
        db,
      });
    }
  }
}

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  // 1. System Overview & Dashboard Metrics (Computed 100% from real SQLite data)
  app.get('/api/overview', (_req, res) => {
    const db = getDb();
    const invoices = listInvoices(undefined, db);
    const payments = listPayments(undefined, db);
    const vendors = listVendors(db);
    const securityEvents = listSecurityEvents(db);
    const policy = getPolicyConfig(db);

    const paidInvoices = invoices.filter((i) => i.paymentStatus === 'PAID');
    const heldInvoices = invoices.filter((i) => i.paymentStatus === 'HELD');
    const blockedInvoices = invoices.filter((i) => i.paymentStatus === 'BLOCKED');

    const totalAmountPaidUsd = Number(
      paidInvoices.reduce((sum, i) => sum + i.total, 0).toFixed(2)
    );
    const totalAmountBlockedUsd = Number(
      blockedInvoices.reduce((sum, i) => sum + i.total, 0).toFixed(2)
    );
    const totalAmountHeldUsd = Number(
      heldInvoices.reduce((sum, i) => sum + i.total, 0).toFixed(2)
    );

    const legitimateEligibleCount = paidInvoices.length + invoices.filter((i) => i.paymentStatus === 'FAILED').length;
    const paymentSuccessRate =
      legitimateEligibleCount > 0
        ? Number(((paidInvoices.length / legitimateEligibleCount) * 100).toFixed(1))
        : 100;

    res.json({
      mode: (process.env.STEWARD_MODE as OperatingMode) || 'simulation',
      nearAiKeyConfigured: Boolean(process.env.NEAR_AI_API_KEY),
      nearAiModel: process.env.NEAR_AI_MODEL || 'Qwen/Qwen3.6-35B-A3B-FP8',
      custodyMode: process.env.TREASURY_CUSTODY_MODE || 'simulation',
      treasuryAccount: process.env.TREASURY_NEAR_ACCOUNT_ID || 'treasury.steward-ap.near',
      allowMainnetExecution: process.env.ALLOW_MAINNET_EXECUTION === 'true',
      metrics: {
        totalInvoicesProcessed: invoices.length,
        totalAmountPaidUsd,
        pendingApprovalsCount: heldInvoices.length,
        totalAmountHeldUsd,
        blockedSuspiciousCount: blockedInvoices.length,
        totalAmountBlockedUsd,
        paymentSuccessRate,
        verifiedVendorsCount: vendors.filter((v) => v.status === 'VERIFIED').length,
      },
      policy,
      recentInvoices: invoices.slice(0, 8),
      recentTransactions: payments.slice(0, 8),
      recentSecurityEvents: securityEvents.slice(0, 10),
    });
  });

  // 2. Invoices List & Detail
  app.get('/api/invoices', (req, res) => {
    const mode = typeof req.query.mode === 'string' ? req.query.mode : undefined;
    const invoices = listInvoices(mode, getDb());
    res.json({ invoices });
  });

  app.get('/api/invoices/:id', (req, res) => {
    const inv = getInvoiceById(req.params.id, getDb());
    if (!inv) {
      res.status(404).json({ error: 'Invoice not found' });
      return;
    }
    res.json({ invoice: inv });
  });

  // 3. Process Invoice (Text or Synthetic Scenario)
  app.post('/api/invoices/process', async (req, res) => {
    try {
      const { scenarioId, rawText, structuredHint, mode, allowNetwork } = req.body || {};

      let textToProcess = typeof rawText === 'string' ? rawText : '';
      let hintToUse = structuredHint;

      if (scenarioId) {
        const scenario = EVALUATION_SUITE_30_CASES.find((s) => s.id === scenarioId);
        if (!scenario) {
          res.status(400).json({ error: `Scenario ${scenarioId} not found.` });
          return;
        }
        textToProcess = scenario.rawInvoiceText;
        hintToUse = scenario.structuredInvoice;
      }

      if (!textToProcess && !hintToUse) {
        res.status(400).json({ error: 'Provide rawText, structuredHint, or scenarioId.' });
        return;
      }

      const record = await processInvoiceThroughStewardPipeline({
        rawText: textToProcess,
        structuredHint: hintToUse,
        mode: mode || ((process.env.STEWARD_MODE as OperatingMode) || 'simulation'),
        allowNetwork: allowNetwork ?? true,
      });

      res.json({ invoice: record });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 4. Process Uploaded PDF Invoice (Ephemeral Memory Only — Never Saved to Disk)
  app.post('/api/invoices/upload-pdf', upload.single('file'), async (req, res) => {
    try {
      if (!req.file || !req.file.buffer) {
        res.status(400).json({ error: 'No PDF file uploaded.' });
        return;
      }

      const fileBuffer = req.file.buffer;
      let extractedText = '';

      try {
        // Dynamically import pdf-parse to extract text in memory
        const pdfParseModule = await import('pdf-parse');
        const pdfParse = pdfParseModule.default || pdfParseModule;
        const parsedPdf = await pdfParse(fileBuffer);
        extractedText = parsedPdf.text || '';
      } catch {
        // Fallback if uploaded file is plain text with .pdf extension during testing
        extractedText = fileBuffer.toString('utf8');
      } finally {
        // Zero out the uploaded file buffer immediately
        fileBuffer.fill(0);
      }

      const record = await processInvoiceThroughStewardPipeline({
        rawText: extractedText,
        mode: (req.body?.mode as OperatingMode) || 'simulation',
        allowNetwork: true,
      });

      res.json({
        invoice: record,
        privacyGuarantee:
          'Uploaded PDF buffer was processed strictly in ephemeral RAM and zeroed immediately. Zero raw file or text persistence.',
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 5. Human Approval Queue Actions (APPROVE / REJECT)
  app.post('/api/invoices/:id/approve', async (req, res) => {
    try {
      const { approvedBy, notes } = req.body || {};
      const updated = await approveHeldInvoice({
        invoiceId: req.params.id,
        approvedBy: approvedBy || 'controller@steward-ap.finance',
        notes,
        allowNetwork: true,
      });
      res.json({ invoice: updated });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/invoices/:id/reject', (req, res) => {
    try {
      const { rejectedBy, reason } = req.body || {};
      const updated = rejectHeldInvoice({
        invoiceId: req.params.id,
        rejectedBy: rejectedBy || 'controller@steward-ap.finance',
        reason: reason || 'Rejected during manual AP review.',
      });
      res.json({ invoice: updated });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // 6. Vendor Registry & Immutable Address History
  app.get('/api/vendors', (_req, res) => {
    const db = getDb();
    res.json({
      vendors: listVendors(db),
      addressHistory: listVendorAddressHistory(undefined, db),
    });
  });

  app.post('/api/vendors', (req, res) => {
    try {
      const {
        businessName,
        walletAddress,
        preferredPayoutAsset,
        preferredDestinationChain,
        requestedBy,
        autoVerify,
      } = req.body || {};
      if (!businessName || !walletAddress) {
        res.status(400).json({ error: 'businessName and walletAddress are required.' });
        return;
      }
      const vendor = createNewVendorInRegistry({
        businessName,
        walletAddress,
        preferredPayoutAsset: preferredPayoutAsset || 'USDC',
        preferredDestinationChain: (preferredDestinationChain || 'near') as SupportedChain,
        requestedBy,
        autoVerify: Boolean(autoVerify),
      });
      res.json({ vendor });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/vendors/:id/change-address', (req, res) => {
    try {
      const { newWalletAddress, newDestinationChain, changedBy, reason } = req.body || {};
      if (!newWalletAddress) {
        res.status(400).json({ error: 'newWalletAddress is required.' });
        return;
      }
      const vendor = requestVendorAddressChange({
        vendorId: req.params.id,
        newWalletAddress,
        newDestinationChain,
        changedBy: changedBy || 'ap-clerk@steward-ap.finance',
        reason: reason || 'Vendor submitted updated remittance instructions',
      });
      res.json({ vendor });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/vendors/:id/verify', (req, res) => {
    try {
      const { approvedBy, notes } = req.body || {};
      const vendor = approveVendorRecord(
        req.params.id,
        approvedBy || 'controller@steward-ap.finance',
        notes
      );
      res.json({ vendor });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // 7. NEAR AI Cloud Live Attestation Verification & Tamper Test
  app.get('/api/attestation/models', async (_req, res) => {
    const modelsInfo = await listAvailableNearAiModels();
    res.json(modelsInfo);
  });

  app.post('/api/attestation/verify', async (req, res) => {
    const { modelId, tamperQuote, tamperNonce } = req.body || {};
    const result = await fetchAndVerifyNearAiAttestation(
      modelId || process.env.NEAR_AI_MODEL || 'Qwen/Qwen3.6-35B-A3B-FP8',
      {
        tamperQuote: Boolean(tamperQuote),
        tamperNonce: Boolean(tamperNonce),
      }
    );

    if (!result.verified) {
      logSecurityEvent({
        invoiceId: null,
        invoiceNumber: null,
        vendorName: null,
        severity: 'CRITICAL',
        category: 'ATTESTATION_FAILURE',
        title: `TEE Hardware Attestation Verification Rejected (${result.source})`,
        description: result.failedChecks.join(' | ') || 'Cryptographic TEE verification failed.',
        metadataJson: JSON.stringify({
          modelId: result.modelId,
          nonce: result.nonce,
          tamperQuote: Boolean(tamperQuote),
          tamperNonce: Boolean(tamperNonce),
        }),
      });
    }

    res.json({ attestation: result });
  });

  // 8. Counterparty Intelligence & Live NEAR RPC Account Inspection
  app.get('/api/security/events', (_req, res) => {
    const db = getDb();
    res.json({
      events: listSecurityEvents(db),
      blocklist: listBlocklist(db),
    });
  });

  app.post('/api/risk/inspect-near-account', async (req, res) => {
    const { accountId } = req.body || {};
    if (!accountId || typeof accountId !== 'string') {
      res.status(400).json({ error: 'accountId is required' });
      return;
    }
    const intel = await inspectNearAccountViaRpc(accountId.trim(), { allowNetwork: true });
    res.json({ intelligence: intel });
  });

  // 9. NEAR Intents 1Click Quotes & Transaction Status Polling
  app.get('/api/payments', (req, res) => {
    const mode = typeof req.query.mode === 'string' ? req.query.mode : undefined;
    res.json({ payments: listPayments(mode, getDb()) });
  });

  app.post('/api/payments/quote-preview', async (req, res) => {
    try {
      const { destinationChain, payoutAsset, amountUsd, recipientAddress } = req.body || {};
      const quote = await requestOneClickExactOutputQuote({
        destinationChain: (destinationChain || 'near') as SupportedChain,
        payoutAsset: payoutAsset || 'USDC',
        exactOutputUsd: Number(amountUsd || 100),
        recipientAddress: recipientAddress || 'vitalik.near',
        refundAddress: process.env.TREASURY_NEAR_ACCOUNT_ID || 'system.near',
        dry: true,
        allowNetwork: true,
      });
      res.json({ quote });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get('/api/payments/status/:depositAddress', async (req, res) => {
    try {
      const status = await pollOneClickExecutionStatus(req.params.depositAddress);
      res.json({ status });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // 10. Red Team Scenarios & 30-Invoice Attack Evaluation Suite
  app.get('/api/red-team/scenarios', (_req, res) => {
    res.json({
      featuredScenarios: FEATURED_RED_TEAM_SCENARIOS,
      totalEvaluationSuiteCount: EVALUATION_SUITE_30_CASES.length,
    });
  });

  app.post('/api/red-team/run-evaluation-suite', async (_req, res) => {
    try {
      const report = await runAttackEvaluationSuite();
      res.json({ report });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 11. Policy Configuration & Kill-Switch Management
  app.get('/api/policy', (_req, res) => {
    res.json({ policy: getPolicyConfig(getDb()) });
  });

  app.post('/api/policy', (req, res) => {
    const db = getDb();
    const before = getPolicyConfig(db);
    const updated = updatePolicyConfig(req.body || {}, db);

    if (before.kill_switch !== updated.kill_switch) {
      logSecurityEvent(
        {
          invoiceId: null,
          invoiceNumber: null,
          vendorName: null,
          severity: updated.kill_switch ? 'CRITICAL' : 'INFO',
          category: 'KILL_SWITCH',
          title: updated.kill_switch
            ? 'Emergency Treasury Kill Switch ACTIVATED'
            : 'Emergency Treasury Kill Switch Deactivated',
          description: updated.kill_switch
            ? 'All automated and manual payment executions have been locked server-side.'
            : 'Normal deterministic policy evaluation resumed.',
          metadataJson: JSON.stringify({ kill_switch: updated.kill_switch }),
        },
        db
      );
    }

    res.json({ policy: updated });
  });

  // 12. Accountant-Ready Audit Ledger & Formula-Safe CSV Export
  app.get('/api/ledger/csv', (req, res) => {
    const mode = typeof req.query.mode === 'string' ? req.query.mode : undefined;
    const invoices = listInvoices(mode, getDb());
    const csvContent = generateAccountantCsv(invoices, getDb());
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="steward-audit-ledger-${new Date().toISOString().slice(0, 10)}.csv"`
    );
    res.send(csvContent);
  });

  // Serve built React frontend in production
  const clientDistPath = path.resolve(process.cwd(), 'dist', 'client');
  if (fs.existsSync(clientDistPath)) {
    app.use(express.static(clientDistPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        next();
        return;
      }
      res.sendFile(path.join(clientDistPath, 'index.html'));
    });
  }

  return app;
}
