import React from 'react';
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
  const isVerified = attestation.verified && attestation.failedChecks.length === 0;

  return (
    <div
      className={`rounded-xl border transition-all ${
        isVerified
          ? 'border-emerald-500/40 bg-emerald-950/20'
          : 'border-rose-500/60 bg-rose-950/30'
      } p-5`}
    >
      {/* Top Header Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-11 w-11 items-center justify-center rounded-lg border ${
              isVerified
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400'
                : 'border-rose-500/50 bg-rose-500/20 text-rose-400'
            }`}
          >
            {isVerified ? <ShieldCheck className="h-6 w-6" /> : <ShieldAlert className="h-6 w-6" />}
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <span
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-0.5 text-xs font-bold tracking-wider uppercase ${
                  isVerified
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-rose-500/25 text-rose-300 border border-rose-500/50'
                }`}
              >
                {isVerified ? 'PRIVATE AI — VERIFIED' : 'PRIVATE AI — ATTESTATION FAILED'}
              </span>
              <span className="text-xs font-mono text-slate-400">
                {attestation.source === 'live_near_ai_cloud'
                  ? 'Live NEAR AI Cloud TEE'
                  : attestation.source === 'tamper_test'
                    ? 'Tamper Test Payload'
                    : 'Offline / Unverified'}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-300">
              {isVerified
                ? 'Cryptographic Intel TDX Quote v4 signature, SGX Root CA chain, NVIDIA Hopper GPU evidence, and 32-byte session nonce verified.'
                : 'WARNING: Hardware TEE attestation failed cryptographic verification. Do not trust analysis as confidential.'}
            </p>
          </div>
        </div>

        {onRunLiveVerify && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={verifying}
              onClick={() => onRunLiveVerify({})}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${verifying ? 'animate-spin' : ''}`} />
              Verify Fresh Live Nonce
            </button>
            <button
              type="button"
              disabled={verifying}
              onClick={() => onRunLiveVerify({ tamperQuote: true })}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/20 disabled:opacity-50 cursor-pointer"
              title="Flips 1 byte inside the binary Intel TDX Quote to prove cryptographic signature rejection"
            >
              <Bug className="h-3.5 w-3.5" />
              Test Tampered Quote
            </button>
            <button
              type="button"
              disabled={verifying}
              onClick={() => onRunLiveVerify({ tamperNonce: true })}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/20 disabled:opacity-50 cursor-pointer"
              title="Challenges verifier with a mismatched nonce to prove replay protection"
            >
              <Bug className="h-3.5 w-3.5" />
              Test Replay Nonce
            </button>
          </div>
        )}
      </div>

      {/* Key Cryptographic Telemetry Grid */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Cpu className="h-3.5 w-3.5 text-slate-400" />
            TEE Model Identifier
          </div>
          <div className="mt-1 font-mono text-xs font-semibold text-slate-100 break-all">
            {attestation.modelId}
          </div>
          <div className="mt-1 text-[11px] text-slate-400">{attestation.teeType}</div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <KeyRound className="h-3.5 w-3.5 text-slate-400" />
            Fresh 32-Byte Session Nonce
          </div>
          <div className="mt-1 font-mono text-[11px] text-slate-200 break-all">
            {attestation.nonce}
          </div>
          <div className="mt-1 flex items-center gap-1 text-[11px]">
            {attestation.nonceVerified ? (
              <span className="text-emerald-400 font-medium">✓ Bound in TDX & GPU REPORTDATA</span>
            ) : (
              <span className="text-rose-400 font-medium">✗ Nonce Binding Failed</span>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <ShieldCheck className="h-3.5 w-3.5 text-slate-400" />
            Enclave Signing Identities
          </div>
          <div className="mt-1 text-[11px] text-slate-300 font-mono break-all">
            <span className="text-slate-400">GW (ed25519):</span>{' '}
            {attestation.gatewaySigningAddress
              ? `${attestation.gatewaySigningAddress.slice(0, 18)}...`
              : 'N/A'}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-300 font-mono break-all">
            <span className="text-slate-400">Model (ecdsa):</span>{' '}
            {attestation.modelSigningAddress || 'N/A'}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Clock className="h-3.5 w-3.5 text-slate-400" />
            Verification Timestamp & Root CA
          </div>
          <div className="mt-1 font-mono text-xs text-slate-200">
            {new Date(attestation.verifiedAt).toISOString()}
          </div>
          <div className="mt-1 font-mono text-[10px] text-slate-400 truncate" title={attestation.intelRootCaFingerprint}>
            Intel Root SHA256: {attestation.intelRootCaFingerprint.slice(0, 26)}...
          </div>
        </div>
      </div>

      {/* Failed Checks Warning Box */}
      {attestation.failedChecks.length > 0 && (
        <div className="mt-4 rounded-lg border border-rose-500/50 bg-rose-950/60 p-3">
          <div className="text-xs font-bold uppercase tracking-wider text-rose-300">
            Failed Cryptographic Verification Checks ({attestation.failedChecks.length})
          </div>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs text-rose-200 font-mono">
            {attestation.failedChecks.map((fc, idx) => (
              <li key={idx}>{fc}</li>
            ))}
          </ul>
        </div>
      )}

      {!compact && (
        <>
          {/* Individual Verification Check Matrix */}
          <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
            {attestation.checks.map((chk) => (
              <div
                key={chk.id}
                className={`flex items-start gap-2.5 rounded-lg border p-2.5 text-xs ${
                  chk.passed
                    ? 'border-slate-800 bg-slate-900/60 text-slate-200'
                    : 'border-rose-500/40 bg-rose-950/40 text-rose-200'
                }`}
              >
                {chk.passed ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{chk.label}</div>
                  <div className="mt-0.5 text-[11px] text-slate-400 break-words">{chk.details}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Hardware Measurements Footer */}
          <div className="mt-4 rounded-lg border border-slate-800/90 bg-slate-950/80 p-3 font-mono text-[11px] text-slate-400">
            <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
              <div className="truncate" title={attestation.measurements.gatewayMrtd}>
                <span className="text-slate-500">Gateway MRTD:</span>{' '}
                <span className="text-slate-300">
                  {attestation.measurements.gatewayMrtd || 'N/A'}
                </span>
              </div>
              <div className="truncate" title={attestation.measurements.modelMrtd}>
                <span className="text-slate-500">Model MRTD:</span>{' '}
                <span className="text-slate-300">
                  {attestation.measurements.modelMrtd || 'N/A'}
                </span>
              </div>
              <div className="truncate" title={attestation.measurements.modelRtmr0}>
                <span className="text-slate-500">Model RTMR0:</span>{' '}
                <span className="text-slate-300">
                  {attestation.measurements.modelRtmr0 || 'N/A'}
                </span>
              </div>
              <div className="truncate">
                <span className="text-slate-500">Privacy Guarantee:</span>{' '}
                <span className="text-emerald-400">
                  Raw invoice buffer zeroed in RAM; zero raw document storage
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
