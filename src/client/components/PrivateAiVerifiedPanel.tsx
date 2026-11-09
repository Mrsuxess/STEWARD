import React, { useState } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Cpu,
  KeyRound,
  Clock,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Bug,
  ChevronDown,
  ChevronUp,
  Lock,
} from 'lucide-react';
import type { AttestationVerificationResult } from '../../shared/types.js';

interface Props {
  attestation: AttestationVerificationResult;
  onRunLiveVerify?: (opts?: { tamperQuote?: boolean; tamperNonce?: boolean }) => void;
  verifying?: boolean;
  compact?: boolean;
}

export const PrivateAiVerifiedPanel: React.FC<Props> = ({
  attestation,
  onRunLiveVerify,
  verifying = false,
  compact = false,
}) => {
  const [showTechDetails, setShowTechDetails] = useState(false);

  // Strictly enforce: NEVER show VERIFIED when cryptographic verification has failed or is incomplete
  const isVerified =
    Boolean(attestation.verified) &&
    attestation.failedChecks.length === 0 &&
    attestation.nonceVerified &&
    attestation.gatewayQuoteVerified &&
    attestation.modelQuoteVerified;

  return (
    <div
      className={`rounded-2xl border transition-all p-5 sm:p-6 ${
        isVerified
          ? 'border-[#23845B]/30 bg-white shadow-xs'
          : 'border-[#D9534F]/50 bg-[#FCEDEC]/40 shadow-xs'
      }`}
    >
      {/* Top Header Banner */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border ${
              isVerified
                ? 'border-[#C7F36B] bg-[#123D32] text-[#C7F36B]'
                : 'border-[#D9534F]/40 bg-[#FCEDEC] text-[#D9534F]'
            }`}
          >
            {isVerified ? (
              <ShieldCheck className="h-6 w-6" />
            ) : (
              <ShieldAlert className="h-6 w-6" />
            )}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-0.5 text-xs font-bold ${
                  isVerified
                    ? 'bg-[#EDF8D8] text-[#123D32] border border-[#C7F36B]'
                    : 'bg-[#D9534F] text-white'
                }`}
              >
                {isVerified
                  ? 'Private AI environment verified'
                  : 'Private AI verification failed'}
              </span>
              <span className="rounded-md bg-[#F0F3EC] px-2.5 py-0.5 text-xs font-medium text-[#78847C]">
                {attestation.source === 'live_near_ai_cloud'
                  ? 'NEAR AI Cloud Hardware Enclave'
                  : attestation.source === 'tamper_test'
                    ? 'Simulated Tamper Test'
                    : 'Offline / Unverified Environment'}
              </span>
            </div>
            <p className="mt-1.5 text-xs sm:text-sm text-[#78847C] max-w-3xl">
              {isVerified
                ? 'Your invoice was analyzed inside a hardware-sealed enclave. Cryptographic hardware certificates and a unique session code were verified before reading the results, and raw invoice text was deleted from memory.'
                : 'WARNING: The hardware security certificate or session code did not pass verification. STEWARD does not trust unverified AI environments.'}
            </p>
          </div>
        </div>

        {onRunLiveVerify && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={verifying}
              onClick={() => onRunLiveVerify({})}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#123D32] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1B5545] disabled:opacity-50 transition-colors cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 text-[#C7F36B] ${verifying ? 'animate-spin' : ''}`} />
              <span>Verify Live Hardware Proof</span>
            </button>
            <button
              type="button"
              disabled={verifying}
              onClick={() => onRunLiveVerify({ tamperQuote: true })}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#D99A32]/40 bg-[#FFF5DF] px-3 py-2 text-xs font-semibold text-[#9A6700] hover:bg-[#FFF5DF]/80 disabled:opacity-50 transition-colors cursor-pointer"
              title="Flips 1 byte inside the Intel TDX hardware quote to verify that STEWARD catches tampered enclaves"
            >
              <Bug className="h-3.5 w-3.5" />
              <span>Test Tampered Quote</span>
            </button>
            <button
              type="button"
              disabled={verifying}
              onClick={() => onRunLiveVerify({ tamperNonce: true })}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#D9534F]/35 bg-[#FCEDEC] px-3 py-2 text-xs font-semibold text-[#B8322E] hover:bg-[#FCEDEC]/80 disabled:opacity-50 transition-colors cursor-pointer"
              title="Tests a mismatched session nonce to verify replay protection"
            >
              <Bug className="h-3.5 w-3.5" />
              <span>Test Replay Nonce</span>
            </button>
          </div>
        )}
      </div>

      {/* Understandable 5-Item Summary Grid (Section 7) */}
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] p-3.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-[#78847C]">
            <Cpu className="h-3.5 w-3.5 text-[#123D32]" />
            <span>Model Information</span>
          </div>
          <div className="mt-1 font-display text-xs sm:text-sm font-bold text-[#18251F] truncate" title={attestation.modelId}>
            {attestation.modelId}
          </div>
          <div className="mt-0.5 text-[11px] text-[#78847C]">Extraction only (Zero payment tools)</div>
        </div>

        <div className="rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] p-3.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-[#78847C]">
            <Lock className="h-3.5 w-3.5 text-[#123D32]" />
            <span>TEE Status</span>
          </div>
          <div className="mt-1 font-display text-xs sm:text-sm font-bold text-[#18251F] truncate" title={attestation.teeType}>
            {attestation.teeType}
          </div>
          <div className="mt-0.5 text-[11px] text-[#23845B] font-medium">
            Isolated hardware memory
          </div>
        </div>

        <div className="rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] p-3.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-[#78847C]">
            <ShieldCheck className="h-3.5 w-3.5 text-[#123D32]" />
            <span>Attestation Verification</span>
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            {isVerified ? (
              <span className="text-xs sm:text-sm font-bold text-[#23845B]">
                ✓ Cryptographically Verified
              </span>
            ) : (
              <span className="text-xs sm:text-sm font-bold text-[#D9534F]">
                ✗ Verification Failed
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[11px] text-[#78847C]">
            {attestation.checks.filter((c) => c.passed).length}/{attestation.checks.length} hardware checks passed
          </div>
        </div>

        <div className="rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] p-3.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-[#78847C]">
            <KeyRound className="h-3.5 w-3.5 text-[#123D32]" />
            <span>Nonce Verification</span>
          </div>
          <div className="mt-1">
            {attestation.nonceVerified ? (
              <span className="text-xs sm:text-sm font-bold text-[#23845B]">
                ✓ Fresh Session Bound
              </span>
            ) : (
              <span className="text-xs sm:text-sm font-bold text-[#D9534F]">
                ✗ Session Mismatch
              </span>
            )}
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-[#78847C] truncate" title={attestation.nonce}>
            {attestation.nonce.slice(0, 20)}...
          </div>
        </div>

        <div className="rounded-xl border border-[#E6EAE2] bg-[#F7F8F3] p-3.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-[#78847C]">
            <Clock className="h-3.5 w-3.5 text-[#123D32]" />
            <span>Verification Timestamp</span>
          </div>
          <div className="mt-1 font-mono text-xs font-bold text-[#18251F]">
            {new Date(attestation.verifiedAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </div>
          <div className="mt-0.5 text-[11px] text-[#78847C]">
            {new Date(attestation.verifiedAt).toLocaleDateString()}
          </div>
        </div>
      </div>

      {/* Failed Checks Warning Box (Always visible when verification fails) */}
      {attestation.failedChecks.length > 0 && (
        <div className="mt-4 rounded-xl border border-[#D9534F]/40 bg-[#FCEDEC] p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-[#B8322E]">
            Why Verification Was Rejected ({attestation.failedChecks.length} Failed Check
            {attestation.failedChecks.length > 1 ? 's' : ''})
          </div>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs text-[#18251F] font-mono">
            {attestation.failedChecks.map((fc, idx) => (
              <li key={idx}>{fc}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Expandable Technical Cryptographic Details for Judges */}
      {!compact && (
        <div className="mt-4 border-t border-[#E6EAE2] pt-3">
          <button
            type="button"
            onClick={() => setShowTechDetails((prev) => !prev)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#123D32] hover:text-[#237A57] cursor-pointer"
          >
            <span>
              {showTechDetails
                ? 'Hide technical cryptographic verification details'
                : 'Inspect cryptographic TEE quotes, nonces & hardware measurements'}
            </span>
            {showTechDetails ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>

          {showTechDetails && (
            <div className="mt-3 space-y-3 animate-fade-in">
              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                {attestation.checks.map((chk) => (
                  <div
                    key={chk.id}
                    className={`flex items-start gap-2.5 rounded-xl border p-3 text-xs ${
                      chk.passed
                        ? 'border-[#E6EAE2] bg-[#F7F8F3] text-[#18251F]'
                        : 'border-[#D9534F]/40 bg-[#FCEDEC] text-[#B8322E]'
                    }`}
                  >
                    {chk.passed ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#23845B]" />
                    ) : (
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#D9534F]" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">{chk.label}</div>
                      <div className="mt-0.5 text-[11px] text-[#78847C] break-words font-mono">
                        {chk.details}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-[#E6EAE2] bg-[#F0F3EC] p-3.5 font-mono text-[11px] text-[#18251F] space-y-1.5">
                <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
                  <div className="truncate" title={attestation.nonce}>
                    <span className="text-[#78847C]">Session Nonce (32B):</span> {attestation.nonce}
                  </div>
                  <div className="truncate" title={attestation.intelRootCaFingerprint}>
                    <span className="text-[#78847C]">Intel Root CA SHA256:</span>{' '}
                    {attestation.intelRootCaFingerprint}
                  </div>
                  <div className="truncate" title={attestation.measurements.gatewayMrtd}>
                    <span className="text-[#78847C]">Gateway MRTD:</span>{' '}
                    {attestation.measurements.gatewayMrtd || 'N/A'}
                  </div>
                  <div className="truncate" title={attestation.measurements.modelMrtd}>
                    <span className="text-[#78847C]">Model MRTD:</span>{' '}
                    {attestation.measurements.modelMrtd || 'N/A'}
                  </div>
                  <div className="truncate" title={attestation.gatewaySigningAddress}>
                    <span className="text-[#78847C]">Gateway Signing Key:</span>{' '}
                    {attestation.gatewaySigningAddress || 'N/A'}
                  </div>
                  <div className="truncate" title={attestation.modelSigningAddress}>
                    <span className="text-[#78847C]">Model Signing Key:</span>{' '}
                    {attestation.modelSigningAddress || 'N/A'}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
