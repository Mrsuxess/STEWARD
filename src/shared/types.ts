export type OperatingMode = 'simulation' | 'live';

export type SupportedChain = 'near' | 'ethereum' | 'arbitrum' | 'solana' | 'base' | 'bitcoin';

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface ExtractedInvoice {
  vendorName: string;
  vendorId?: string | null;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  lineItems: InvoiceLineItem[];
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
  requestedPayoutAsset: string;
  requestedDestinationChain: SupportedChain;
  receivingWalletAddress: string;
  paymentReference: string;
}

export interface AttestationCheckItem {
  id: string;
  label: string;
  passed: boolean;
  details: string;
}

export interface AttestationVerificationResult {
  verified: boolean;
  modelId: string;
  teeType: string;
  nonce: string;
  nonceVerified: boolean;
  gatewayQuoteVerified: boolean;
  modelQuoteVerified: boolean;
  nvidiaGpuVerified: boolean;
  intelRootCaFingerprint: string;
  gatewaySigningAddress: string;
  modelSigningAddress: string;
  measurements: {
    gatewayMrtd: string;
    gatewayRtmr0: string;
    modelMrtd: string;
    modelRtmr0: string;
    composeHash: string;
    gpuArch: string;
  };
  verifiedAt: string;
  source: 'live_near_ai_cloud' | 'tamper_test' | 'offline_unverified';
  checks: AttestationCheckItem[];
  failedChecks: string[];
}

export interface PromptInjectionFinding {
  code: string;
  severity: 'HIGH' | 'CRITICAL';
  pattern: string;
  excerpt: string;
  message: string;
}

export type FieldConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNCERTAIN';

export interface FieldConfidenceInfo {
  field: string;
  value: unknown;
  confidence: FieldConfidenceLevel;
  isUncertain: boolean;
  uncertaintyReason?: string;
  rawSource?: string;
  sourceLocation?: string;
}

export type DiscrepancyClassification =
  | 'GENUINE_DISCREPANCY'
  | 'EXTRACTION_FAILURE'
  | 'AMBIGUOUS_FIELD';

export interface ArithmeticVerificationDetails {
  calculatedSubtotal: number;
  extractedSubtotal: number;
  calculatedTotal: number;
  extractedTotal: number;
  tax: number;
  discounts: number;
  additionalCharges: number;
  verificationResult: 'PASS' | 'FAIL';
  lineItemCount: number;
  difference: number;
}

export interface FieldCorrectionEntry {
  id: string;
  invoiceId: string;
  field: string;
  originalValue: string;
  correctedValue: string;
  correctedBy: string;
  reason: string;
  timestamp: string;
}

export interface ValidationOutcome {
  schemaValid: boolean;
  arithmeticValid: boolean;
  promptInjectionDetected: boolean;
  calculatedLineItemSum: number;
  calculatedTotal: number;
  arithmeticDiff: number;
  errors: string[];
  injectionFindings: PromptInjectionFinding[];
  confidenceMap?: Record<string, FieldConfidenceInfo>;
  overallConfidence?: FieldConfidenceLevel;
  discrepancyType?: DiscrepancyClassification;
  arithmeticDetails?: ArithmeticVerificationDetails;
  uncertainFields?: string[];
}

export type VendorStatus = 'VERIFIED' | 'PENDING_APPROVAL' | 'COOLING_OFF' | 'SUSPENDED';

export interface VendorRecord {
  id: string;
  businessName: string;
  contactEmail?: string | null;
  verifiedWalletAddress: string;
  preferredPayoutAsset: string;
  preferredDestinationChain: SupportedChain;
  status: VendorStatus;
  coolingOffUntil: string | null;
  pendingWalletAddress: string | null;
  createdAt: string;
  updatedAt: string;
  approvalHistory: Array<{
    action: string;
    approvedBy: string;
    timestamp: string;
    notes: string;
  }>;
  paymentCount: number;
  totalPaidUsd: number;
}

export interface VendorAddressHistoryEntry {
  id: string;
  vendorId: string;
  businessName: string;
  previousAddress: string | null;
  newAddress: string;
  changedBy: string;
  reason: string;
  coolingOffUntil: string;
  timestamp: string;
}

export interface VendorCheckResult {
  matchedVendor: VendorRecord | null;
  isNewVendor: boolean;
  isVerifiedVendor: boolean;
  addressMatchesRegistry: boolean;
  inCoolingOffPeriod: boolean;
  coolingOffRemainingHours: number;
  chainMatchesPreference: boolean;
  assetMatchesPreference: boolean;
  discrepancies: Array<{
    code: string;
    message: string;
  }>;
}

export type RiskDecision = 'ALLOW' | 'WARN' | 'BLOCK';

export interface RiskReason {
  code: string;
  severity: 'INFO' | 'WARN' | 'CRITICAL';
  message: string;
}

export interface NearAccountIntelligence {
  inspected: boolean;
  network: 'mainnet' | 'testnet';
  accountExists: boolean;
  accountId: string;
  amountYocto: string | null;
  balanceNearFormatted: string | null;
  storageUsageBytes: number | null;
  codeHash: string | null;
  isSmartContract: boolean;
  accessKeyCount: number | null;
  fullAccessKeyCount: number | null;
  functionCallKeyCount: number | null;
  blockHeight: number | null;
  rpcLatencyMs: number;
  note?: string;
}

export interface CounterpartyRiskResult {
  decision: RiskDecision;
  riskScore: number;
  destinationChain: SupportedChain;
  receivingAddress: string;
  addressFormatValid: boolean;
  isBlocklisted: boolean;
  nearIntelligence: NearAccountIntelligence | null;
  nonNearDisclosure: string | null;
  previousTransactionsCount: number;
  reasons: RiskReason[];
  evaluatedAt: string;
}

export interface PolicyConfig {
  per_invoice_cap_usd: number;
  daily_cap_usd: number;
  auto_approve_below_usd: number;
  allowed_payout_assets: string[];
  new_vendor: 'require_human' | 'block';
  address_change: {
    cooling_off_hours: number;
    require_human: boolean;
  };
  kill_switch: boolean;
}

export type PolicyDecisionType = 'PAY' | 'HOLD' | 'BLOCK';

export interface PolicyReason {
  code: string;
  rule: string;
  decisionImpact: PolicyDecisionType;
  message: string;
}

export interface PolicyEvaluationResult {
  decision: PolicyDecisionType;
  requiresHumanApproval: boolean;
  canHumanOverride: boolean;
  dailySpendSoFarUsd: number;
  dailySpendRemainingUsd: number;
  isDuplicateInvoice: boolean;
  reasons: PolicyReason[];
  policySnapshot: PolicyConfig;
  evaluatedAt: string;
}

export type PaymentLifecycleStatus =
  | 'DRAFT'
  | 'AWAITING_APPROVAL'
  | 'APPROVED'
  | 'AWAITING_WALLET_SIGNATURE'
  | 'DEPOSIT_SUBMITTED'
  | 'DEPOSIT_CONFIRMED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'REFUNDED'
  | 'FAILED'
  | 'EXPIRED';

export type PaymentStatus =
  | 'PAID'
  | 'PENDING'
  | 'REFUNDED'
  | 'FAILED'
  | 'HELD'
  | 'BLOCKED'
  | PaymentLifecycleStatus;

export interface OneClickTokenInfo {
  assetId: string;
  symbol: string;
  blockchain: string;
  normalizedChain: SupportedChain | string;
  decimals: number;
  price: number;
  priceUpdatedAt: string;
  contractAddress?: string;
  coingeckoId?: string;
}

export type TreasuryWalletType = 'near' | 'metamask' | 'simulated';

export interface WalletAssetBalance {
  symbol: string;
  name: string;
  assetId: string;
  contractAddress: string | null;
  decimals: number;
  rawBalance: string;
  formattedBalance: string;
  priceUsd: number | null;
  priceUpdatedAt: string | null;
  valueUsd: number | null;
  isNative: boolean;
}

export interface ConnectedWalletRecord {
  id: string;
  walletType: TreasuryWalletType;
  walletId: string;
  walletName: string;
  address: string;
  network: string;
  chain: SupportedChain;
  chainIdHex?: string | null;
  isSimulated: boolean;
  status: 'connected' | 'disconnected' | 'error';
  nativeBalance: WalletAssetBalance | null;
  tokenBalances: WalletAssetBalance[];
  capabilities: Record<string, boolean>;
  unsupportedCapabilities: string[];
  lastRefreshedAt: string;
  connectedAt: string;
}

export interface TreasurySettings {
  preferredFundingWalletType: 'near' | 'metamask' | 'auto';
  preferredFundingWalletAddress: string | null;
  preferredSourceAsset: string;
  preferredSourceChain: SupportedChain;
  allowedSourceNetworks: SupportedChain[];
  approvedDestinationAssets: string[];
  approvedDestinationNetworks: SupportedChain[];
  requireExplicitWalletConfirmation: boolean;
  executionMode: 'non_custodial_wallet' | 'simulation';
  updatedAt: string;
}

export interface PreparedNearAction {
  type: 'FunctionCall' | 'Transfer';
  params: {
    methodName?: string;
    args?: Record<string, unknown>;
    gas?: string;
    deposit: string;
  };
}

export interface PreparedNearTransactionItem {
  receiverId: string;
  actions: PreparedNearAction[];
  description: string;
}

export interface PreparedWalletTransaction {
  walletType: 'near' | 'metamask';
  kind:
    | 'near_nep141_transfer'
    | 'near_native_transfer'
    | 'evm_erc20_transfer'
    | 'evm_native_transfer';
  sourceChain: SupportedChain;
  networkName: string;
  chainIdHex?: string;
  chainIdDecimal?: number;
  fromAddress: string;
  recipientDepositAddress: string;
  contractOrReceiverAddress: string;
  sourceAssetSymbol: string;
  sourceAssetId: string;
  sourceAssetDecimals: number;
  amountRaw: string;
  amountFormatted: string;
  estimatedGasDisplay: string;
  // NEAR-specific payload
  nearTransactions?: PreparedNearTransactionItem[];
  // EVM-specific payload
  evmTransaction?: {
    from: string;
    to: string;
    value: string;
    data: string;
    chainId: string;
  };
}

export interface PaymentExecutionRecord {
  id: string;
  invoiceId: string;
  idempotencyKey: string;
  mode: OperatingMode;
  custodyMode: 'non_custodial_wallet' | 'outlayer' | 'scoped_signer' | 'simulation';
  status: PaymentStatus;
  lifecycleStatus?: PaymentLifecycleStatus;
  quoteId: string | null;
  correlationId: string | null;
  depositAddress: string | null;
  sourceAsset: string;
  sourceAssetId?: string | null;
  destinationAsset: string;
  destinationAssetId?: string | null;
  sourceChain: SupportedChain;
  destinationChain: SupportedChain;
  sourceWalletAddress?: string | null;
  sourceWalletType?: TreasuryWalletType | null;
  exactRequestedOutput: string;
  exactRequestedOutputRaw: string;
  estimatedInputAmount: string;
  estimatedInputRaw?: string | null;
  minInputAmountRaw?: string | null;
  actualReceivedAmount: string | null;
  feesUsd: number;
  slippageBps?: number;
  timeEstimateSeconds?: number | null;
  quoteExpiresAt?: string | null;
  isDryQuote?: boolean;
  isSimulatedQuote?: boolean;
  isSimulatedTransaction?: boolean;
  refundAddress: string;
  recipientAddress: string;
  txHash: string | null;
  destinationTxHash?: string | null;
  explorerUrl: string | null;
  destinationExplorerUrl?: string | null;
  quoteSignature: string | null;
  statusSource: string;
  refundReason?: string | null;
  errorMessage: string | null;
  preparedTransaction?: PreparedWalletTransaction | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProcessedInvoiceRecord {
  id: string;
  mode: OperatingMode;
  invoiceNumber: string;
  vendorId: string | null;
  vendorName: string;
  invoiceDate: string;
  dueDate: string;
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
  requestedPayoutAsset: string;
  requestedDestinationChain: SupportedChain;
  receivingWalletAddress: string;
  paymentReference: string;
  lineItems: InvoiceLineItem[];
  extractionMethod: 'near_ai_cloud_tee' | 'deterministic_structured_parser';
  extractionModel: string;
  attestation: AttestationVerificationResult;
  validation: ValidationOutcome;
  vendorCheck: VendorCheckResult;
  riskAssessment: CounterpartyRiskResult;
  policyEvaluation: PolicyEvaluationResult;
  finalDecision: PolicyDecisionType;
  paymentStatus: PaymentStatus;
  decisionReasonSummary: string;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  paymentExecution: PaymentExecutionRecord | null;
  rawTextDeleted: boolean;
  processingTimeMs: number;
  fieldCorrections?: FieldCorrectionEntry[];
  discrepancyClassification?: DiscrepancyClassification;
  confidenceMap?: Record<string, FieldConfidenceInfo>;
  uncertainFields?: string[];
  arithmeticDetails?: ArithmeticVerificationDetails;
  createdAt: string;
  updatedAt: string;
}

export interface SecurityEventRecord {
  id: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  vendorName: string | null;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  category:
    | 'PROMPT_INJECTION'
    | 'ADDRESS_SUBSTITUTION'
    | 'BLOCKLIST_HIT'
    | 'DUPLICATE_INVOICE'
    | 'ARITHMETIC_FRAUD'
    | 'LIMIT_EXCEEDED'
    | 'ATTESTATION_FAILURE'
    | 'POLICY_HOLD'
    | 'KILL_SWITCH'
    | 'TREASURY_WALLET'
    | 'PAYMENT_AUTHORIZATION'
    | 'ACCESS_CONTROL'
    | 'WORKSPACE_ONBOARDING';
  title: string;
  description: string;
  metadataJson: string;
  createdAt: string;
}

export type ExperienceMode = 'real' | 'simulated' | 'explore';

export type WorkspaceRole = 'Owner' | 'Finance Administrator' | 'Approver' | 'Auditor';

export interface WorkspaceMemberRecord {
  id: string;
  fullName: string;
  email: string;
  role: WorkspaceRole;
  status: 'ACTIVE' | 'INVITED';
  invitedAt: string;
}

export interface WorkspaceProfile {
  companyName: string;
  businessEmail: string;
  country: string;
  businessType: string;
  reportingCurrency: 'USD' | 'EUR' | 'GBP' | 'CAD' | 'SGD' | 'NGN' | string;
  experienceMode: ExperienceMode;
  onboardingStep: number;
  onboardingCompleted: boolean;
  checklistState: {
    businessProfileCompleted: boolean;
    treasuryConnected: boolean;
    paymentPoliciesConfigured: boolean;
    firstVendorAdded: boolean;
    firstInvoiceUploaded: boolean;
  };
  createdAt: string;
  updatedAt: string;
}
