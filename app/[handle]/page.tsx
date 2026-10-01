'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ClinicHoursDay,
  getStoredClinic,
  localDateKey,
  normalizeIndianMobile,
  normalizeMobile,
  RESERVED_HANDLES,
  saveStoredClinic,
  saveBookingOnDevice,
} from '../lib/patient-bookings';
import {
  addBooking,
  getBookingsByPhone,
  getTodayDateKey,
  subscribe as storeSubscribe,
  QueueBooking,
  BookingValidationError,
} from '../lib/queueStore';

type BookingDay = {
  date: string;
  dayName: string;
  dayLabel: string;
  dateLabel: string;
  isClosed: boolean;
  windows: { start: string; end: string; label: string }[];
};

type BookingPeriod = 'today' | 'tomorrow' | 'future';
type Flow = 'mobile' | 'otp' | 'future' | 'several' | 'booking';

const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function makeBookableDays(schedule: ClinicHoursDay[]): BookingDay[] {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return Array.from({ length: 16 }, (_, offset) => {
    const date = new Date(today);
    date.setDate(date.getDate() + offset);
    const dayName = weekdayNames[date.getDay()];
    const scheduleDay = schedule.find(day => day.name.toLowerCase() === dayName.toLowerCase());
    const isToday = offset === 0;
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const windows = scheduleDay?.open
      ? (scheduleDay.windows || [])
          .filter(window => {
            if (!/^\d{2}:\d{2}$/.test(window.start) || !/^\d{2}:\d{2}$/.test(window.end)) return false;
            const startMinutes = Number(window.start.slice(0, 2)) * 60 + Number(window.start.slice(3));
            const endMinutes = Number(window.end.slice(0, 2)) * 60 + Number(window.end.slice(3));
            return !isToday || endMinutes <= startMinutes || endMinutes > currentMinutes;
          })
          .map(window => ({ ...window, label: `${sessionName(window.start)} · ${formatClinicTime(window.start)} – ${formatClinicTime(window.end)}` }))
      : [];
    return {
      date: localDateKey(date),
      dayName,
      dayLabel: offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : dayName,
      dateLabel: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      isClosed: !scheduleDay?.open || !scheduleDay.windows.length,
      windows,
    };
  });
}

function formatClinicTime(value: string) {
  const [hour, minute] = value.split(':').map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function sessionName(value: string) {
  const hour = Number(value.slice(0, 2));
  return hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : hour < 20 ? 'Evening' : 'Night';
}

function formatDisplayDate(dateStr: string) {
  const todayKey = localDateKey();
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowKey = localDateKey(tomorrowDate);
  if (dateStr === todayKey) return 'Today';
  if (dateStr === tomorrowKey) {
    const d = new Date(`${dateStr}T12:00:00`);
    return `Tomorrow, ${d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}`;
  }
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function HandleClinicBookingPage() {
  const { handle } = useParams<{ handle: string }>();
  const router = useRouter();

  const [clinicName, setClinicName] = useState('Willow Family Clinic');
  const [doctorName, setDoctorName] = useState('Dr. Maya Patel');
  const [doctorPhoto, setDoctorPhoto] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [bookableDays, setBookableDays] = useState<BookingDay[]>([]);
  const [bookingPeriod, setBookingPeriod] = useState<BookingPeriod>('today');
  const [scheduleLoaded, setScheduleLoaded] = useState(false);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedSession, setSelectedSession] = useState('');
  const [flow, setFlow] = useState<Flow>('mobile');
  const [mobile, setMobile] = useState('');
  const [knownBookings, setKnownBookings] = useState<QueueBooking[]>([]);
  const [otpCode, setOtpCode] = useState('');
  const [otpSeconds, setOtpSeconds] = useState(30);
  const [otpCycle, setOtpCycle] = useState(0);
  const [patientName, setPatientName] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | ''>('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [isSuspended, setIsSuspended] = useState(false);

  useEffect(() => {
    const handler = (e: ErrorEvent) => {
      if (e.filename?.startsWith('chrome-extension:') || e.message?.includes('M_ID')) {
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('error', handler, true);
    return () => window.removeEventListener('error', handler, true);
  }, []);

  // Check reserved handles and load clinic by handle from localStorage
  useEffect(() => {
    if (!handle) return;
    const cleanHandle = handle.toLowerCase();

    // 1. Check reserved routes
    if (RESERVED_HANDLES.has(cleanHandle)) {
      if (cleanHandle === 'signin' || cleanHandle === 'login') {
        router.replace('/?screen=signin');
      } else if (cleanHandle === 'signup') {
        router.replace('/?screen=signup');
      } else if (cleanHandle === 'dashboard' || cleanHandle === 'queue') {
        router.replace('/?screen=queue');
      } else if (cleanHandle === 'setup' || cleanHandle === 'profile') {
        router.replace('/?screen=profile');
      } else if (cleanHandle === 'hours' || cleanHandle === 'availability') {
        router.replace('/?screen=availability');
      } else if (cleanHandle === 'admin') {
        router.replace('/admin');
      } else if (cleanHandle === 'link') {
        router.replace('/?screen=link');
      } else {
        router.replace('/');
      }
      return;
    }

    // 2. Load stored clinic by handle
    let stored = getStoredClinic(cleanHandle);

    // Also check admin clinics list
    let adminMatch: any = null;
    try {
      const adminClinicsRaw = localStorage.getItem('carequeue-admin-clinics');
      if (adminClinicsRaw) {
        const list = JSON.parse(adminClinicsRaw);
        if (Array.isArray(list)) {
          adminMatch = list.find((c: any) => c.handle?.toLowerCase() === cleanHandle);
        }
      }
    } catch {}

    // 3. Check if clinic is Suspended
    let isClinicSuspended = false;
    try {
      const statusKey = localStorage.getItem(`carequeue-clinic-status:${cleanHandle}`);
      if (statusKey === 'Suspended') {
        isClinicSuspended = true;
      } else if (adminMatch && adminMatch.status === 'Suspended') {
        isClinicSuspended = true;
      }
    } catch {}

    if (isClinicSuspended) {
      setIsSuspended(true);
      setNotFound(false);
      setClinicName(stored?.clinic || adminMatch?.name || 'Clinic');
      setDoctorName(stored?.doctor || adminMatch?.doctorName || 'Doctor');
      setScheduleLoaded(true);
      return;
    }

    if (!stored && !adminMatch) {
      setNotFound(true);
      setIsSuspended(false);
      setScheduleLoaded(true);
      return;
    }

    // If clinic is known in admin list but not individually saved yet, initialize it
    if (!stored && adminMatch) {
      stored = {
        handle: cleanHandle,
        clinic: adminMatch.name,
        doctor: adminMatch.doctorName,
        specialty: adminMatch.specialty || 'General practice',
        photo: '',
        days: [
          { name: 'Monday', open: true, windows: [{ start: '09:00', end: '17:00' }] },
          { name: 'Tuesday', open: true, windows: [{ start: '09:00', end: '17:00' }] },
          { name: 'Wednesday', open: true, windows: [{ start: '09:00', end: '17:00' }] },
          { name: 'Thursday', open: true, windows: [{ start: '09:00', end: '17:00' }] },
          { name: 'Friday', open: true, windows: [{ start: '09:00', end: '16:00' }] },
          { name: 'Saturday', open: false, windows: [{ start: '09:00', end: '13:00' }] },
          { name: 'Sunday', open: false, windows: [{ start: '09:00', end: '13:00' }] },
        ],
      };
      try {
        saveStoredClinic(stored);
      } catch {}
    }

    if (!stored) return;

    setNotFound(false);
    setIsSuspended(false);
    setClinicName(stored.clinic);
    setDoctorName(stored.doctor);
    setDoctorPhoto(stored.photo || '');
    setSpecialty(stored.specialty || '');
    const days = makeBookableDays(stored.days);
    setBookableDays(days);
    setSelectedDate(days.find(day => day.windows.length > 0)?.date || days[0]?.date || '');
    setBookingPeriod(days[0]?.windows.length ? 'today' : days[1]?.windows.length ? 'tomorrow' : 'future');
    setSelectedSession('');
    setScheduleLoaded(true);
  }, [handle, router]);

  useEffect(() => {
    if (flow !== 'otp') return;
    setOtpSeconds(30);
    const timer = window.setInterval(() => {
      setOtpSeconds(seconds => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [flow, otpCycle]);

  useEffect(() => {
    const cleanHandle = (handle || '').toLowerCase();
    const refreshBookings = () => {
      if (flow !== 'future' && flow !== 'several') return;
      const selectedMobile = normalizeIndianMobile(mobile);
      const today = getTodayDateKey();
      const allForPhone = getBookingsByPhone(cleanHandle, selectedMobile);
      const refreshed = allForPhone.filter(
        b => b.date >= today && (b.status === 'waiting' || b.status === 'serving')
      );
      setKnownBookings(refreshed);
      if (!refreshed.length) setFlow('booking');
      else if (refreshed.length === 1 && refreshed[0].date > today) setFlow('future');
      else if (refreshed.length > 1) setFlow('several');
    };

    const unsubscribe = storeSubscribe(cleanHandle, refreshBookings);
    return () => unsubscribe();
  }, [flow, mobile, handle]);

  const selectedDay = bookableDays.find(day => day.date === selectedDate);

  function handleContinueWithMobile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeIndianMobile(mobile);
    if (!/^\d{10}$/.test(normalized)) {
      setError('Enter a valid 10-digit Indian mobile number.');
      return;
    }
    setMobile(normalized);
    setError('');

    // Every number entered asks for the demo OTP (1234)
    setOtpCode('');
    setOtpCycle(c => c + 1);
    setFlow('otp');
  }

  function confirmDemoCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (otpCode !== '1234') {
      setError('Please enter the 4-digit code shown above (1234).');
      return;
    }
    setError('');
    const cleanHandle = (handle || '').toLowerCase();
    const today = getTodayDateKey();
    const allForPhone = getBookingsByPhone(cleanHandle, mobile);
    const active = allForPhone.filter(
      booking =>
        booking.date >= today &&
        (booking.status === 'waiting' || booking.status === 'serving')
    );
    setKnownBookings(active);

    if (active.length === 1 && active[0].date === today) {
      window.location.href = `/t/${active[0].trackingCode}`;
      return;
    }

    if (active.length === 1 && active[0].date > today) {
      setFlow('future');
      return;
    }

    if (active.length > 1) {
      setFlow('several');
      return;
    }

    setFlow('booking');
  }

  function resendDemoCode() {
    setOtpCode('');
    setOtpSeconds(30);
    setOtpCycle(c => c + 1);
    setError('New demo code ready. Use 1234.');
  }

  function handleBookingSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDate) {
      setError('Choose a booking date.');
      return;
    }
    if (!selectedSession) {
      setError('Choose an appointment time window.');
      return;
    }
    if (!selectedDay || selectedDay.isClosed) {
      setError('This clinic is closed on the selected date.');
      return;
    }
    if (!patientName.trim()) {
      setError('Enter the patient’s full name.');
      return;
    }
    const cleanHandle = (handle || '').toLowerCase();
    setSaving(true);
    try {
      const newBooking = addBooking({
        handle: cleanHandle,
        date: selectedDate,
        session: selectedSession,
        name: patientName.trim(),
        phone: `+91 ${normalizeIndianMobile(mobile)}`,
        age: Number(age) || 0,
        gender: gender || 'female',
      });

      try {
        saveBookingOnDevice(cleanHandle, normalizeIndianMobile(mobile), [newBooking.trackingCode]);
      } catch {}

      window.location.href = `/t/${newBooking.trackingCode}`;
    } catch (err) {
      setSaving(false);
      if (err instanceof BookingValidationError) {
        setError(err.message);
      } else {
        setError('We couldn’t save your booking on this device. Please try again.');
      }
    }
  }

  function selectDate(date: string) {
    setSelectedDate(date);
    setSelectedSession('');
    setError('');
    const offset = bookableDays.findIndex(day => day.date === date);
    setBookingPeriod(offset === 0 ? 'today' : offset === 1 ? 'tomorrow' : 'future');
  }

  function selectPeriod(period: BookingPeriod) {
    setBookingPeriod(period);
    const target =
      period === 'today'
        ? bookableDays[0]
        : period === 'tomorrow'
        ? bookableDays[1]
        : bookableDays.slice(2).find(day => !day.isClosed) || bookableDays[2] || bookableDays[0];
    if (target) {
      setSelectedDate(target.date);
      setSelectedSession('');
      setError('');
    }
  }

  // Friendly Clinic Not Found page
  if (notFound) {
    return (
      <main className="patient-flow-page">
        <header className="patient-flow-header">
          <a href="/" className="patient-flow-brand">
            <span className="patient-flow-mark">♡<i>+</i></span>
            <span>carequeue</span>
          </a>
          <span>CLINIC SEARCH</span>
        </header>
        <section className="patient-flow-card clinic-not-found-card">
          <div className="clinic-not-found-icon">?</div>
          <span className="clinic-not-found-kicker">CLINIC NOT FOUND</span>
          <h1>We couldn’t find this clinic page</h1>
          <p>
            There is no active clinic registered under <strong>/{handle}</strong>.
          </p>
          <p className="clinic-not-found-sub">
            Please double-check the web address from your doctor, or try our sample clinic.
          </p>
          <div className="clinic-not-found-actions">
            <a href="/willow-family-clinic" className="patient-primary-button">
              View Willow Family Clinic <span>→</span>
            </a>
            <a href="/" className="patient-secondary-button">
              Return to CareQueue Home
            </a>
          </div>
        </section>
        <footer className="patient-flow-footer">
          A calmer way to see your doctor <span>·</span> CareQueue
        </footer>
      </main>
    );
  }

  // Suspended clinic page
  if (isSuspended) {
    return (
      <main className="patient-flow-page">
        <header className="patient-flow-header">
          <a href="/" className="patient-flow-brand">
            <span className="patient-flow-mark">♡<i>+</i></span>
            <span>carequeue</span>
          </a>
          <span>CLINIC STATUS</span>
        </header>
        <section className="patient-flow-card clinic-suspended-card">
          <div className="clinic-suspended-icon">⏸</div>
          <span className="clinic-suspended-kicker">TEMPORARILY UNAVAILABLE</span>
          <h1>This clinic is temporarily unavailable</h1>
          <p>
            Online queue booking and live tracking for <strong>{clinicName}</strong> are currently paused.
          </p>
          <p className="clinic-suspended-sub">
            Please contact {doctorName ? `${doctorName}’s clinic` : 'the clinic'} directly or check back later.
          </p>
          <div className="clinic-not-found-actions">
            <a href="/" className="patient-secondary-button">
              Return to CareQueue Home
            </a>
          </div>
        </section>
        <footer className="patient-flow-footer">
          A calmer way to see your doctor <span>·</span> CareQueue
        </footer>
      </main>
    );
  }

  return (
    <main className="patient-flow-page">
      <header className="patient-flow-header">
        <a href="/" className="patient-flow-brand">
          <span className="patient-flow-mark">♡<i>+</i></span>
          <span>carequeue</span>
        </a>
        <span>BOOK A VISIT</span>
      </header>

      <section className="patient-flow-card">
        <div className="doctor-public-profile">
          <div className="doctor-public-avatar">
            {doctorPhoto ? <img src={doctorPhoto} alt={doctorName} /> : <span>{clinicName.slice(0, 2).toUpperCase()}</span>}
          </div>
          <div className="doctor-public-copy">
            <span>{clinicName}</span>
            <h1>{doctorName}</h1>
            {specialty && <small>{specialty}</small>}
          </div>
        </div>

        {flow === 'mobile' && (
          <div className="patient-entry-panel">
            <span className="patient-entry-eyebrow">PATIENT CHECK-IN</span>
            <h2>Enter your mobile number to begin</h2>
            <form onSubmit={handleContinueWithMobile} className="patient-booking-form">
              <label>
                Mobile number
                <div className="india-mobile-field">
                  <span>+91</span>
                  <input
                    type="tel"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={10}
                    placeholder="98765 43210"
                    value={mobile}
                    onChange={e => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    autoComplete="tel-national"
                    required
                    autoFocus
                  />
                </div>
              </label>
              {error && <p className="patient-flow-error">{error}</p>}
              <button type="submit" className="patient-primary-button">
                Continue <span>→</span>
              </button>
            </form>
          </div>
        )}

        {flow === 'otp' && (
          <div className="patient-entry-panel otp-panel">
            <span className="patient-entry-eyebrow">VERIFY MOBILE</span>
            <h2>Enter verification code</h2>
            <p>We sent a 4-digit code to <b>+91 {mobile}</b>.</p>
            <form onSubmit={confirmDemoCode} className="patient-booking-form">
              <label>
                <div className="demo-otp-label">
                  <span>4-digit code</span>
                  <span className="demo-otp-badge">Demo OTP: 1234</span>
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={4}
                  placeholder="1234"
                  className="demo-otp-input"
                  value={otpCode}
                  onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  autoFocus
                  required
                />
              </label>
              <span className="demo-otp-hint">Enter 1234 to continue</span>
              {error && <p className="patient-flow-error">{error}</p>}
              <button type="submit" className="patient-primary-button">
                Confirm &amp; continue <span>→</span>
              </button>
              <div className="otp-resend-row">
                <button type="button" onClick={() => setFlow('mobile')}>
                  Change number
                </button>
                <button type="button" onClick={resendDemoCode} disabled={otpSeconds > 0}>
                  {otpSeconds > 0 ? `Resend code in ${otpSeconds}s` : 'Resend demo code'}
                </button>
              </div>
            </form>
          </div>
        )}

        {flow === 'future' && knownBookings[0] && (
          <div className="patient-entry-panel">
            <div className="existing-bookings-heading">
              <span className="patient-entry-eyebrow">UPCOMING APPOINTMENT</span>
              <h2>You have an appointment scheduled</h2>
            </div>
            <div className="existing-booking-card">
              <span className="existing-booking-status"><i /> Active booking</span>
              <h2>Number {knownBookings[0].queueNumber}</h2>
              <span className="existing-booking-patient-tag">{knownBookings[0].name}</span>
              <p className="existing-booking-date">{formatDisplayDate(knownBookings[0].date)}</p>
              <p className="existing-booking-session">{knownBookings[0].session}</p>
              <a href={`/t/${knownBookings[0].trackingCode}`} className="patient-primary-button existing-booking-track">
                Track your appointment <span>→</span>
              </a>
            </div>
            <div style={{ display: 'grid', justifyItems: 'center', marginTop: '14px' }}>
              <button type="button" className="book-someone-else-link" onClick={() => setFlow('booking')}>
                Book an appointment for someone else
              </button>
            </div>
          </div>
        )}

        {flow === 'several' && (
          <div className="patient-entry-panel">
            <div className="existing-bookings-heading">
              <span className="patient-entry-eyebrow">ACTIVE APPOINTMENTS</span>
              <h2>You have multiple bookings</h2>
            </div>
            <div className="existing-bookings-list">
              {knownBookings.map(item => (
                <div className="existing-booking-card" key={item.trackingCode}>
                  <span className="existing-booking-status"><i /> Active booking</span>
                  <h3>Number {item.queueNumber} · {item.name}</h3>
                  <p className="existing-booking-date">{formatDisplayDate(item.date)}</p>
                  <p className="existing-booking-session">{item.session}</p>
                  <a href={`/t/${item.trackingCode}`} className="patient-primary-button existing-booking-track">
                    Track this visit <span>→</span>
                  </a>
                </div>
              ))}
            </div>
            <div style={{ display: 'grid', justifyItems: 'center', marginTop: '16px' }}>
              <button type="button" className="book-someone-else-link" onClick={() => setFlow('booking')}>
                Book for someone else
              </button>
            </div>
          </div>
        )}

        {flow === 'booking' && scheduleLoaded && (
          <form className="patient-booking-form" onSubmit={handleBookingSubmit}>
            <div className="booking-screen-header">
              <div className="verified-user-chip">
                <span className="verified-user-icon">✓</span>
                <span>Verified: <strong>+91 {mobile}</strong></span>
                <button type="button" className="verified-change-btn" onClick={() => setFlow('mobile')}>
                  Change
                </button>
              </div>
              <h2 className="booking-screen-title">Select appointment date &amp; time</h2>
              <p className="booking-screen-subtitle">Choose a convenient slot to reserve your queue token.</p>
            </div>

            <fieldset className="session-picker">
              <legend>When would you like to visit?</legend>
              <div className="booking-periods booking-periods-three" role="tablist" aria-label="Appointment days">
                <button
                  type="button"
                  role="tab"
                  aria-selected={bookingPeriod === 'today'}
                  className={`booking-period ${bookingPeriod === 'today' ? 'selected' : ''}`}
                  onClick={() => selectPeriod('today')}
                  disabled={bookableDays[0]?.isClosed}
                >
                  <span>Today</span>
                  <small>{bookableDays[0]?.isClosed ? 'Closed' : bookableDays[0]?.dateLabel}</small>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={bookingPeriod === 'tomorrow'}
                  className={`booking-period ${bookingPeriod === 'tomorrow' ? 'selected' : ''}`}
                  onClick={() => selectPeriod('tomorrow')}
                  disabled={bookableDays[1]?.isClosed}
                >
                  <span>Tomorrow</span>
                  <small>{bookableDays[1]?.isClosed ? 'Closed' : bookableDays[1]?.dateLabel}</small>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={bookingPeriod === 'future'}
                  className={`booking-period ${bookingPeriod === 'future' ? 'selected' : ''}`}
                  onClick={() => selectPeriod('future')}
                >
                  <span>Future date</span>
                  <small>Pick a day</small>
                </button>
              </div>

              {bookingPeriod === 'future' && (
                <div className="future-days-picker">
                  <div className="booking-days-scroll" role="tablist" aria-label="Select a date">
                    {bookableDays.slice(2).map(day => (
                      <button
                        key={day.date}
                        type="button"
                        role="tab"
                        aria-selected={selectedDate === day.date}
                        className={`booking-day ${day.isClosed ? 'closed' : ''} ${selectedDate === day.date ? 'selected' : ''}`}
                        onClick={() => !day.isClosed && selectDate(day.date)}
                        disabled={day.isClosed}
                      >
                        <span>{day.dayName.slice(0, 3)}</span>
                        <b>{day.dateLabel.split(' ')[1] || day.dateLabel}</b>
                        <small>{day.isClosed ? 'Closed' : day.dateLabel.split(' ')[0]}</small>
                      </button>
                    ))}
                  </div>
                  <p className="future-days-hint">Swipe horizontally to see all upcoming days.</p>
                </div>
              )}
            </fieldset>

            <fieldset className="session-picker">
              <legend>Available sessions {selectedDay ? `for ${selectedDay.dayLabel}` : ''}</legend>
              {selectedDay && !selectedDay.isClosed && selectedDay.windows.length > 0 ? (
                <div className="booking-sessions">
                  {selectedDay.windows.map(window => {
                    const sessionKey = `${window.start}-${window.end}`;
                    return (
                      <label key={sessionKey} className={`booking-session ${selectedSession === sessionKey ? 'selected' : ''}`}>
                        <input
                          type="radio"
                          name="session"
                          value={sessionKey}
                          checked={selectedSession === sessionKey}
                          onChange={() => {
                            setSelectedSession(sessionKey);
                            setError('');
                          }}
                        />
                        <span>{window.label}</span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p className="no-sessions-message">No appointments available on this date. Please select another day.</p>
              )}
            </fieldset>

            <label>
              Patient's full name
              <input
                required
                type="text"
                placeholder="Enter patient’s name"
                value={patientName}
                onChange={e => setPatientName(e.target.value)}
                autoComplete="name"
              />
            </label>

            <div className="patient-form-two-col">
              <label>
                Age
                <input
                  required
                  type="number"
                  min="0"
                  max="120"
                  placeholder="e.g. 29"
                  value={age}
                  onChange={e => setAge(e.target.value)}
                />
              </label>

              <fieldset className="gender-picker">
                <legend>Gender</legend>
                <div>
                  <label className={gender === 'female' ? 'selected' : ''}>
                    <input
                      type="radio"
                      name="gender"
                      value="female"
                      checked={gender === 'female'}
                      onChange={() => setGender('female')}
                    />
                    <span>Female</span>
                  </label>
                  <label className={gender === 'male' ? 'selected' : ''}>
                    <input
                      type="radio"
                      name="gender"
                      value="male"
                      checked={gender === 'male'}
                      onChange={() => setGender('male')}
                    />
                    <span>Male</span>
                  </label>
                </div>
              </fieldset>
            </div>

            {error && <p className="patient-flow-error">{error}</p>}

            <button type="submit" className="patient-primary-button" disabled={saving}>
              {saving ? 'Reserving token…' : 'Reserve queue token'} <span>→</span>
            </button>
          </form>
        )}
      </section>

      <footer className="patient-flow-footer">
        A calmer way to see your doctor <span>·</span> CareQueue
      </footer>
    </main>
  );
}
