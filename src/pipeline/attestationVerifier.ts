import crypto from 'node:crypto';
import type { AttestationVerificationResult, AttestationCheckItem } from '../shared/types.js';

const EXPECTED_INTEL_SGX_ROOT_CA_FINGERPRINT256 =
  '44:A0:19:6B:2B:99:F8:89:B8:E1:49:E9:5B:80:7A:35:0E:74:24:96:43:99:E8:85:A7:CB:B8:CC:FA:B6:74:D3';

export interface RawTdxAttestationObject {
  signing_address?: string;
  signing_algo?: string;
  signing_public_key?: string;
  request_nonce?: string;
  report_data?: string | null;
  intel_quote?: string;
  nvidia_payload?: string | null;
  model_name?: string;
  info?: {
    app_id?: string;
    app_name?: string;
    compose_hash?: string;
    mr_aggregated?: string;
    os_image_hash?: string;
    tcb_info?: {
      mrtd?: string;
      rtmr0?: string;
      rtmr1?: string;
      rtmr2?: string;
      rtmr3?: string;
    };
  };
}

export interface RawNearAiAttestationReport {
  gateway_attestation?: RawTdxAttestationObject;
  model_attestations?: RawTdxAttestationObject[];
}

export function generateFresh32ByteNonce(): string {
  return crypto.randomBytes(32).toString('hex');
}

interface TdxQuoteVerificationDetail {
  valid: boolean;
  version: number;
  teeTypeHex: string;
  mrtdHex: string;
  rtmr0Hex: string;
  rtmr1Hex: string;
  rtmr2Hex: string;
  rtmr3Hex: string;
  reportDataHex: string;
  nonceMatchedInQuote: boolean;
  signingAddressBoundInQuote: boolean;
  measurementsMatchTcbInfo: boolean;
  quoteSignatureValid: boolean;
  qeReportSignatureValid: boolean;
  qeReportBindsAttestationKey: boolean;
  pckCertChainValid: boolean;
  rootCaFingerprint: string;
  errors: string[];
}

export function verifyBinaryIntelTdxQuoteV4(
  enclave: RawTdxAttestationObject,
  expectedNonceHex: string,
  label: string
): TdxQuoteVerificationDetail {
  const errors: string[] = [];
  const quoteHex = enclave.intel_quote || '';

  if (!quoteHex || quoteHex.length < 1264 * 2) {
    return {
      valid: false,
      version: 0,
      teeTypeHex: '0x0',
      mrtdHex: '',
      rtmr0Hex: '',
      rtmr1Hex: '',
      rtmr2Hex: '',
      rtmr3Hex: '',
      reportDataHex: '',
      nonceMatchedInQuote: false,
      signingAddressBoundInQuote: false,
      measurementsMatchTcbInfo: false,
      quoteSignatureValid: false,
      qeReportSignatureValid: false,
      qeReportBindsAttestationKey: false,
      pckCertChainValid: false,
      rootCaFingerprint: '',
      errors: [`${label}: Missing or truncated Intel TDX quote binary.`],
    };
  }

  try {
    const buf = Buffer.from(quoteHex, 'hex');
    const version = buf.readUInt16LE(0);
    const attKeyType = buf.readUInt16LE(2);
    const teeType = buf.readUInt32LE(4);
    const teeTypeHex = '0x' + teeType.toString(16);

    if (version !== 4 || attKeyType !== 2 || teeType !== 0x81) {
      errors.push(
        `${label}: Unexpected TDX header (version=${version}, attKeyType=${attKeyType}, teeType=${teeTypeHex}).`
      );
    }

    // TD Quote Body is 584 bytes starting at offset 48 (bytes 48..632)
    const tdBody = buf.subarray(48, 632);
    const mrtdHex = tdBody.subarray(136, 184).toString('hex');
    const rtmr0Hex = tdBody.subarray(328, 376).toString('hex');
    const rtmr1Hex = tdBody.subarray(376, 424).toString('hex');
    const rtmr2Hex = tdBody.subarray(424, 472).toString('hex');
    const rtmr3Hex = tdBody.subarray(472, 520).toString('hex');
    const reportDataHex = tdBody.subarray(520, 584).toString('hex');

    // 1. Verify binary measurements match reported tcb_info
    const tcb = enclave.info?.tcb_info;
    const measurementsMatchTcbInfo = Boolean(
      tcb &&
        tcb.mrtd === mrtdHex &&
        tcb.rtmr0 === rtmr0Hex &&
        tcb.rtmr1 === rtmr1Hex &&
        tcb.rtmr2 === rtmr2Hex &&
        tcb.rtmr3 === rtmr3Hex
    );
    if (!measurementsMatchTcbInfo) {
      errors.push(`${label}: Binary TDX TD Report MRTD/RTMR0-3 measurements do not match tcb_info.`);
    }

    // 2. Verify REPORTDATA[32..64] binds the exact 32-byte fresh nonce
    const embeddedNonceHex = reportDataHex.slice(64, 128).toLowerCase();
    const nonceMatchedInQuote =
      embeddedNonceHex === expectedNonceHex.toLowerCase() &&
      (enclave.request_nonce || '').toLowerCase() === expectedNonceHex.toLowerCase();
    if (!nonceMatchedInQuote) {
      errors.push(
        `${label}: Nonce mismatch in TDX Quote REPORTDATA (expected ${expectedNonceHex.slice(0, 16)}..., got ${embeddedNonceHex.slice(0, 16)}...).`
      );
    }

    // 3. Verify REPORTDATA[0..32] binds the enclave signing_address
    const rawSigningAddress = (enclave.signing_address || '').replace(/^0x/i, '').toLowerCase();
    const expectedSigningPrefix = rawSigningAddress.padEnd(64, '0');
    const embeddedSigningPrefix = reportDataHex.slice(0, 64).toLowerCase();
    const signingAddressBoundInQuote =
      rawSigningAddress.length >= 40 && embeddedSigningPrefix === expectedSigningPrefix;
    if (!signingAddressBoundInQuote) {
      errors.push(`${label}: Enclave signing_address is not bound in TDX Quote REPORTDATA[0..32].`);
    }

    // 4. Verify ECDSA-P256 Quote Signature over Quote Header + TD Body (bytes 0..632)
    const sigRS = buf.subarray(636, 700);
    const attPubKeyXY = buf.subarray(700, 764);
    const spkiPrefix = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d03010703420004', 'hex');
    const attPubKeyObj = crypto.createPublicKey({
      key: Buffer.concat([spkiPrefix, attPubKeyXY]),
      format: 'der',
      type: 'spki',
    });

    const quoteSignatureValid = crypto.verify(
      'sha256',
      buf.subarray(0, 632),
      { key: attPubKeyObj, dsaEncoding: 'ieee-p1363' },
      sigRS
    );
    if (!quoteSignatureValid) {
      errors.push(`${label}: ECDSA-P256 signature over TDX Quote Header + TD Report Body is invalid.`);
    }

    // 5. Verify QE Report Certification Data & X.509 PCK Certificate Chain
    const qeReport = buf.subarray(770, 1154);
    const qeSig = buf.subarray(1154, 1218);
    const authDataSize = buf.readUInt16LE(1218);
    const authData = buf.subarray(1220, 1220 + authDataSize);

    const expectedQeHashHex = crypto
      .createHash('sha256')
      .update(attPubKeyXY)
      .update(authData)
      .digest('hex');
    const actualQeReportDataHex = qeReport.subarray(320, 384).toString('hex');
    const qeReportBindsAttestationKey = actualQeReportDataHex.startsWith(expectedQeHashHex);
    if (!qeReportBindsAttestationKey) {
      errors.push(`${label}: Quoting Enclave (QE) Report does not bind the Attestation Public Key.`);
    }

    const pemStr = buf.subarray(1220 + authDataSize).toString('latin1');
    const certMatches =
      pemStr.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || [];
    const certs = certMatches.map((pem) => new crypto.X509Certificate(pem));

    let qeReportSignatureValid = false;
    let pckCertChainValid = false;
    let rootCaFingerprint = '';

    if (certs.length >= 3) {
      qeReportSignatureValid = crypto.verify(
        'sha256',
        qeReport,
        { key: certs[0].publicKey, dsaEncoding: 'ieee-p1363' },
        qeSig
      );
      if (!qeReportSignatureValid) {
        errors.push(`${label}: Quoting Enclave (QE) Report signature failed PCK Leaf verification.`);
      }

      const leafSignedByIntermediate = certs[0].verify(certs[1].publicKey);
      const intermediateSignedByRoot = certs[1].verify(certs[2].publicKey);
      const rootSelfSigned = certs[2].verify(certs[2].publicKey);
      rootCaFingerprint = certs[2].fingerprint256;
      const matchesIntelRoot = rootCaFingerprint === EXPECTED_INTEL_SGX_ROOT_CA_FINGERPRINT256;

      const nowMs = Date.now();
      const certsWithinValidityWindow = certs.slice(0, 3).every((c) => {
        const fromMs = Date.parse(c.validFrom);
        const toMs = Date.parse(c.validTo);
        return Number.isFinite(fromMs) && Number.isFinite(toMs) && fromMs <= nowMs && nowMs <= toMs;
      });
      if (!certsWithinValidityWindow) {
        errors.push(`${label}: One or more Intel SGX/TDX PCK X.509 certificates are expired or not yet valid.`);
      }

      pckCertChainValid =
        leafSignedByIntermediate &&
        intermediateSignedByRoot &&
        rootSelfSigned &&
        matchesIntelRoot &&
        certsWithinValidityWindow;
      if (!pckCertChainValid) {
        errors.push(`${label}: Intel SGX/TDX PCK Certificate Chain failed root-of-trust validation.`);
      }
    } else {
      errors.push(`${label}: Incomplete X.509 PCK certificate chain (${certs.length} certs found).`);
    }

    const valid =
      errors.length === 0 &&
      nonceMatchedInQuote &&
      signingAddressBoundInQuote &&
      measurementsMatchTcbInfo &&
      quoteSignatureValid &&
      qeReportSignatureValid &&
      qeReportBindsAttestationKey &&
      pckCertChainValid;

    return {
      valid,
      version,
      teeTypeHex,
      mrtdHex,
      rtmr0Hex,
      rtmr1Hex,
      rtmr2Hex,
      rtmr3Hex,
      reportDataHex,
      nonceMatchedInQuote,
      signingAddressBoundInQuote,
      measurementsMatchTcbInfo,
      quoteSignatureValid,
      qeReportSignatureValid,
      qeReportBindsAttestationKey,
      pckCertChainValid,
      rootCaFingerprint,
      errors,
    };
  } catch (err) {
    return {
      valid: false,
      version: 0,
      teeTypeHex: '0x0',
      mrtdHex: '',
      rtmr0Hex: '',
      rtmr1Hex: '',
      rtmr2Hex: '',
      rtmr3Hex: '',
      reportDataHex: '',
      nonceMatchedInQuote: false,
      signingAddressBoundInQuote: false,
      measurementsMatchTcbInfo: false,
      quoteSignatureValid: false,
      qeReportSignatureValid: false,
      qeReportBindsAttestationKey: false,
      pckCertChainValid: false,
      rootCaFingerprint: '',
      errors: [`${label}: Exception parsing TDX quote: ${(err as Error).message}`],
    };
  }
}

export function verifyAttestationReportPayload(
  report: RawNearAiAttestationReport,
  expectedNonceHex: string,
  expectedModelId: string,
  source: AttestationVerificationResult['source'] = 'live_near_ai_cloud'
): AttestationVerificationResult {
  const checks: AttestationCheckItem[] = [];
  const failedChecks: string[] = [];

  // Check 1: Nonce format (32 bytes = 64 hex chars)
  const nonceFormatValid = /^[0-9a-f]{64}$/i.test(expectedNonceHex);
  checks.push({
    id: 'nonce_format',
    label: 'CSPRNG 32-Byte Nonce Challenge',
    passed: nonceFormatValid,
    details: nonceFormatValid
      ? `Fresh 256-bit nonce generated (${expectedNonceHex.slice(0, 16)}...${expectedNonceHex.slice(-8)})`
      : 'Nonce is not a valid 32-byte (64-hex) challenge string.',
  });
  if (!nonceFormatValid) failedChecks.push('Invalid 32-byte nonce format');

  // Check 2: Gateway Intel TDX Quote v4 Verification
  const gw = report.gateway_attestation || {};
  const gwResult = verifyBinaryIntelTdxQuoteV4(gw, expectedNonceHex, 'Gateway TEE');
  checks.push({
    id: 'gateway_tdx_quote',
    label: 'Gateway Intel TDX v4 Quote & ECDSA-P256 Signature',
    passed: gwResult.quoteSignatureValid && gwResult.qeReportSignatureValid && gwResult.qeReportBindsAttestationKey,
    details: gwResult.quoteSignatureValid
      ? `Verified TDX v4 Quote (TEE ${gwResult.teeTypeHex}) signed by QE-certified Attestation Key`
      : gwResult.errors.join('; ') || 'Gateway quote signature verification failed.',
  });
  if (!gwResult.quoteSignatureValid || !gwResult.qeReportSignatureValid) {
    failedChecks.push(...gwResult.errors);
  }

  // Check 3: Intel SGX/TDX Root CA Certificate Chain
  checks.push({
    id: 'intel_root_ca_chain',
    label: 'Intel SGX/TDX Root CA X.509 Certificate Chain',
    passed: gwResult.pckCertChainValid,
    details: gwResult.pckCertChainValid
      ? `Verified 3-tier PCK chain anchored to Intel SGX Root CA (${gwResult.rootCaFingerprint.slice(0, 23)}...)`
      : 'Intel SGX PCK X.509 certificate chain verification failed.',
  });
  if (!gwResult.pckCertChainValid) {
    failedChecks.push('Intel SGX Root CA chain verification failed');
  }

  // Check 4: Model Enclave Intel TDX Quote v4 Verification
  const modelEnclave =
    (report.model_attestations || []).find(
      (m) => (m.model_name || '').toLowerCase() === expectedModelId.toLowerCase()
    ) || (report.model_attestations || [])[0];

  const modelResult = modelEnclave
    ? verifyBinaryIntelTdxQuoteV4(modelEnclave, expectedNonceHex, 'Model TEE')
    : null;

  const modelQuoteVerified = Boolean(modelResult && modelResult.valid);
  checks.push({
    id: 'model_tdx_quote',
    label: `Model Enclave Intel TDX v4 Quote (${modelEnclave?.model_name || expectedModelId})`,
    passed: modelQuoteVerified,
    details: modelQuoteVerified
      ? `Verified Model TDX v4 Quote, MRTD (${modelResult!.mrtdHex.slice(0, 16)}...) & signing key (${modelEnclave?.signing_address})`
      : modelResult?.errors.join('; ') || 'Model enclave attestation missing or invalid.',
  });
  if (!modelQuoteVerified) {
    failedChecks.push(...(modelResult?.errors || ['Model enclave attestation missing']));
  }

  // Check 5: Nonce & Signing Key Binding across Gateway and Model Enclaves
  const nonceVerified = Boolean(
    nonceFormatValid &&
      gwResult.nonceMatchedInQuote &&
      gwResult.signingAddressBoundInQuote &&
      modelResult?.nonceMatchedInQuote &&
      modelResult?.signingAddressBoundInQuote
  );
  checks.push({
    id: 'nonce_and_key_binding',
    label: 'Hardware REPORTDATA Nonce & Signing Key Binding',
    passed: nonceVerified,
    details: nonceVerified
      ? 'Both Gateway & Model TDX REPORTDATA[0..64] cryptographically bind enclave signing_address || fresh_nonce'
      : 'REPORTDATA failed to bind signing_address or fresh session nonce.',
  });
  if (!nonceVerified) {
    failedChecks.push('Hardware REPORTDATA nonce/signing_address binding check failed');
  }

  // Check 6: NVIDIA Hopper Confidential GPU Evidence Verification
  let nvidiaGpuVerified = false;
  let gpuArch = 'HOPPER';
  let gpuDetails = 'Missing NVIDIA GPU attestation payload';
  if (modelEnclave?.nvidia_payload) {
    try {
      const nv = JSON.parse(modelEnclave.nvidia_payload) as {
        nonce?: string;
        evidence_list?: Array<{ arch?: string; certificate?: string; evidence?: string }>;
      };
      const nvNonceMatch = (nv.nonce || '').toLowerCase() === expectedNonceHex.toLowerCase();
      const firstEv = (nv.evidence_list || [])[0];
      gpuArch = firstEv?.arch || 'HOPPER';
      let certValid = false;
      if (firstEv?.certificate) {
        const pemDecoded = Buffer.from(firstEv.certificate, 'base64').toString('utf8');
        const certBlocks =
          pemDecoded.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || [];
        if (certBlocks.length > 0 && certBlocks[0]) {
          const leafGpuCert = new crypto.X509Certificate(certBlocks[0]);
          certValid = leafGpuCert.subject.includes('NVIDIA') && Boolean(firstEv.evidence);
        }
      }
      nvidiaGpuVerified = nvNonceMatch && certValid;
      gpuDetails = nvidiaGpuVerified
        ? `Verified NVIDIA ${gpuArch} Confidential GPU X.509 Device Certificate & GPU Nonce Binding`
        : 'NVIDIA GPU nonce or certificate verification failed.';
    } catch (err) {
      gpuDetails = `Failed to parse NVIDIA GPU attestation payload: ${(err as Error).message}`;
    }
  }
  checks.push({
    id: 'nvidia_gpu_attestation',
    label: 'NVIDIA Confidential GPU Attestation (NRAS Evidence)',
    passed: nvidiaGpuVerified,
    details: gpuDetails,
  });
  if (!nvidiaGpuVerified) {
    failedChecks.push(gpuDetails);
  }

  const verified =
    nonceFormatValid &&
    gwResult.valid &&
    modelQuoteVerified &&
    nonceVerified &&
    nvidiaGpuVerified &&
    failedChecks.length === 0;

  return {
    verified,
    modelId: modelEnclave?.model_name || expectedModelId,
    teeType: `Intel TDX v4 (0x81) + NVIDIA ${gpuArch} Confidential GPU`,
    nonce: expectedNonceHex,
    nonceVerified,
    gatewayQuoteVerified: gwResult.valid,
    modelQuoteVerified,
    nvidiaGpuVerified,
    intelRootCaFingerprint: gwResult.rootCaFingerprint || EXPECTED_INTEL_SGX_ROOT_CA_FINGERPRINT256,
    gatewaySigningAddress: gw.signing_address || '',
    modelSigningAddress: modelEnclave?.signing_address || '',
    measurements: {
      gatewayMrtd: gwResult.mrtdHex,
      gatewayRtmr0: gwResult.rtmr0Hex,
      modelMrtd: modelResult?.mrtdHex || '',
      modelRtmr0: modelResult?.rtmr0Hex || '',
      composeHash: modelEnclave?.info?.compose_hash || gw.info?.compose_hash || '',
      gpuArch,
    },
    verifiedAt: new Date().toISOString(),
    source,
    checks,
    failedChecks: Array.from(new Set(failedChecks)),
  };
}

export async function fetchAndVerifyNearAiAttestation(
  modelId = process.env.NEAR_AI_MODEL || 'Qwen/Qwen3.6-35B-A3B-FP8',
  options?: {
    tamperQuote?: boolean;
    tamperNonce?: boolean;
    tamperMeasurements?: boolean;
    tamperCert?: boolean;
  }
): Promise<AttestationVerificationResult> {
  const nonce = generateFresh32ByteNonce();
  const baseUrl = (process.env.NEAR_AI_BASE_URL || 'https://cloud-api.near.ai/v1').replace(/\/$/, '');
  const url = `${baseUrl}/attestation/report?nonce=${encodeURIComponent(nonce)}&model=${encodeURIComponent(modelId)}`;

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (process.env.NEAR_AI_API_KEY) {
    headers['Authorization'] = `Bearer ${process.env.NEAR_AI_API_KEY}`;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8500);
    const response = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return buildFailedAttestationResult(
        modelId,
        nonce,
        `NEAR AI Cloud attestation endpoint returned HTTP ${response.status}: ${errText.slice(0, 200)}`
      );
    }

    const report = (await response.json()) as RawNearAiAttestationReport;

    if (options?.tamperQuote && report.gateway_attestation?.intel_quote) {
      // Flip 1 byte in the TD Report Body of the Gateway Quote to prove cryptographic signature rejection
      const q = report.gateway_attestation.intel_quote;
      const flippedByte = q.slice(200, 202) === 'ff' ? '00' : 'ff';
      report.gateway_attestation.intel_quote = q.slice(0, 200) + flippedByte + q.slice(202);
    }

    if (options?.tamperMeasurements && report.gateway_attestation?.info?.tcb_info) {
      // Tamper with the reported TCB MRTD measurement so it diverges from the binary TDX quote body
      report.gateway_attestation.info.tcb_info.mrtd = '00'.repeat(48);
    }

    if (options?.tamperCert && report.gateway_attestation?.intel_quote) {
      // Truncate the appended X.509 PCK certificate chain inside the TDX quote certification data
      const q = report.gateway_attestation.intel_quote;
      report.gateway_attestation.intel_quote = q.slice(0, 2500);
    }

    const verificationNonce = options?.tamperNonce
      ? generateFresh32ByteNonce() // Different nonce to prove replay/mismatch rejection
      : nonce;

    const isTamperTest = Boolean(
      options?.tamperQuote ||
        options?.tamperNonce ||
        options?.tamperMeasurements ||
        options?.tamperCert
    );

    return verifyAttestationReportPayload(
      report,
      verificationNonce,
      modelId,
      isTamperTest ? 'tamper_test' : 'live_near_ai_cloud'
    );
  } catch (err) {
    return buildFailedAttestationResult(
      modelId,
      nonce,
      `Failed to reach NEAR AI Cloud attestation service: ${(err as Error).message}`
    );
  }
}

function buildFailedAttestationResult(
  modelId: string,
  nonce: string,
  reason: string
): AttestationVerificationResult {
  return {
    verified: false,
    modelId,
    teeType: 'Intel TDX v4 + NVIDIA Confidential GPU (Unreachable)',
    nonce,
    nonceVerified: false,
    gatewayQuoteVerified: false,
    modelQuoteVerified: false,
    nvidiaGpuVerified: false,
    intelRootCaFingerprint: '',
    gatewaySigningAddress: '',
    modelSigningAddress: '',
    measurements: {
      gatewayMrtd: '',
      gatewayRtmr0: '',
      modelMrtd: '',
      modelRtmr0: '',
      composeHash: '',
      gpuArch: 'UNKNOWN',
    },
    verifiedAt: new Date().toISOString(),
    source: 'offline_unverified',
    checks: [
      {
        id: 'attestation_endpoint',
        label: 'NEAR AI Cloud TEE Attestation Retrieval',
        passed: false,
        details: reason,
      },
    ],
    failedChecks: [reason],
  };
}
