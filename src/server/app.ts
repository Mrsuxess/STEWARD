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
  getVendorByIdOrName,
  listVendorAddressHistory,
  listBlocklist,
  listInvoices,
  getInvoiceById,
  listPayments,
  getPaymentById,
  listSecurityEvents,
  logSecurityEvent,
  getTreasurySettings,
  updateTreasurySettings,
  listTreasuryWallets,
  saveTreasuryWallet,
  removeTreasuryWallet,
  getWorkspaceProfile,
  updateWorkspaceProfile,
  listWorkspaceMembers,
  addWorkspaceMember,
  removeWorkspaceMember,
  seedSimulatedDemoTreasury,
  saveProcessedInvoice,
} from './db.js';
import {
  processInvoiceThroughStewardPipeline,
} from '../pipeline/orchestrator.js';
import { extractInvoiceFromPdfLayout } from '../pipeline/pdfLayoutExtractor.js';
import { validateExtractedInvoice } from '../pipeline/schemaValidator.js';
import { evaluateVendorRegistry } from '../pipeline/vendorRegistry.js';
import { assessCounterpartyRisk } from '../pipeline/counterpartyRiskEngine.js';
import { evaluatePaymentPolicy } from '../pipeline/policyEngine.js';
import type { ExtractedInvoice, FieldCorrectionEntry } from '../shared/types.js';
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
  validateDestinationAddressFormat,
} from '../pipeline/counterpartyRiskEngine.js';
import {
  requestOneClickExactOutputQuote,
  pollOneClickExecutionStatus,
  fetchOneClickSupportedTokens,
  prepareNonCustodialPayment,
  commitQuoteAndPrepareTransaction,
  submitSignedDepositTransaction,
  pollAndSyncPaymentLifecycle,
  fetchNearAccountBalances,
  fetchEvmAccountBalances,
} from '../pipeline/paymentExecutionService.js';
import {
  generateAccountantCsv,
} from '../pipeline/ledgerAndCsv.js';
import {
  FEATURED_RED_TEAM_SCENARIOS,
  EVALUATION_SUITE_30_CASES,
  runAttackEvaluationSuite,
} from '../evaluation/redTeamAndSuite.js';
import type {
  ConnectedWalletRecord,
  ExperienceMode,
  OperatingMode,
  SupportedChain,
  TreasuryWalletType,
  WorkspaceRole,
} from '../shared/types.js';

const SUPPORTED_CHAINS: SupportedChain[] = [
  'near',
  'arbitrum',
  'solana',
  'ethereum',
  'base',
  'bitcoin',
];

const VALID_WORKSPACE_ROLES: WorkspaceRole[] = [
  'Owner',
  'Finance Administrator',
  'Approver',
  'Auditor',
];

/**
 * Resolves the caller's role from explicit headers (`x-steward-role` or `x-steward-email`),
 * request body (`actorRole` or `actorEmail`), or defaults to 'Owner' for legacy automated calls.
 * Enforces server-side RBAC and logs an ACCESS_CONTROL security event on 403 rejection.
 */
function verifyRolePermission(
  req: express.Request,
  res: express.Response,
  allowedRoles: WorkspaceRole[],
  actionLabel: string
): boolean {
  const db = getDb();
  const expHeader = String(req.headers['x-steward-experience-mode'] || '').toLowerCase();
  if (expHeader === 'explore') {
    res.status(403).json({
      error: `Explore Mode is read-only. Connect a treasury wallet or launch the Simulated Demo Treasury to perform "${actionLabel}".`,
    });
    return false;
  }

  const headerRole = req.headers['x-steward-role'];
  const bodyRole = req.body?.actorRole;
  const headerEmail = req.headers['x-steward-email'];
  const bodyEmail = req.body?.actorEmail;

  let resolvedRole: WorkspaceRole = 'Owner';
  const rawRole =
    typeof headerRole === 'string' && headerRole.trim()
      ? headerRole.trim()
      : typeof bodyRole === 'string' && bodyRole.trim()
      ? bodyRole.trim()
      : null;

  if (rawRole) {
    if (!VALID_WORKSPACE_ROLES.includes(rawRole as WorkspaceRole)) {
      res.status(403).json({
        error: `Forbidden: Unrecognized workspace role "${rawRole}". Valid roles: ${VALID_WORKSPACE_ROLES.join(', ')}.`,
      });
      return false;
    }
    resolvedRole = rawRole as WorkspaceRole;
  } else {
    const emailLookup =
      typeof headerEmail === 'string' && headerEmail.trim()
        ? headerEmail.trim().toLowerCase()
        : typeof bodyEmail === 'string' && bodyEmail.trim()
        ? bodyEmail.trim().toLowerCase()
        : null;
    if (emailLookup) {
      const members = listWorkspaceMembers(db);
      const found = members.find((m) => m.email.toLowerCase() === emailLookup);
      if (found) {
        resolvedRole = found.role;
      }
    }
  }

  if (!allowedRoles.includes(resolvedRole)) {
    logSecurityEvent(
      {
        invoiceId: null,
        invoiceNumber: null,
        vendorName: null,
        severity: 'WARNING',
        category: 'ACCESS_CONTROL',
        title: `Unauthorized Role Action Blocked (${resolvedRole})`,
        description: `Role "${resolvedRole}" attempted restricted action "${actionLabel}". Required role: ${allowedRoles.join(' or ')}.`,
        metadataJson: JSON.stringify({
          attemptedRole: resolvedRole,
          allowedRoles,
          actionLabel,
          path: req.path,
        }),
      },
      db
    );
    res.status(403).json({
      error: `Forbidden: Role "${resolvedRole}" is not authorized to perform "${actionLabel}". Required role: ${allowedRoles.join(' or ')}.`,
    });
    return false;
  }

  return true;
}

function hasRecognizableInvoiceContent(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 10) return false;
  const hasKeyword =
    /(?:vendor|supplier|bill\s+from|from|invoice|inv[#\-\s:]|total|amount\s+due|subtotal|wallet|pay\s+to|recipient|\$)/i.test(
      trimmed
    );
  const hasAmount = /(?:\$?\d+(?:,\d{3})*(?:\.\d{1,2})?)/.test(trimmed);
  return hasKeyword && hasAmount;
}

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
    const workspace = getWorkspaceProfile(db);
    const members = listWorkspaceMembers(db);

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
      workspace,
      members,
      recentInvoices: invoices.slice(0, 8),
      recentTransactions: payments.slice(0, 8),
      recentSecurityEvents: securityEvents.slice(0, 10),
    });
  });

  // 1b. Business Workspace Profile, Onboarding State & Team Role Management
  app.get('/api/workspace', (_req, res) => {
    const db = getDb();
    res.json({
      workspace: getWorkspaceProfile(db),
      members: listWorkspaceMembers(db),
    });
  });

  app.post('/api/workspace', (req, res) => {
    if (
      !verifyRolePermission(
        req,
        res,
        ['Owner', 'Finance Administrator'],
        'Update Business Workspace Profile'
      )
    ) {
      return;
    }

    try {
      const db = getDb();
      const body = req.body || {};
      const patch: Record<string, unknown> = {};

      if (body.companyName !== undefined) {
        if (typeof body.companyName !== 'string' || !body.companyName.trim()) {
          res.status(400).json({ error: 'companyName must be a non-empty string.' });
          return;
        }
        patch.companyName = body.companyName.trim();
      }

      if (body.businessEmail !== undefined) {
        if (typeof body.businessEmail !== 'string' || !body.businessEmail.includes('@')) {
          res.status(400).json({ error: 'businessEmail must be a valid email address.' });
          return;
        }
        patch.businessEmail = body.businessEmail.trim();
      }

      if (body.country !== undefined) {
        if (typeof body.country !== 'string' || !body.country.trim()) {
          res.status(400).json({ error: 'country must be a non-empty string.' });
          return;
        }
        patch.country = body.country.trim();
      }

      if (body.businessType !== undefined) {
        if (typeof body.businessType !== 'string' || !body.businessType.trim()) {
          res.status(400).json({ error: 'businessType must be a non-empty string.' });
          return;
        }
        patch.businessType = body.businessType.trim();
      }

      if (body.reportingCurrency !== undefined) {
        if (!['USD', 'EUR', 'GBP', 'CAD', 'SGD', 'NGN'].includes(body.reportingCurrency)) {
          res.status(400).json({
            error: 'reportingCurrency must be one of USD, EUR, GBP, CAD, SGD, or NGN.',
          });
          return;
        }
        patch.reportingCurrency = body.reportingCurrency;
      }

      if (body.experienceMode !== undefined) {
        if (!['real', 'simulated', 'explore'].includes(body.experienceMode)) {
          res.status(400).json({
            error: 'experienceMode must be "real", "simulated", or "explore".',
          });
          return;
        }
        patch.experienceMode = body.experienceMode as ExperienceMode;
      }

      if (body.onboardingCompleted !== undefined) {
        patch.onboardingCompleted = Boolean(body.onboardingCompleted);
      }

      if (body.onboardingStep !== undefined) {
        const step = Number(body.onboardingStep);
        if (Number.isFinite(step) && step >= 1 && step <= 6) {
          patch.onboardingStep = step;
        }
      }

      if (body.checklistState && typeof body.checklistState === 'object') {
        patch.checklistState = body.checklistState;
      }

      const workspace = updateWorkspaceProfile(patch, db);
      res.json({ workspace, members: listWorkspaceMembers(db) });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/workspace/members', (req, res) => {
    if (
      !verifyRolePermission(
        req,
        res,
        ['Owner', 'Finance Administrator'],
        'Invite or Update Team Member'
      )
    ) {
      return;
    }

    try {
      const db = getDb();
      const { fullName, email, role } = req.body || {};
      if (!fullName || typeof fullName !== 'string' || !fullName.trim()) {
        res.status(400).json({ error: 'fullName is required.' });
        return;
      }
      if (!email || typeof email !== 'string' || !email.includes('@')) {
        res.status(400).json({ error: 'A valid email address is required.' });
        return;
      }
      if (!role || !VALID_WORKSPACE_ROLES.includes(role as WorkspaceRole)) {
        res.status(400).json({
          error: `Invalid role "${role}". Valid roles: ${VALID_WORKSPACE_ROLES.join(', ')}.`,
        });
        return;
      }

      const member = addWorkspaceMember(
        {
          fullName: fullName.trim(),
          email: email.trim(),
          role: role as WorkspaceRole,
          status: 'ACTIVE',
        },
        db
      );

      logSecurityEvent(
        {
          invoiceId: null,
          invoiceNumber: null,
          vendorName: null,
          severity: 'INFO',
          category: 'WORKSPACE_ONBOARDING',
          title: `Team Member Assigned Role: ${member.role}`,
          description: `${member.fullName} (${member.email}) assigned role "${member.role}".`,
          metadataJson: JSON.stringify(member),
        },
        db
      );

      res.json({ member, members: listWorkspaceMembers(db) });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.delete('/api/workspace/members/:id', (req, res) => {
    if (
      !verifyRolePermission(
        req,
        res,
        ['Owner', 'Finance Administrator'],
        'Remove Team Member'
      )
    ) {
      return;
    }
    try {
      const db = getDb();
      removeWorkspaceMember(req.params.id, db);
      res.json({ removed: true, members: listWorkspaceMembers(db) });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
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
    if (
      !verifyRolePermission(
        req,
        res,
        ['Owner', 'Finance Administrator', 'Approver'],
        'Submit & Process Invoice'
      )
    ) {
      return;
    }
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

      if (textToProcess.length > 500_000) {
        res.status(413).json({ error: 'Invoice text payload exceeds 500 KB maximum size limit.' });
        return;
      }

      if (!hintToUse && !hasRecognizableInvoiceContent(textToProcess)) {
        res.status(400).json({
          error:
            'Could not extract valid invoice fields from the provided text. Please include vendor name, invoice number, and total amount.',
        });
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
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // 4. Process Uploaded PDF Invoice (Ephemeral Memory Only — Never Saved to Disk)
  app.post('/api/invoices/upload-pdf', upload.single('file'), async (req, res) => {
    if (
      !verifyRolePermission(
        req,
        res,
        ['Owner', 'Finance Administrator', 'Approver'],
        'Upload PDF Invoice'
      )
    ) {
      return;
    }
    try {
      if (!req.file || !req.file.buffer) {
        res.status(400).json({ error: 'No PDF or TXT file uploaded.' });
        return;
      }

      const fileBuffer = req.file.buffer;
      const originalName = (req.file.originalname || '').toLowerCase();
      const mimeType = (req.file.mimetype || '').toLowerCase();
      let extractedText = '';
      let structuredPdfHint: Partial<ExtractedInvoice> | undefined = undefined;

      try {
        if (fileBuffer.length === 0) {
          res.status(400).json({ error: 'Uploaded file is empty (0 bytes).' });
          return;
        }

        const isPdfExt = originalName.endsWith('.pdf') || mimeType === 'application/pdf';
        const isTxtExt = originalName.endsWith('.txt') || mimeType === 'text/plain';

        if (!isPdfExt && !isTxtExt) {
          res.status(400).json({
            error:
              'Unsupported file format. Only PDF (.pdf) and plain text (.txt) invoices up to 8 MB are allowed.',
          });
          return;
        }

        const headerAscii = fileBuffer.subarray(0, 5).toString('ascii');
        if (headerAscii === '%PDF-') {
          try {
            const layoutResult = await extractInvoiceFromPdfLayout(fileBuffer);
            extractedText = layoutResult.cleanText;
            structuredPdfHint = layoutResult.structuredHint;
            if (!extractedText) {
              const pdfParseModule = await import('pdf-parse');
              const pdfParse = pdfParseModule.default || pdfParseModule;
              const parsedPdf = await pdfParse(fileBuffer);
              extractedText = parsedPdf.text || '';
            }
          } catch {
            res.status(400).json({
              error: 'Malformed or corrupted PDF document could not be parsed.',
            });
            return;
          }
        } else {
          // Verify that non-%PDF buffers do not contain arbitrary binary bytes (e.g. PNG/EXE/corrupted binary)
          const sampleSlice = fileBuffer.subarray(0, Math.min(fileBuffer.length, 512));
          let nonPrintableCount = 0;
          for (const byte of sampleSlice) {
            if (byte === 0 || (byte < 9 && byte !== 0) || (byte > 13 && byte < 32)) {
              nonPrintableCount++;
            }
          }
          if (nonPrintableCount > 0) {
            res.status(400).json({
              error: 'Invalid or corrupted binary document. Please upload a valid PDF or UTF-8 text invoice.',
            });
            return;
          }
          extractedText = fileBuffer.toString('utf8');
        }
      } finally {
        // Zero out the uploaded file buffer immediately in all code paths
        fileBuffer.fill(0);
      }

      if (!hasRecognizableInvoiceContent(extractedText)) {
        res.status(400).json({
          error:
            'No readable invoice fields (vendor, invoice number, or amount) found in the uploaded document.',
        });
        return;
      }

      const record = await processInvoiceThroughStewardPipeline({
        rawText: extractedText,
        structuredHint: structuredPdfHint,
        mode: (req.body?.mode as OperatingMode) || 'simulation',
        allowNetwork: true,
      });

      res.json({
        invoice: record,
        privacyGuarantee:
          'Uploaded PDF buffer was processed strictly in ephemeral RAM and zeroed immediately. Zero raw file or text persistence.',
      });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // 4b. Authorized Human Field Correction (Records audit entry; cannot bypass security BLOCK)
  app.post('/api/invoices/:id/correct-field', async (req, res) => {
    if (
      !verifyRolePermission(
        req,
        res,
        ['Owner', 'Finance Administrator', 'Approver'],
        'Correct Uncertain Invoice Field'
      )
    ) {
      return;
    }
    try {
      const db = getDb();
      const invoice = getInvoiceById(req.params.id, db);
      if (!invoice) {
        res.status(404).json({ error: `Invoice ${req.params.id} not found.` });
        return;
      }

      // SECURITY RULE: Human correction CANNOT bypass a BLOCK decision resulting from prompt injection,
      // blocklisted counterparty, duplicate invoice, or emergency kill switch!
      const isSecurityBlock = invoice.policyEvaluation.reasons.some(
        (r) =>
          r.decisionImpact === 'BLOCK' &&
          [
            'PROMPT_INJECTION_DETECTED',
            'BLOCKLISTED_ADDRESS',
            'DUPLICATE_INVOICE',
            'KILL_SWITCH_ACTIVE',
          ].includes(r.code)
      );
      if (isSecurityBlock) {
        res.status(403).json({
          error:
            'Security Violation: Manual field correction cannot override an invoice BLOCKED due to prompt injection, blocklisted addresses, or active kill switch.',
        });
        return;
      }

      const { field, correctedValue, reason, operator } = req.body || {};
      if (!field || correctedValue === undefined) {
        res.status(400).json({ error: 'Missing field or correctedValue in request body.' });
        return;
      }

      const originalValue = String(
        (invoice as unknown as Record<string, unknown>)[field] ?? ''
      );
      const operatorName =
        operator ||
        (req.headers['x-steward-actor-email'] as string) ||
        'controller@steward-ap.finance';

      const correctionEntry: FieldCorrectionEntry = {
        id: `CORR-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
        invoiceId: invoice.id,
        field,
        originalValue,
        correctedValue: String(correctedValue),
        correctedBy: operatorName,
        reason: reason || 'Manual operator correction of uncertain field',
        timestamp: new Date().toISOString(),
      };

      // Apply field update to invoice
      (invoice as unknown as Record<string, unknown>)[field] = correctedValue;
      if (field === 'receivingWalletAddress') {
        invoice.receivingWalletAddress = String(correctedValue).trim();
      } else if (field === 'vendorName') {
        invoice.vendorName = String(correctedValue).trim();
      } else if (field === 'vendorId') {
        invoice.vendorId = String(correctedValue).trim() || null;
      } else if (field === 'total') {
        invoice.total = Number(correctedValue);
      } else if (field === 'subtotal') {
        invoice.subtotal = Number(correctedValue);
      } else if (field === 'tax') {
        invoice.tax = Number(correctedValue);
      }

      invoice.fieldCorrections = invoice.fieldCorrections || [];
      invoice.fieldCorrections.push(correctionEntry);

      // Re-run validation deterministically with the corrected values
      const effectiveCandidate: ExtractedInvoice = {
        vendorName: invoice.vendorName,
        vendorId: invoice.vendorId,
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        dueDate: invoice.dueDate,
        lineItems: invoice.lineItems,
        subtotal: invoice.subtotal,
        tax: invoice.tax,
        total: invoice.total,
        currency: invoice.currency,
        requestedPayoutAsset: invoice.requestedPayoutAsset,
        requestedDestinationChain: invoice.requestedDestinationChain,
        receivingWalletAddress: invoice.receivingWalletAddress,
        paymentReference: invoice.paymentReference,
      };

      const { outcome: revalidation } = validateExtractedInvoice(effectiveCandidate);
      invoice.validation = revalidation;
      invoice.vendorCheck = evaluateVendorRegistry(effectiveCandidate, db);
      invoice.riskAssessment = await assessCounterpartyRisk(
        {
          destinationChain: effectiveCandidate.requestedDestinationChain,
          receivingAddress: effectiveCandidate.receivingWalletAddress,
          vendorCheck: invoice.vendorCheck,
        },
        { allowNetwork: true, db }
      );
      invoice.policyEvaluation = evaluatePaymentPolicy(
        {
          mode: invoice.mode,
          invoice: effectiveCandidate,
          validation: revalidation,
          attestation: invoice.attestation,
          vendorCheck: invoice.vendorCheck,
          riskAssessment: invoice.riskAssessment,
        },
        db
      );

      invoice.finalDecision = invoice.policyEvaluation.decision;
      invoice.paymentStatus =
        invoice.finalDecision === 'PAY'
          ? 'PENDING'
          : invoice.finalDecision === 'HOLD'
            ? 'HELD'
            : 'BLOCKED';
      invoice.decisionReasonSummary = invoice.policyEvaluation.reasons
        .map((r) => `[${r.code}] ${r.message}`)
        .join(' | ');
      invoice.updatedAt = new Date().toISOString();

      saveProcessedInvoice(invoice, db);

      logSecurityEvent(
        {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          vendorName: invoice.vendorName,
          severity: 'INFO',
          category: 'POLICY_HOLD',
          title: `Field "${field}" corrected by ${operatorName}`,
          description: `Field "${field}" was updated from "${originalValue}" to "${correctedValue}". Reason: ${correctionEntry.reason}. Re-evaluated decision: ${invoice.finalDecision}.`,
          metadataJson: JSON.stringify({
            correction: correctionEntry,
            revalidationResult: revalidation.arithmeticValid,
            newDecision: invoice.finalDecision,
          }),
        },
        db
      );

      res.json({ invoice });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // 5. Human Approval Queue Actions (APPROVE / REJECT)
  app.post('/api/invoices/:id/approve', async (req, res) => {
    if (
      !verifyRolePermission(
        req,
        res,
        ['Owner', 'Finance Administrator', 'Approver'],
        'Approve Held Invoice'
      )
    ) {
      return;
    }
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
    if (
      !verifyRolePermission(
        req,
        res,
        ['Owner', 'Finance Administrator', 'Approver'],
        'Reject Held Invoice'
      )
    ) {
      return;
    }
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
    if (
      !verifyRolePermission(
        req,
        res,
        ['Owner', 'Finance Administrator', 'Approver'],
        'Register Vendor'
      )
    ) {
      return;
    }
    try {
      const {
        businessName,
        contactEmail,
        walletAddress,
        preferredPayoutAsset,
        preferredDestinationChain,
        requestedBy,
        autoVerify,
      } = req.body || {};
      if (
        !businessName ||
        typeof businessName !== 'string' ||
        !businessName.trim() ||
        !walletAddress ||
        typeof walletAddress !== 'string' ||
        !walletAddress.trim()
      ) {
        res.status(400).json({ error: 'businessName and walletAddress are required.' });
        return;
      }

      const chain = (preferredDestinationChain || 'near') as SupportedChain;
      if (!SUPPORTED_CHAINS.includes(chain)) {
        res.status(400).json({
          error: `Unsupported preferredDestinationChain "${chain}". Supported chains: ${SUPPORTED_CHAINS.join(', ')}.`,
        });
        return;
      }

      const addressCheck = validateDestinationAddressFormat(chain, walletAddress.trim());
      if (!addressCheck.valid) {
        res.status(400).json({
          error: `Invalid walletAddress for ${chain}: ${addressCheck.reason}`,
        });
        return;
      }

      const existingVendors = listVendors(getDb());
      if (
        existingVendors.some(
          (v) => v.businessName.trim().toLowerCase() === businessName.trim().toLowerCase()
        )
      ) {
        res.status(409).json({
          error: `A vendor named "${businessName.trim()}" is already registered in the Vendor Registry.`,
        });
        return;
      }

      const vendor = createNewVendorInRegistry({
        businessName: businessName.trim(),
        contactEmail: typeof contactEmail === 'string' ? contactEmail.trim() : undefined,
        walletAddress: walletAddress.trim(),
        preferredPayoutAsset: preferredPayoutAsset || 'USDC',
        preferredDestinationChain: chain,
        requestedBy,
        autoVerify: Boolean(autoVerify),
      });
      res.json({ vendor });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/vendors/:id/change-address', (req, res) => {
    if (
      !verifyRolePermission(
        req,
        res,
        ['Owner', 'Finance Administrator', 'Approver'],
        'Request Vendor Address Change'
      )
    ) {
      return;
    }
    try {
      const { newWalletAddress, newDestinationChain, changedBy, reason } = req.body || {};
      if (!newWalletAddress || typeof newWalletAddress !== 'string' || !newWalletAddress.trim()) {
        res.status(400).json({ error: 'newWalletAddress is required.' });
        return;
      }

      const existingVendor = getVendorByIdOrName(req.params.id, null, getDb());
      if (!existingVendor) {
        res.status(404).json({ error: `Vendor "${req.params.id}" not found.` });
        return;
      }

      const targetChain = (newDestinationChain ||
        existingVendor.preferredDestinationChain) as SupportedChain;
      if (!SUPPORTED_CHAINS.includes(targetChain)) {
        res.status(400).json({
          error: `Unsupported destination chain "${targetChain}".`,
        });
        return;
      }

      const addressCheck = validateDestinationAddressFormat(targetChain, newWalletAddress.trim());
      if (!addressCheck.valid) {
        res.status(400).json({
          error: `Invalid newWalletAddress for ${targetChain}: ${addressCheck.reason}`,
        });
        return;
      }

      const vendor = requestVendorAddressChange({
        vendorId: req.params.id,
        newWalletAddress: newWalletAddress.trim(),
        newDestinationChain: targetChain,
        changedBy: changedBy || 'ap-clerk@steward-ap.finance',
        reason: reason || 'Vendor submitted updated remittance instructions',
      });
      res.json({ vendor });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/vendors/:id/verify', (req, res) => {
    if (
      !verifyRolePermission(
        req,
        res,
        ['Owner', 'Finance Administrator', 'Approver'],
        'Verify Vendor Record'
      )
    ) {
      return;
    }
    try {
      const existingVendor = getVendorByIdOrName(req.params.id, null, getDb());
      if (!existingVendor) {
        res.status(404).json({ error: `Vendor "${req.params.id}" not found.` });
        return;
      }
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
    const { modelId, tamperQuote, tamperNonce, tamperMeasurements, tamperCert } = req.body || {};
    const result = await fetchAndVerifyNearAiAttestation(
      modelId || process.env.NEAR_AI_MODEL || 'Qwen/Qwen3.6-35B-A3B-FP8',
      {
        tamperQuote: Boolean(tamperQuote),
        tamperNonce: Boolean(tamperNonce),
        tamperMeasurements: Boolean(tamperMeasurements),
        tamperCert: Boolean(tamperCert),
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
          tamperMeasurements: Boolean(tamperMeasurements),
          tamperCert: Boolean(tamperCert),
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
      const chain = (destinationChain || 'near') as SupportedChain;
      if (!SUPPORTED_CHAINS.includes(chain)) {
        res.status(400).json({
          error: `Unsupported destinationChain "${chain}". Supported chains: ${SUPPORTED_CHAINS.join(', ')}.`,
        });
        return;
      }

      const asset = String(payoutAsset || 'USDC').toUpperCase();
      if (asset !== 'USDC') {
        res.status(400).json({
          error: `Unsupported payoutAsset "${asset}". Only USDC is supported for exact-output settlement.`,
        });
        return;
      }

      const parsedAmount = amountUsd === undefined ? 100 : Number(amountUsd);
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || parsedAmount > 1_000_000) {
        res.status(400).json({
          error: 'amountUsd must be a positive number between 0.01 and 1,000,000.',
        });
        return;
      }

      const recipient = String(recipientAddress || 'vitalik.near').trim();
      const addrCheck = validateDestinationAddressFormat(chain, recipient);
      if (!addrCheck.valid) {
        res.status(400).json({
          error: `Invalid recipientAddress for ${chain}: ${addrCheck.reason}`,
        });
        return;
      }

      const quote = await requestOneClickExactOutputQuote({
        destinationChain: chain,
        payoutAsset: asset,
        exactOutputUsd: parsedAmount,
        recipientAddress: recipient,
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

  // 9b. Live 1Click Supported Token Registry & Non-Custodial Payment Lifecycle
  app.get('/api/payments/tokens', async (_req, res) => {
    try {
      const tokens = await fetchOneClickSupportedTokens({ allowNetwork: true });
      res.json({ tokens });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/payments/prepare', async (req, res) => {
    if (
      !verifyRolePermission(
        req,
        res,
        ['Owner', 'Finance Administrator', 'Approver'],
        'Prepare Non-Custodial Payment'
      )
    ) {
      return;
    }
    try {
      const {
        invoiceId,
        sourceWalletType,
        sourceWalletAddress,
        sourceChain,
        sourceAssetSymbol,
        restartAuthorization,
        allowNetwork,
      } = req.body || {};
      if (!invoiceId || !sourceWalletAddress || !sourceChain) {
        res.status(400).json({
          error: 'invoiceId, sourceWalletAddress, and sourceChain are required.',
        });
        return;
      }
      const payment = await prepareNonCustodialPayment({
        invoiceId: String(invoiceId),
        sourceWalletType: (sourceWalletType || 'near') as TreasuryWalletType,
        sourceWalletAddress: String(sourceWalletAddress).trim(),
        sourceChain: sourceChain as SupportedChain,
        sourceAssetSymbol: String(sourceAssetSymbol || 'USDC').trim().toUpperCase(),
        restartAuthorization: Boolean(restartAuthorization),
        allowNetwork: allowNetwork ?? true,
      });
      res.json({ payment });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/payments/commit-quote', async (req, res) => {
    if (
      !verifyRolePermission(
        req,
        res,
        ['Owner', 'Finance Administrator', 'Approver'],
        'Commit Payment Quote & Prepare Wallet Transaction'
      )
    ) {
      return;
    }
    try {
      const {
        invoiceId,
        sourceWalletType,
        sourceWalletAddress,
        sourceChain,
        sourceAssetSymbol,
        restartAuthorization,
        allowNetwork,
      } = req.body || {};
      if (!invoiceId || !sourceWalletType || !sourceWalletAddress || !sourceChain) {
        res.status(400).json({
          error:
            'invoiceId, sourceWalletType ("near" | "metamask"), sourceWalletAddress, and sourceChain are required.',
        });
        return;
      }
      if (sourceWalletType !== 'near' && sourceWalletType !== 'metamask') {
        res.status(400).json({
          error: 'sourceWalletType must be "near" or "metamask" for committed wallet quotes.',
        });
        return;
      }
      const payment = await commitQuoteAndPrepareTransaction({
        invoiceId: String(invoiceId),
        sourceWalletType,
        sourceWalletAddress: String(sourceWalletAddress).trim(),
        sourceChain: sourceChain as SupportedChain,
        sourceAssetSymbol: String(sourceAssetSymbol || 'USDC').trim().toUpperCase(),
        restartAuthorization: Boolean(restartAuthorization),
        allowNetwork: allowNetwork ?? true,
      });
      res.json({ payment });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/payments/:id/submit-deposit', async (req, res) => {
    if (
      !verifyRolePermission(
        req,
        res,
        ['Owner', 'Finance Administrator', 'Approver'],
        'Submit Signed Wallet Deposit Transaction'
      )
    ) {
      return;
    }
    try {
      const { txHash, isSimulatedTransaction, allowNetwork } = req.body || {};
      if (!txHash || typeof txHash !== 'string') {
        res.status(400).json({ error: 'txHash is required.' });
        return;
      }
      const payment = await submitSignedDepositTransaction({
        paymentId: req.params.id,
        txHash,
        isSimulatedTransaction: Boolean(isSimulatedTransaction),
        allowNetwork: allowNetwork ?? true,
      });
      res.json({ payment });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/payments/:id/poll-status', async (req, res) => {
    try {
      const { allowNetwork } = req.body || {};
      const payment = await pollAndSyncPaymentLifecycle({
        paymentId: req.params.id,
        allowNetwork: allowNetwork ?? true,
      });
      res.json({ payment, invoice: getInvoiceById(payment.invoiceId) });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // 9c. Treasury Dashboard Overview, Wallet Session Sync, Live Balances & Settings
  app.get('/api/treasury/overview', async (_req, res) => {
    try {
      const db = getDb();
      const settings = getTreasurySettings(db);
      const wallets = listTreasuryWallets(db);
      const tokens = await fetchOneClickSupportedTokens({ allowNetwork: true });
      const supportedChainSet = new Set<string>(SUPPORTED_CHAINS);
      const supportedTokens = tokens.filter(
        (t) =>
          supportedChainSet.has(String(t.normalizedChain)) &&
          ['USDC', 'USDT', 'WNEAR', 'NEAR', 'ETH', 'WBTC', 'BTC', 'SOL', 'ARB'].includes(
            t.symbol.toUpperCase()
          )
      );
      const recentPayments = listPayments(undefined, db).slice(0, 12);

      res.json({
        settings,
        wallets,
        connectedWallets: wallets,
        supportedTokens,
        recentActivity: recentPayments,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/treasury/settings', (req, res) => {
    if (
      !verifyRolePermission(
        req,
        res,
        ['Owner', 'Finance Administrator'],
        'Update Treasury Routing Settings'
      )
    ) {
      return;
    }
    try {
      const body = req.body || {};
      const patch: Record<string, unknown> = {};

      if (body.preferredFundingWalletType !== undefined) {
        if (!['near', 'metamask', 'auto'].includes(body.preferredFundingWalletType)) {
          res.status(400).json({
            error: 'preferredFundingWalletType must be "near", "metamask", or "auto".',
          });
          return;
        }
        patch.preferredFundingWalletType = body.preferredFundingWalletType;
      }

      if (body.preferredFundingWalletAddress !== undefined) {
        patch.preferredFundingWalletAddress = body.preferredFundingWalletAddress
          ? String(body.preferredFundingWalletAddress).trim()
          : null;
      }

      if (body.preferredSourceAsset !== undefined) {
        patch.preferredSourceAsset = String(body.preferredSourceAsset).trim().toUpperCase();
      }

      if (body.preferredSourceChain !== undefined) {
        if (!SUPPORTED_CHAINS.includes(body.preferredSourceChain)) {
          res.status(400).json({
            error: `Unsupported preferredSourceChain "${body.preferredSourceChain}".`,
          });
          return;
        }
        patch.preferredSourceChain = body.preferredSourceChain;
      }

      if (Array.isArray(body.allowedSourceNetworks)) {
        patch.allowedSourceNetworks = body.allowedSourceNetworks.filter((c: SupportedChain) =>
          SUPPORTED_CHAINS.includes(c)
        );
      }

      if (Array.isArray(body.approvedDestinationAssets)) {
        patch.approvedDestinationAssets = body.approvedDestinationAssets.map((a: string) =>
          String(a).trim().toUpperCase()
        );
      }

      if (Array.isArray(body.approvedDestinationNetworks)) {
        patch.approvedDestinationNetworks = body.approvedDestinationNetworks.filter(
          (c: SupportedChain) => SUPPORTED_CHAINS.includes(c)
        );
      }

      if (body.executionMode !== undefined) {
        if (!['non_custodial_wallet', 'simulation'].includes(body.executionMode)) {
          res.status(400).json({
            error: 'executionMode must be "non_custodial_wallet" or "simulation".',
          });
          return;
        }
        patch.executionMode = body.executionMode;
      }

      const updated = updateTreasurySettings(patch, getDb());
      res.json({ settings: updated });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/treasury/balances/near', async (req, res) => {
    try {
      const { accountId, allowNetwork } = req.body || {};
      if (!accountId || typeof accountId !== 'string') {
        res.status(400).json({ error: 'accountId is required.' });
        return;
      }
      const balances = await fetchNearAccountBalances(accountId, {
        allowNetwork: allowNetwork ?? true,
      });
      res.json(balances);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/treasury/balances/evm', async (req, res) => {
    try {
      const { address, chain, allowNetwork } = req.body || {};
      if (!address || typeof address !== 'string') {
        res.status(400).json({ error: 'address is required.' });
        return;
      }
      const targetChain = (chain || 'base') as 'ethereum' | 'base' | 'arbitrum';
      if (!['ethereum', 'base', 'arbitrum'].includes(targetChain)) {
        res.status(400).json({
          error: 'chain must be "ethereum", "base", or "arbitrum" for EVM balance inspection.',
        });
        return;
      }
      const balances = await fetchEvmAccountBalances(address, targetChain, {
        allowNetwork: allowNetwork ?? true,
      });
      res.json(balances);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/treasury/seed-demo', (req, res) => {
    if (
      !verifyRolePermission(
        req,
        res,
        ['Owner', 'Finance Administrator', 'Approver'],
        'Launch Simulated Demo Treasury'
      )
    ) {
      return;
    }
    try {
      const db = getDb();
      const wallets = seedSimulatedDemoTreasury(db);
      res.json({
        wallets,
        settings: getTreasurySettings(db),
        workspace: getWorkspaceProfile(db),
      });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/treasury/wallets/sync', async (req, res) => {
    if (
      !verifyRolePermission(
        req,
        res,
        ['Owner', 'Finance Administrator', 'Approver'],
        'Connect or Sync Treasury Wallet'
      )
    ) {
      return;
    }
    try {
      const {
        walletType,
        walletId,
        walletName,
        address,
        network,
        chain,
        chainIdHex,
        isSimulated,
        nativeBalance,
        tokenBalances,
        capabilities,
        unsupportedCapabilities,
        fetchLiveBalances,
        allowNetwork,
      } = req.body || {};

      if (!walletType || !address || !chain) {
        res.status(400).json({ error: 'walletType, address, and chain are required.' });
        return;
      }

      const addrCheck = validateDestinationAddressFormat(chain as SupportedChain, String(address));
      if (!addrCheck.valid) {
        res.status(400).json({ error: `Invalid wallet address: ${addrCheck.reason}` });
        return;
      }

      let resolvedNative = nativeBalance || null;
      let resolvedTokens = Array.isArray(tokenBalances) ? tokenBalances : [];

      if (fetchLiveBalances && !isSimulated) {
        if (walletType === 'near') {
          const b = await fetchNearAccountBalances(String(address), {
            allowNetwork: allowNetwork ?? true,
          });
          resolvedNative = b.nativeBalance;
          resolvedTokens = b.tokenBalances;
        } else if (
          walletType === 'metamask' &&
          ['ethereum', 'base', 'arbitrum'].includes(chain)
        ) {
          const b = await fetchEvmAccountBalances(
            String(address),
            chain as 'ethereum' | 'base' | 'arbitrum',
            { allowNetwork: allowNetwork ?? true }
          );
          resolvedNative = b.nativeBalance;
          resolvedTokens = b.tokenBalances;
        }
      }

      const nowIso = new Date().toISOString();
      const record: ConnectedWalletRecord = {
        id: `WLT-${walletType.toUpperCase()}-${String(address).slice(0, 14)}`,
        walletType: walletType as TreasuryWalletType,
        walletId: String(walletId || walletType),
        walletName: String(walletName || (walletType === 'near' ? 'NEAR Wallet' : 'MetaMask')),
        address: String(address).trim(),
        network: String(network || (chain === 'near' ? 'NEAR Mainnet' : chain)),
        chain: chain as SupportedChain,
        chainIdHex: chainIdHex ? String(chainIdHex) : null,
        isSimulated: Boolean(isSimulated),
        status: 'connected',
        nativeBalance: resolvedNative,
        tokenBalances: resolvedTokens,
        capabilities: capabilities || { signAndSendTransaction: true },
        unsupportedCapabilities: Array.isArray(unsupportedCapabilities)
          ? unsupportedCapabilities
          : [],
        lastRefreshedAt: nowIso,
        connectedAt: nowIso,
      };

      const saved = saveTreasuryWallet(record, getDb());
      res.json({ wallet: saved });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.delete('/api/treasury/wallets/:idOrAddress', (req, res) => {
    if (
      !verifyRolePermission(
        req,
        res,
        ['Owner', 'Finance Administrator'],
        'Disconnect Treasury Wallet'
      )
    ) {
      return;
    }
    try {
      removeTreasuryWallet(req.params.idOrAddress, getDb());
      res.json({ removed: true });
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
    if (
      !verifyRolePermission(
        req,
        res,
        ['Owner', 'Finance Administrator'],
        'Update Company Payment Policies'
      )
    ) {
      return;
    }
    const db = getDb();
    const before = getPolicyConfig(db);
    const body = req.body || {};

    // Validate numeric policy fields if provided
    const numericFields = [
      'auto_approve_below_usd',
      'per_invoice_cap_usd',
      'daily_cap_usd',
    ] as const;
    for (const field of numericFields) {
      if (body[field] !== undefined) {
        const val = Number(body[field]);
        if (!Number.isFinite(val) || val <= 0 || val > 10_000_000) {
          res.status(400).json({
            error: `Invalid ${field}: must be a positive number between 1 and 10,000,000.`,
          });
          return;
        }
        body[field] = val;
      }
    }

    const nextAutoApprove =
      body.auto_approve_below_usd ?? before.auto_approve_below_usd;
    const nextPerInvoiceCap =
      body.per_invoice_cap_usd ?? before.per_invoice_cap_usd;
    const nextDailyCap = body.daily_cap_usd ?? before.daily_cap_usd;

    if (nextAutoApprove > nextPerInvoiceCap) {
      res.status(400).json({
        error: `auto_approve_below_usd ($${nextAutoApprove}) cannot exceed per_invoice_cap_usd ($${nextPerInvoiceCap}).`,
      });
      return;
    }

    if (nextPerInvoiceCap > nextDailyCap) {
      res.status(400).json({
        error: `per_invoice_cap_usd ($${nextPerInvoiceCap}) cannot exceed daily_cap_usd ($${nextDailyCap}).`,
      });
      return;
    }

    if (body.allowed_payout_assets !== undefined) {
      if (
        !Array.isArray(body.allowed_payout_assets) ||
        body.allowed_payout_assets.length === 0 ||
        !body.allowed_payout_assets.every((a: unknown) => typeof a === 'string' && a.trim().length > 0)
      ) {
        res.status(400).json({
          error: 'allowed_payout_assets must be a non-empty array of asset symbols.',
        });
        return;
      }
    }

    if (
      body.new_vendor !== undefined &&
      !['HOLD', 'BLOCK', 'ALLOW'].includes(body.new_vendor)
    ) {
      res.status(400).json({
        error: 'new_vendor policy must be HOLD, BLOCK, or ALLOW.',
      });
      return;
    }

    if (body.address_change?.cooling_off_hours !== undefined) {
      const hours = Number(body.address_change.cooling_off_hours);
      if (!Number.isFinite(hours) || hours < 0 || hours > 720) {
        res.status(400).json({
          error: 'cooling_off_hours must be between 0 and 720 hours.',
        });
        return;
      }
      body.address_change.cooling_off_hours = hours;
    }

    if (body.kill_switch !== undefined && typeof body.kill_switch !== 'boolean') {
      res.status(400).json({
        error: 'kill_switch must be a boolean.',
      });
      return;
    }

    const updated = updatePolicyConfig(body, db);

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

  // Global JSON Error Handler (Catches Multer >8MB uploads, malformed JSON SyntaxErrors, etc. without leaking stack traces)
  app.use(
    (
      err: Error & { status?: number; code?: string },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          res.status(413).json({
            error: 'Uploaded file exceeds the 8 MB maximum size limit.',
          });
          return;
        }
        res.status(400).json({ error: `File upload error: ${err.message}` });
        return;
      }

      if (err instanceof SyntaxError && 'status' in err) {
        res.status(400).json({ error: 'Malformed JSON request body.' });
        return;
      }

      if (err.status === 413) {
        res.status(413).json({ error: 'Request payload too large.' });
        return;
      }

      res.status(500).json({ error: err.message || 'Internal server error' });
    }
  );

  return app;
}
