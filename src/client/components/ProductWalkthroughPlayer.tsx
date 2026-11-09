import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  RotateCcw,
  Upload,
  ShieldCheck,
  Building2,
  ShieldAlert,
  CheckCircle2,
  Lock,
  ArrowRight,
  Sparkles,
  FileText,
} from 'lucide-react';

const TOTAL_DURATION_SEC = 35;

interface WalkthroughStep {
  id: number;
  title: string;
  shortLabel: string;
  startSec: number;
  endSec: number;
  narration: string;
}

const WALKTHROUGH_STEPS: WalkthroughStep[] = [
  {
    id: 0,
    title: '1. Effortless Invoice Upload',
    shortLabel: '1. Upload',
    startSec: 0,
    endSec: 7,
    narration:
      'Drop any PDF or text invoice into STEWARD. Your document is read strictly in ephemeral memory and never saved to disk.',
  },
  {
    id: 1,
    title: '2. Private AI Extraction',
    shortLabel: '2. Private AI',
    startSec: 7,
    endSec: 14,
    narration:
      'NEAR AI Cloud extracts line items inside a hardware-verified Intel TDX & NVIDIA Hopper enclave, then zeroes out the raw text.',
  },
  {
    id: 2,
    title: '3. Vendor Verification',
    shortLabel: '3. Verify Vendor',
    startSec: 14,
    endSec: 21,
    narration:
      'STEWARD cross-checks the vendor and wallet against your Verified Vendor Registry and enforces a 48-hour lock on wallet changes.',
  },
  {
    id: 3,
    title: '4. Real-Time Fraud Detection',
    shortLabel: '4. Fraud Blocked',
    startSec: 21,
    endSec: 28,
    narration:
      'If a malicious invoice tries to swap the wallet address or inject hidden AI instructions, deterministic security rules block it immediately.',
  },
  {
    id: 4,
    title: '5. Cross-Chain Payment Completion',
    shortLabel: '5. Exact Payout',
    startSec: 28,
    endSec: 35,
    narration:
      'Approved invoices settle automatically via NEAR Intents so your vendor receives exact-output USDC on their preferred network.',
  },
];

export const ProductWalkthroughPlayer: React.FC<{
  onLaunchDemo?: () => void;
}> = ({ onLaunchDemo }) => {
  const [hasStarted, setHasStarted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [elapsedSec, setElapsedSec] = useState(0);
  const lastStepRef = useRef<number>(-1);

  const currentStepIndex = Math.min(
    WALKTHROUGH_STEPS.length - 1,
    Math.floor(elapsedSec / 7)
  );
  const currentStep = WALKTHROUGH_STEPS[currentStepIndex];

  const playChime = useCallback(
    (freq = 520) => {
      if (isMuted || typeof window === 'undefined') return;
      try {
        const AudioCtx =
          window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gain.gain.setValueAtTime(0.04, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.18);
      } catch {
        // Ignore audio context blocks
      }
    },
    [isMuted]
  );

  useEffect(() => {
    if (!isPlaying) return;
    const interval = window.setInterval(() => {
      setElapsedSec((prev) => {
        const next = prev + 0.25;
        if (next >= TOTAL_DURATION_SEC) {
          setIsPlaying(false);
          return TOTAL_DURATION_SEC;
        }
        return next;
      });
    }, 250);
    return () => window.clearInterval(interval);
  }, [isPlaying]);

  useEffect(() => {
    if (isPlaying && currentStepIndex !== lastStepRef.current) {
      lastStepRef.current = currentStepIndex;
      playChime(440 + currentStepIndex * 65);
    }
  }, [currentStepIndex, isPlaying, playChime]);

  const handleStartOrTogglePlay = () => {
    if (!hasStarted) {
      setHasStarted(true);
      setElapsedSec(0);
      setIsPlaying(true);
      return;
    }
    if (elapsedSec >= TOTAL_DURATION_SEC) {
      setElapsedSec(0);
      setIsPlaying(true);
      return;
    }
    setIsPlaying((p) => !p);
  };

  const handleSelectStep = (idx: number) => {
    setHasStarted(true);
    setElapsedSec(idx * 7);
    setIsPlaying(true);
  };

  const formatTime = (sec: number) => {
    const whole = Math.floor(sec);
    const s = whole % 60;
    return `0:${s < 10 ? `0${s}` : s}`;
  };

  return (
    <div className="relative rounded-2xl border border-[#E6EAE2] bg-white shadow-[0_20px_50px_rgba(18,61,50,0.10)] overflow-hidden">
      {/* Top Window Chrome */}
      <div className="flex items-center justify-between border-b border-[#E6EAE2] bg-[#F7F8F3] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[#D9534F]/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#D99A32]/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#23845B]/70" />
          <span className="ml-2 text-xs font-semibold text-[#18251F]">
            STEWARD — Interactive Product Walkthrough (0:35)
          </span>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EDF8D8] px-2.5 py-0.5 text-[11px] font-semibold text-[#123D32] border border-[#C7F36B]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#23845B]" />
          Live UI Preview
        </span>
      </div>

      {/* Step Chapter Pills */}
      <div className="grid grid-cols-5 border-b border-[#E6EAE2] bg-[#F0F3EC]/60 px-2 py-1.5 gap-1">
        {WALKTHROUGH_STEPS.map((st, idx) => {
          const active = hasStarted && currentStepIndex === idx;
          const completed = hasStarted && currentStepIndex > idx;
          return (
            <button
              key={st.id}
              type="button"
              onClick={() => handleSelectStep(idx)}
              className={`rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-all cursor-pointer truncate ${
                active
                  ? 'bg-[#123D32] text-white shadow-xs'
                  : completed
                    ? 'bg-[#E8F5EC] text-[#23845B]'
                    : 'text-[#78847C] hover:bg-white/80 hover:text-[#18251F]'
              }`}
            >
              {st.shortLabel}
            </button>
          );
        })}
      </div>

      {/* Main Stage Area */}
      <div className="relative min-h-[340px] sm:min-h-[370px] bg-gradient-to-b from-white to-[#F7F8F3] p-5 sm:p-6 flex flex-col justify-between">
        {/* Thumbnail Overlay before user clicks Play */}
        {!hasStarted && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#123D32]/92 p-6 text-center text-white backdrop-blur-[2px]">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1 text-xs font-medium text-[#C7F36B] border border-white/15 mb-4">
              <Sparkles className="h-3.5 w-3.5" />
              35-Second Interactive Product Walkthrough
            </div>
            <h3 className="font-display text-xl sm:text-2xl font-bold max-w-md leading-snug">
              See how STEWARD verifies vendors, blocks fraud, and pays bills automatically
            </h3>
            <p className="mt-2 text-xs sm:text-sm text-white/80 max-w-md">
              Built with real STEWARD interface components — watch the 5-step journey from invoice upload to cross-chain settlement.
            </p>
            <button
              type="button"
              onClick={handleStartOrTogglePlay}
              aria-label="Play 35-second product walkthrough"
              className="mt-6 group inline-flex items-center gap-3 rounded-full bg-[#C7F36B] px-6 py-3.5 text-sm font-bold text-[#123D32] shadow-lg hover:bg-[#d4f788] transition-all cursor-pointer"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#123D32] text-[#C7F36B] group-hover:scale-105 transition-transform">
                <Play className="h-4 w-4 fill-current ml-0.5" />
              </span>
              Watch Product Walkthrough (0:35)
            </button>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-4 text-[11px] text-white/75">
              <span>1. Upload PDF</span>
              <span>•</span>
              <span>2. Private AI</span>
              <span>•</span>
              <span>3. Vendor Match</span>
              <span>•</span>
              <span>4. Fraud Block</span>
              <span>•</span>
              <span>5. Instant Payout</span>
            </div>
          </div>
        )}

        {/* Active Step Header */}
        <div className="flex items-center justify-between gap-2">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#237A57]">
              Step {currentStepIndex + 1} of 5
            </span>
            <h4 className="font-display text-base sm:text-lg font-bold text-[#18251F]">
              {currentStep.title}
            </h4>
          </div>
          <span className="rounded-lg bg-[#F0F3EC] px-2.5 py-1 font-mono text-xs font-semibold text-[#123D32]">
            INV-2026-1041
          </span>
        </div>

        {/* Dynamic Real UI Component Stage */}
        <div className="my-4 flex-1 flex flex-col justify-center">
          {currentStepIndex === 0 && (
            <div className="rounded-xl border-2 border-dashed border-[#237A57]/40 bg-[#F7F8F3] p-5 text-center animate-fade-in">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#EDF8D8] text-[#123D32]">
                <Upload className="h-6 w-6" />
              </div>
              <div className="mt-3 font-display text-sm font-bold text-[#18251F]">
                lagos-design-sprint-4.pdf received in Ephemeral RAM
              </div>
              <p className="mt-1 text-xs text-[#78847C]">
                142 KB PDF • Zero disk persistence • Prepared for Private AI extraction
              </p>
              <div className="mt-4 inline-flex items-center gap-2 rounded-lg bg-white px-3.5 py-2 text-xs font-medium text-[#123D32] border border-[#E6EAE2] shadow-2xs">
                <FileText className="h-4 w-4 text-[#23845B]" />
                <span>Lagos Design Studio Ltd — $185.00 USDC</span>
                <span className="rounded bg-[#E8F5EC] px-2 py-0.5 text-[10px] font-bold text-[#23845B]">
                  RAM BUFFER READY
                </span>
              </div>
            </div>
          )}

          {currentStepIndex === 1 && (
            <div className="rounded-xl border border-[#E6EAE2] bg-white p-4 shadow-xs space-y-3 animate-fade-in">
              <div className="flex items-center justify-between border-b border-[#E6EAE2] pb-2.5">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-[#23845B]" />
                  <span className="text-xs font-bold text-[#123D32]">
                    Private AI Environment Verified
                  </span>
                </div>
                <span className="rounded-full bg-[#EDF8D8] px-2.5 py-0.5 text-[10px] font-bold text-[#123D32]">
                  Intel TDX + NVIDIA Hopper TEE
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2.5 text-xs">
                <div className="rounded-lg bg-[#F7F8F3] p-2.5">
                  <div className="text-[11px] text-[#78847C]">Extracted Vendor</div>
                  <div className="font-semibold text-[#18251F] mt-0.5">
                    Lagos Design Studio Ltd
                  </div>
                </div>
                <div className="rounded-lg bg-[#F7F8F3] p-2.5">
                  <div className="text-[11px] text-[#78847C]">Verified Line-Item Total</div>
                  <div className="font-mono font-bold text-[#123D32] mt-0.5 tabular-nums">
                    $185.00 USDC ($150 + $35)
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-[#E8F5EC]/70 px-3 py-2 text-[11px] text-[#123D32]">
                <span>✓ Session Nonce Bound to Hardware Quote</span>
                <span className="font-semibold">Raw Document Deleted from RAM</span>
              </div>
            </div>
          )}

          {currentStepIndex === 2 && (
            <div className="rounded-xl border border-[#E6EAE2] bg-white p-4 shadow-xs space-y-3 animate-fade-in">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-[#123D32]" />
                  <span className="text-xs font-bold text-[#18251F]">
                    Verified Vendor Registry Check
                  </span>
                </div>
                <span className="rounded-full bg-[#E8F5EC] px-2.5 py-0.5 text-[11px] font-bold text-[#23845B]">
                  ✓ Exact Registry Match
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                <div className="rounded-lg border border-[#E6EAE2] bg-[#F7F8F3] p-3">
                  <div className="text-[11px] text-[#78847C]">Invoice Requested Wallet</div>
                  <div className="mt-1 font-mono font-semibold text-[#18251F]">
                    lagos-studio.near
                  </div>
                </div>
                <div className="rounded-lg border border-[#23845B]/30 bg-[#E8F5EC]/50 p-3">
                  <div className="text-[11px] text-[#23845B]">Verified Registry Wallet</div>
                  <div className="mt-1 font-mono font-semibold text-[#123D32]">
                    lagos-studio.near
                  </div>
                </div>
              </div>
              <div className="text-xs text-[#78847C] flex items-center justify-between pt-1">
                <span>48-Hour Address Cooling-Off Lock: Clear</span>
                <span className="font-semibold text-[#23845B]">14 Prior Verified Payments</span>
              </div>
            </div>
          )}

          {currentStepIndex === 3 && (
            <div className="rounded-xl border border-[#D9534F]/40 bg-[#FCEDEC]/60 p-4 space-y-2.5 animate-fade-in">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5 text-[#D9534F]" />
                  <span className="text-xs font-bold text-[#B8322E]">
                    Malicious Invoice Blocked Automatically (INV-2026-6660)
                  </span>
                </div>
                <span className="rounded-full bg-[#D9534F] px-2.5 py-0.5 text-[10px] font-bold text-white uppercase">
                  BLOCKED
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-white p-2.5 border border-[#E6EAE2]">
                  <span className="text-[10px] uppercase font-bold text-[#78847C]">
                    Verified Wallet on File
                  </span>
                  <div className="font-mono font-semibold text-[#23845B] mt-0.5">
                    lagos-studio.near
                  </div>
                </div>
                <div className="rounded-lg bg-white p-2.5 border border-[#D9534F]/40">
                  <span className="text-[10px] uppercase font-bold text-[#B8322E]">
                    Attacker Redirect Attempt
                  </span>
                  <div className="font-mono font-semibold text-[#D9534F] mt-0.5">
                    attacker-drain.near
                  </div>
                </div>
              </div>
              <p className="text-xs text-[#18251F] bg-white/90 rounded-lg p-2.5 border border-[#D9534F]/25">
                <strong>Why STEWARD stopped this:</strong> Hidden prompt-injection instructions tried to redirect payment to an unverified wallet. $0.00 left your account.
              </p>
            </div>
          )}

          {currentStepIndex === 4 && (
            <div className="rounded-xl border border-[#23845B]/35 bg-[#E8F5EC]/40 p-4 space-y-3 animate-fade-in">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-[#23845B]" />
                  <span className="text-xs font-bold text-[#123D32]">
                    Legitimate Invoice Settled via NEAR Intents
                  </span>
                </div>
                <span className="rounded-full bg-[#123D32] px-2.5 py-0.5 text-[10px] font-bold text-[#C7F36B]">
                  PAID • $185.00 USDC
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-lg bg-white p-2.5 border border-[#E6EAE2]">
                  <div className="text-[10px] text-[#78847C]">Exact Output</div>
                  <div className="font-mono font-bold text-[#23845B] mt-0.5 tabular-nums">
                    185.00 USDC
                  </div>
                </div>
                <div className="rounded-lg bg-white p-2.5 border border-[#E6EAE2]">
                  <div className="text-[10px] text-[#78847C]">Recipient</div>
                  <div className="font-mono font-semibold text-[#18251F] mt-0.5 truncate">
                    lagos-studio.near
                  </div>
                </div>
                <div className="rounded-lg bg-white p-2.5 border border-[#E6EAE2]">
                  <div className="text-[10px] text-[#78847C]">Audit Ledger</div>
                  <div className="font-semibold text-[#123D32] mt-0.5">CSV Ready ✓</div>
                </div>
              </div>
              {onLaunchDemo && (
                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={onLaunchDemo}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#123D32] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#1B5545] cursor-pointer"
                  >
                    Try It Yourself in the Live Workspace
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Subtitle / Narration Bar */}
        <div className="rounded-xl bg-[#F0F3EC] px-3.5 py-2.5 text-xs text-[#18251F] border border-[#E6EAE2]">
          {currentStep.narration}
        </div>
      </div>

      {/* Player Controls Footer */}
      <div className="border-t border-[#E6EAE2] bg-[#F7F8F3] px-4 py-3">
        {/* Progress Scrubber */}
        <div
          className="relative h-2 w-full rounded-full bg-[#E6EAE2] cursor-pointer overflow-hidden mb-3"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            setHasStarted(true);
            setElapsedSec(ratio * TOTAL_DURATION_SEC);
          }}
        >
          <div
            className="h-full rounded-full bg-[#123D32] transition-all duration-200"
            style={{ width: `${(elapsedSec / TOTAL_DURATION_SEC) * 100}%` }}
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleStartOrTogglePlay}
              aria-label={isPlaying ? 'Pause walkthrough' : 'Play walkthrough'}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#123D32] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1B5545] cursor-pointer"
            >
              {isPlaying ? (
                <>
                  <Pause className="h-3.5 w-3.5" />
                  <span>Pause</span>
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5 fill-current" />
                  <span>{elapsedSec >= TOTAL_DURATION_SEC ? 'Replay' : 'Play'}</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setHasStarted(true);
                setElapsedSec(0);
                setIsPlaying(true);
              }}
              aria-label="Restart walkthrough"
              className="rounded-lg border border-[#E6EAE2] bg-white p-1.5 text-[#78847C] hover:text-[#18251F] cursor-pointer"
              title="Restart from Step 1"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={() => setIsMuted((m) => !m)}
              aria-label={isMuted ? 'Unmute audio cues' : 'Mute audio cues'}
              className="inline-flex items-center gap-1 rounded-lg border border-[#E6EAE2] bg-white px-2.5 py-1.5 text-xs font-medium text-[#18251F] hover:bg-[#F0F3EC] cursor-pointer"
              title={isMuted ? 'Unmute step audio cues' : 'Mute step audio cues'}
            >
              {isMuted ? (
                <>
                  <VolumeX className="h-3.5 w-3.5 text-[#78847C]" />
                  <span className="hidden sm:inline text-[#78847C]">Muted</span>
                </>
              ) : (
                <>
                  <Volume2 className="h-3.5 w-3.5 text-[#23845B]" />
                  <span className="hidden sm:inline text-[#123D32]">Sound On</span>
                </>
              )}
            </button>
          </div>

          <div className="flex items-center gap-2 font-mono text-xs text-[#78847C] tabular-nums">
            <Lock className="h-3.5 w-3.5 text-[#23845B]" />
            <span>
              {formatTime(elapsedSec)} / {formatTime(TOTAL_DURATION_SEC)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
