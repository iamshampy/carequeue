'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getPatientView,
  subscribe,
  callNext,
  markSkipped,
  setComingIn,
  clearArrivalNotice,
  getArrivalNotice,
  getTodayDateKey,
  AVG_CONSULT_MINUTES,
  type PatientView,
} from '../lib/queueStore';

// ─── Wellness facts ──────────────────────────────────────────────────────────

const wellnessFacts = [
  'Adults can aim for at least 150 minutes of moderate activity each week.',
  'A varied diet can include fruits, vegetables, pulses, and whole grains.',
  'For people over 10, WHO recommends at least 400 g of fruits and vegetables each day.',
  'WHO recommends less than 5 g of salt per day for adults.',
  'Water is a simple choice to help stay hydrated through the day.',
  'A short walk is a good way to add movement to your day.',
  'Breaking up long periods of sitting with movement can support an active routine.',
  'Choose a variety of colourful fruits and vegetables across the week.',
  'Pulses such as beans, peas, and lentils can be part of a balanced diet.',
  'Whole grains such as oats and brown rice add variety to meals.',
  'Check food labels to compare salt in packaged foods.',
  'Using herbs and spices can add flavour while using less salt.',
  'Regular movement can support health at every age.',
  'Taking the stairs or walking a short distance adds movement to daily life.',
  'A balanced eating pattern includes a variety of foods, not just one type.',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getOrdinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function triggerGentleVibrate() {
  if (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'vibrate' in navigator &&
    typeof navigator.vibrate === 'function'
  ) {
    try { navigator.vibrate([150, 80, 150]); } catch { /* safe */ }
  }
}

function triggerBriefVibrate() {
  if (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'vibrate' in navigator &&
    typeof navigator.vibrate === 'function'
  ) {
    try { navigator.vibrate(100); } catch { /* safe */ }
  }
}

function playSoftTwoNoteChime() {
  if (typeof window === 'undefined') return;
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const playTone = (freq: number, startDelay: number, duration: number, peakVolume: number) => {
      const startTime = ctx.currentTime + startDelay;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.linearRampToValueAtTime(peakVolume, startTime + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + duration + 0.05);
    };

    playTone(659.25, 0.04, 0.26, 0.12);
    playTone(880.0, 0.32, 0.44, 0.14);

    window.setTimeout(() => { try { ctx.close(); } catch { /* safe */ } }, 1200);
  } catch { /* safe */ }
}

function formatRevisit(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-IN', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PatientWaitingView({ trackingCode }: { trackingCode: string }) {
  // PatientView is the only data source: no full queue is held in state.
  const [view, setView] = useState<PatientView | null>(() => getPatientView(trackingCode));
  const [clinicWaitNotice, setClinicWaitNotice] = useState('');
  const [hasAcknowledgedTurn, setHasAcknowledgedTurn] = useState(false);
  const [factIndex, setFactIndex] = useState(0);
  const [factVisible, setFactVisible] = useState(true);

  // ── Refresh from store (privacy-safe) ────────────────────────────────────
  const refresh = useCallback(() => {
    const fresh = getPatientView(trackingCode);
    setView(fresh);

    if (fresh?.booking) {
      const { handle, trackingCode: tc, comingInMinutes, comingInDeadline } = fresh.booking;
      const notice = getArrivalNotice(handle, tc);
      if (notice) {
        setClinicWaitNotice(notice.message);
      } else if (comingInMinutes && comingInDeadline && comingInDeadline > Date.now()) {
        setClinicWaitNotice(
          `The clinic is waiting for you. Please come in within ${comingInMinutes} minutes.`
        );
      } else {
        setClinicWaitNotice('');
      }
    }
  }, [trackingCode]);

  // ── Initial load ─────────────────────────────────────────────────────────
  useEffect(() => {
    refresh();
  }, [refresh]);

  // ── Subscribe once (scoped to booking handle) ─────────────────────────────
  useEffect(() => {
    if (!view?.booking) return;
    const unsub = subscribe(view.booking.handle, () => { refresh(); });
    return unsub;
  }, [view?.booking?.handle, refresh]);

  // ── Wellness fact ticker ───────────────────────────────────────────────────
  useEffect(() => {
    const timer = window.setInterval(() => {
      setFactVisible(false);
      window.setTimeout(() => {
        setFactIndex(i => (i + 1) % wellnessFacts.length);
        setFactVisible(true);
      }, 240);
    }, 15000);
    return () => window.clearInterval(timer);
  }, []);

  // ── Derived state ─────────────────────────────────────────────────────────
  const booking      = view?.booking ?? null;
  const patientsAhead = view?.patientsAhead ?? 0;
  const position      = view?.position ?? 1;
  const nowServing    = view?.nowServing ?? null;
  const initialServing = view?.initialServing ?? 0;

  const today      = booking ? booking.date === getTodayDateKey() : false;
  const patientNum = booking?.queueNumber ?? 0;

  // Clinic and doctor names — read from store via PatientView, never hardcoded.
  const clinicName = view?.clinicName || booking?.handle || '';
  const doctorName = view?.doctorName || '';

  const isYourTurn = today &&
    booking?.status === 'waiting' &&
    (nowServing === patientNum || patientsAhead === 0);
  const isNext = today && patientsAhead === 1;

  // ── Sensory cues on state transitions ────────────────────────────────────
  const prevRef = useRef<{ isYourTurn: boolean; isNext: boolean; initialized: boolean }>({
    isYourTurn: false, isNext: false, initialized: false,
  });

  useEffect(() => {
    if (!today) return;
    const prev = prevRef.current;
    if (isYourTurn && (!prev.initialized || !prev.isYourTurn)) {
      triggerGentleVibrate();
      playSoftTwoNoteChime();
    } else if (isNext && prev.initialized && !prev.isNext && !isYourTurn) {
      triggerBriefVibrate();
    }
    prevRef.current = { isYourTurn, isNext, initialized: true };
  }, [isYourTurn, isNext, today]);

  // ── Screen Wake Lock ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!today || hasAcknowledgedTurn || booking?.status !== 'waiting') return;
    let wakeLock: { release?: () => Promise<void> } | null = null;
    let isMounted = true;

    const requestLock = async () => {
      if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
      try {
        wakeLock = await (navigator as unknown as { wakeLock: { request: (t: string) => Promise<{ release?: () => Promise<void> }> } }).wakeLock.request('screen');
      } catch { /* safe */ }
    };

    requestLock();

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !hasAcknowledgedTurn && isMounted) requestLock();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      isMounted = false;
      document.removeEventListener('visibilitychange', onVisibility);
      if (wakeLock?.release) try { wakeLock.release(); } catch { /* safe */ }
    };
  }, [today, hasAcknowledgedTurn, booking?.status]);

  // ── Document title ────────────────────────────────────────────────────────
  const originalTitleRef = useRef<string | null>(null);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (originalTitleRef.current === null && document.title !== 'Your turn - CareQueue') {
      originalTitleRef.current = document.title || 'CareQueue';
    }
    if (today && isYourTurn) {
      document.title = 'Your turn - CareQueue';
    } else if (originalTitleRef.current !== null) {
      document.title = originalTitleRef.current;
    }
    return () => { if (originalTitleRef.current !== null) document.title = originalTitleRef.current; };
  }, [today, isYourTurn]);

  // ── Progress strip ────────────────────────────────────────────────────────
  let progressPercent = 0;
  if (isYourTurn) {
    progressPercent = 100;
  } else if (nowServing !== null && booking) {
    const totalSteps = patientNum - initialServing;
    if (totalSteps <= 0) {
      progressPercent = 100;
    } else {
      const currentStep = Math.max(0, nowServing - initialServing);
      progressPercent = Math.min(100, Math.max(8, Math.round((currentStep / totalSteps) * 100)));
    }
  }

  // ── Demo controls: call real store functions ──────────────────────────────
  function handleDemoNext() {
    if (!booking) return;
    callNext(booking.handle, booking.date);
    // Refresh is triggered by the broadcast subscriber
  }

  function handleDemoSkipOne() {
    if (!booking) return;
    // We no longer hold the full queue in state. Reach into the view's ahead count
    // to skip the currently-serving patient if this patient is next, or do nothing
    // if no one is ahead. (Full skip-ahead is only possible from the dashboard.)
    if (patientsAhead > 0) {
      // callNext advances whoever is currently serving — from this page
      // that is the most useful action a patient can trigger as demo.
      callNext(booking.handle, booking.date);
    }
  }

  function handleDemoComingIn() {
    if (!booking) return;
    if (clinicWaitNotice) {
      // Clear via the store function so it broadcasts to all tabs.
      clearArrivalNotice(booking.handle, booking.trackingCode);
      setClinicWaitNotice('');
    } else {
      setComingIn(booking.handle, booking.date, booking.id, AVG_CONSULT_MINUTES);
    }
  }

  function handleDemoReset() {
    setHasAcknowledgedTurn(false);
    refresh();
  }

  // ── Derived text ──────────────────────────────────────────────────────────
  const estimatedWaitText = isNext
    ? `~${AVG_CONSULT_MINUTES} mins or less`
    : `~${patientsAhead * AVG_CONSULT_MINUTES} mins`;

  const headline = !today
    ? 'Your appointment is booked'
    : isYourTurn
    ? "It\u2019s your turn"
    : isNext
    ? "You\u2019re next"
    : `You\u2019re ${getOrdinal(position)} in the queue`;

  const statusText = isYourTurn
    ? 'Your turn, please go in'
    : isNext
    ? "You\u2019re next, please be ready"
    : 'Waiting for your turn';

  const dateLabel   = booking
    ? new Date(`${booking.date}T12:00:00`).toLocaleDateString('en-IN', {
        weekday: 'short', month: 'short', day: 'numeric',
      })
    : '';

  // ── Booking not found ─────────────────────────────────────────────────────
  if (!booking) {
    return (
      <div className="patient-waiting-view">
        <div className="patient-ended-state">
          <span className="patient-ended-mark">✗</span>
          <h1>Booking not found</h1>
          <p>We could not find this booking. The link may have expired or the code is invalid.</p>
        </div>
      </div>
    );
  }

  // ── Done state ────────────────────────────────────────────────────────────
  if (booking.status === 'done') {
    const revisitLabel = booking.revisitDate ? formatRevisit(booking.revisitDate) : '';
    return (
      <div className="patient-waiting-view">
        <div className="patient-completed-state">
          <span className="patient-completed-mark">✓</span>
          <p className="patient-completed-kicker">VISIT COMPLETE</p>
          <h1>Thank you for visiting.</h1>
          <p className="patient-completed-message">Your visit has been marked complete.</p>
          {revisitLabel ? (
            <div className="patient-revisit-confirmation">
              <span>Your follow-up is planned for</span>
              <strong>{revisitLabel}</strong>
              <p>The clinic will send you a reminder closer to the date.</p>
            </div>
          ) : (
            <p className="patient-completed-message" style={{ marginTop: 12 }}>
              We hope you are feeling well. Please contact the clinic if you need another appointment.
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── Cancelled state ───────────────────────────────────────────────────────
  if (booking.status === 'cancelled') {
    return (
      <div className="patient-waiting-view">
        <div className="patient-ended-state">
          <span className="patient-ended-mark">✗</span>
          <h1>Appointment cancelled</h1>
          <p>
            This appointment has been marked as cancelled. You can book again from the clinic page.
          </p>
        </div>
      </div>
    );
  }

  // ── Skipped state ─────────────────────────────────────────────────────────
  if (booking.status === 'skipped') {
    return (
      <div className="patient-waiting-view">
        <div className="patient-ended-state">
          <span className="patient-ended-mark">⏸</span>
          <h1>You stepped out</h1>
          <p>
            You were marked as skipped. The clinic assistant may bring you back into the queue.
            Please check with the reception.
          </p>
        </div>
      </div>
    );
  }

  // ── Serving state: same as waiting from the patient's view ───────────────
  // (booking.status === 'waiting' | 'serving')
  // doctorName is derived from the clinic profile via PatientView (see above).

  return (
    <div className="patient-waiting-view">

      {/* Full-screen "your turn" overlay */}
      {today && isYourTurn && !hasAcknowledgedTurn && (
        <div
          className="turn-fullscreen-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="turn-overlay-heading"
        >
          <div className="turn-overlay-content">
            <div className="turn-ring-wrap" aria-hidden="true">
              <div className="turn-pulsing-ring" />
              <div className="turn-tick-badge">
                <span className="turn-tick-icon">✓</span>
              </div>
            </div>

            <h1 id="turn-overlay-heading" className="turn-overlay-title">
              It&apos;s your turn
            </h1>
            <p className="turn-overlay-doctor">Please go in to {doctorName}</p>

            <button
              type="button"
              className="turn-action-button"
              onClick={() => setHasAcknowledgedTurn(true)}
              autoFocus
            >
              I&apos;m going in
            </button>

            {/* Demo bar (visible on overlay) */}
            <div className="turn-overlay-demo-bar" role="group" aria-label="Demo queue simulation">
              <button type="button" className="turn-overlay-demo-btn" onClick={handleDemoNext}>
                Next patient →
              </button>
              <button type="button" className="turn-overlay-demo-btn" onClick={handleDemoReset}>
                Reset demo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="waiting-checkmark" aria-hidden="true">✓</div>
      <p className="waiting-kicker">BOOKING CONFIRMED</p>
      <h1>{headline}</h1>
      <p className="waiting-clinic">{clinicName || 'Clinic'}</p>

      {/* Arrival notice banner */}
      {today && clinicWaitNotice && (
        <div className="clinic-waiting-notice-banner" role="status" aria-live="polite">
          <div className="notice-icon-box" aria-hidden="true">⏱</div>
          <div className="notice-text-wrap">
            <span className="notice-kicker">UPDATE FROM CLINIC</span>
            <p className="notice-text">{clinicWaitNotice}</p>
          </div>
        </div>
      )}

      {/* Main card */}
      <div className={`waiting-position-card ${today && isYourTurn ? 'is-your-turn' : ''}`}>
        {/* Patient name chip */}
        {booking.name && (
          <div className="waiting-card-patient-corner">
            <span className="waiting-patient-pill">{booking.name}</span>
          </div>
        )}

        {today && isYourTurn && hasAcknowledgedTurn ? (
          /* Calm confirmation card */
          <div className="turn-acknowledged-card">
            <div className="turn-ack-icon" aria-hidden="true">✓</div>
            <h2 className="turn-ack-title">Thank you, please go in to {doctorName}</h2>
            <p className="turn-ack-subtitle">Your consultation is ready. Please step into the doctor&apos;s room.</p>
          </div>
        ) : today ? (
          <>
            {/* Now serving / Your number */}
            <div className="waiting-columns-row">
              <div className="waiting-col waiting-col-serving">
                <div className="waiting-col-label">
                  <span className={`waiting-live-dot ${nowServing !== null ? 'is-active' : 'is-idle'}`} />
                  <span>NOW SERVING</span>
                </div>
                <div className="waiting-serving-display">
                  {nowServing !== null ? (
                    <span className="waiting-serving-num">{nowServing}</span>
                  ) : (
                    <span className="waiting-not-started">Not started yet</span>
                  )}
                </div>
              </div>

              <div className="waiting-col-divider" />

              <div className="waiting-col waiting-col-patient">
                <div className="waiting-col-label">
                  <span>YOUR NUMBER</span>
                </div>
                <div className="waiting-patient-display">
                  <span className="waiting-patient-num">{patientNum}</span>
                </div>
              </div>
            </div>

            {/* Progress strip */}
            <div className="waiting-progress-strip-wrap" aria-hidden="true">
              <div
                className={`waiting-progress-strip-bar ${isYourTurn ? 'is-complete' : ''}`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            {/* Stats row */}
            <div className={`waiting-stats-row ${isYourTurn ? 'is-turn-stats' : ''}`}>
              <div className="waiting-stat-box">
                <span className="waiting-stat-label">PATIENTS AHEAD</span>
                <strong className="waiting-stat-val">{patientsAhead}</strong>
              </div>
              {!isYourTurn && (
                <>
                  <div className="waiting-stats-divider" />
                  <div className="waiting-stat-box">
                    <span className="waiting-stat-label">ESTIMATED WAIT</span>
                    <strong className="waiting-stat-val">{estimatedWaitText}</strong>
                  </div>
                </>
              )}
            </div>
          </>
        ) : (
          /* Future appointment */
          <div className="waiting-future-body">
            <div className="waiting-future-token-row">
              <span className="waiting-col-label">YOUR RESERVED NUMBER</span>
              <strong className="waiting-patient-num">{patientNum}</strong>
            </div>
            <div className="waiting-meta-row">
              <div className="waiting-meta-item">
                <span className="waiting-meta-label">Date</span>
                <span className="waiting-meta-value">{dateLabel}</span>
              </div>
              <div className="waiting-meta-divider" />
              <div className="waiting-meta-item">
                <span className="waiting-meta-label">Session</span>
                <span className="waiting-meta-value">{booking.session}</span>
              </div>
            </div>
            <p className="waiting-future-note">Live queue progress will appear on your appointment day.</p>
          </div>
        )}
      </div>

      {/* Live status badge */}
      {today && (
        <div
          className={`waiting-status waiting-status-${isYourTurn ? 'turn' : isNext ? 'next' : 'waiting'}`}
          role="status"
        >
          <span className="waiting-status-dot" />
          <span>{hasAcknowledgedTurn && isYourTurn ? `Consultation with ${doctorName}` : statusText}</span>
        </div>
      )}

      {/* Demo controls (visible on today's appointments only) */}
      {today && (
        <div className="waiting-demo-container">
          <div className="waiting-demo-controls" role="group" aria-label="Demo queue simulation">
            <button
              type="button"
              className="waiting-demo-btn waiting-demo-btn-next"
              onClick={handleDemoNext}
              aria-label="Advance queue to next patient"
            >
              <span>Next patient</span>
              <span className="demo-btn-arrow">→</span>
            </button>
            <button
              type="button"
              className="waiting-demo-btn waiting-demo-btn-skip"
              onClick={handleDemoSkipOne}
              disabled={patientsAhead === 0}
              aria-label="Skip one waiting patient ahead"
            >
              <span>Skip one</span>
              <span className="demo-btn-badge">−1</span>
            </button>
            <button
              type="button"
              className={`waiting-demo-btn waiting-demo-btn-coming ${clinicWaitNotice ? 'is-active' : ''}`}
              onClick={handleDemoComingIn}
              aria-label="Simulate clinic calling 'Coming in 10 min'"
            >
              <span>{clinicWaitNotice ? 'Clear notice' : 'Coming in 10 min'}</span>
            </button>
          </div>
          <div className="waiting-demo-subrow">
            <span className="waiting-demo-hint">Demo queue simulator</span>
            <button type="button" className="waiting-demo-reset-link" onClick={handleDemoReset}>
              Reset demo
            </button>
          </div>
        </div>
      )}

      {/* Wellness note */}
      <section className="wellness-card" aria-live="polite">
        <div className="wellness-icon" aria-hidden="true">✦</div>
        <div className={`wellness-copy ${factVisible ? 'is-visible' : ''}`}>
          <span>A LITTLE WELLNESS NOTE</span>
          <p>{wellnessFacts[factIndex]}</p>
        </div>
        <div className="wellness-progress">
          <i key={factIndex} />
        </div>
      </section>
    </div>
  );
}
