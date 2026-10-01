'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import PatientWaitingView from '../../components/PatientWaitingView';
import {
  getPatientView,
  subscribe,
  getTodayDateKey,
  type PatientView,
} from '../../lib/queueStore';

export default function PatientTrackingPage() {
  const { code } = useParams<{ code: string }>();
  const [patientView, setPatientView] = useState<PatientView | null>(() => code ? getPatientView(code) : null);
  const [checked, setChecked] = useState(false);

  // ── Suppress extension errors that pollute the console ───────────────────
  useEffect(() => {
    const handler = (e: ErrorEvent) => {
      if (e.filename?.startsWith('chrome-extension:') || e.message?.includes('M_ID')) {
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('error', handler, true);
    return () => window.removeEventListener('error', handler, true);
  }, []);

  // ── Load booking from queueStore, subscribe for live updates ─────────────
  useEffect(() => {
    if (!code) return;

    const refresh = () => {
      const fresh = getPatientView(code);
      setPatientView(fresh);
    };

    refresh();
    setChecked(true);
  }, [code]);

  const booking = patientView?.booking ?? null;

  // ── Subscribe once when the booking handle is known ───────────────────────
  // Runs only when booking.handle changes (including null → first-known-handle).
  // Returns cleanup so there is always exactly one active subscription.
  const subscribedHandleRef = useRef<string | null>(null);
  useEffect(() => {
    if (!booking?.handle) return;
    if (subscribedHandleRef.current === booking.handle) return; // already subscribed

    subscribedHandleRef.current = booking.handle;
    const refresh = () => setPatientView(getPatientView(code));
    const unsub = subscribe(booking.handle, refresh);
    return () => {
      subscribedHandleRef.current = null;
      unsub();
    };
  }, [booking?.handle, code]);

  // ── Derived state ─────────────────────────────────────────────────────────
  const today = getTodayDateKey();
  const isValidAndActive = !!booking && booking.date >= today;

  const revisitLabel = booking?.revisitDate
    ? new Date(`${booking.revisitDate}T12:00:00`).toLocaleDateString('en-IN', {
        weekday: 'long', month: 'long', day: 'numeric',
      })
    : '';

  return (
    <main className="patient-flow-page">
      <header className="patient-flow-header">
        <a href="/" className="patient-flow-brand">
          <span className="patient-flow-mark">♡<i>+</i></span>
          <span>carequeue</span>
        </a>
        <span>YOUR VISIT</span>
      </header>

      <section className="patient-flow-card tracking-card">
        {!checked ? (
          /* Loading */
          <div className="tracking-loading">Opening your appointment…</div>

        ) : booking?.status === 'done' ? (
          /* Visit complete state */
          <div className="patient-completed-state">
            <span className="patient-completed-mark">✓</span>
            <p className="patient-completed-kicker">VISIT COMPLETE</p>
            <h1>Thank you for visiting.</h1>
            <p className="patient-completed-message">
              Your visit with{patientView?.clinicName ? ` ${patientView.clinicName}` : ' the clinic'} has been marked complete.
            </p>
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
            <a
              className="patient-secondary-button patient-return-clinic"
              href={`/${booking.handle}`}
            >
              Return to clinic page
            </a>
          </div>

        ) : booking?.status === 'cancelled' ? (
          /* Cancelled */
          <div className="patient-ended-state">
            <span className="patient-ended-mark">✗</span>
            <h1>Appointment cancelled</h1>
            <p>
              This appointment has been cancelled. You can book again from the clinic page.
            </p>
            <a className="patient-secondary-button patient-return-clinic" href={`/${booking.handle}`}>
              Book again
            </a>
          </div>

        ) : booking?.status === 'skipped' ? (
          /* Skipped */
          <div className="patient-ended-state">
            <span className="patient-ended-mark">⏸</span>
            <h1>You stepped out</h1>
            <p>
              You were marked as skipped. The clinic assistant may bring you back into the queue.
              Please check with the reception.
            </p>
          </div>

        ) : !isValidAndActive ? (
          /* Booking not found or expired */
          <div className="patient-ended-state">
            <span className="patient-ended-mark">✓</span>
            <h1>This appointment has ended</h1>
            <p>This link is no longer active. You can book again from your clinic&apos;s page.</p>
          </div>

        ) : (
          /* Live queue tracking (waiting / serving) */
          <PatientWaitingView trackingCode={code} />
        )}
      </section>

      <footer className="patient-flow-footer">
        A calmer way to see your doctor <span>·</span> CareQueue
      </footer>
    </main>
  );
}
