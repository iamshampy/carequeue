'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  generateClinicHandle,
  getStoredClinic,
  readAllHandles,
  saveStoredClinic,
} from './lib/patient-bookings';
import {
  QueueBooking,
  getQueue,
  callNext as storeCallNext,
  markDone as storeMarkDone,
  markSkipped as storeMarkSkipped,
  markCancelled as storeMarkCancelled,
  bringBack as storeBringBack,
  setComingIn as storeSetComingIn,
  undoLast as storeUndoLast,
  subscribe as storeSubscribe,
  loadDemoSeedBookings,
  getTodayDateKey,
} from './lib/queueStore';

type Screen = 'home' | 'signup' | 'signin' | 'profile' | 'availability' | 'link' | 'queue' | 'followups';
type TimeWindow = { start: string; end: string };
type Day = { name: string; short: string; open: boolean; windows: TimeWindow[] };
type RevisitChoice = 'none' | '3' | '5' | '7' | 'custom';
const seedDays: Day[] = [
  { name: 'Monday', short: 'M', open: true, windows: [{ start: '09:00', end: '17:00' }] },
  { name: 'Tuesday', short: 'T', open: true, windows: [{ start: '09:00', end: '17:00' }] },
  { name: 'Wednesday', short: 'W', open: true, windows: [{ start: '09:00', end: '17:00' }] },
  { name: 'Thursday', short: 'T', open: true, windows: [{ start: '09:00', end: '17:00' }] },
  { name: 'Friday', short: 'F', open: true, windows: [{ start: '09:00', end: '16:00' }] },
  { name: 'Saturday', short: 'S', open: false, windows: [{ start: '09:00', end: '13:00' }] },
  { name: 'Sunday', short: 'S', open: false, windows: [{ start: '09:00', end: '13:00' }] },
];
const steps: { id: Screen; number: string; label: string }[] = [
  { id: 'profile', number: '01', label: 'Your profile' },
  { id: 'availability', number: '02', label: 'Clinic hours' },
  { id: 'link', number: '03', label: 'Your booking link' },
];
const specialties = ['Family medicine', 'Cardiology', 'Dermatology', 'Dentistry', 'Pediatrics', 'Orthopedics', 'Ophthalmology', 'Other'];

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true as const };
  if (name === 'heart') return <svg {...common}><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" /></svg>;
  if (name === 'arrow') return <svg {...common}><path d="M5 12h14m-6-6 6 6-6 6" /></svg>;
  if (name === 'announce') return <svg {...common}><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15 9a4 4 0 0 1 0 6m3-9a8 8 0 0 1 0 12"/></svg>;
  if (name === 'phone') return <svg {...common}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.2-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.8 2.1Z"/></svg>;
  if (name === 'back') return <svg {...common}><path d="m15 18-6-6 6-6M9 12h12" /></svg>;
  if (name === 'clock') return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>;
  if (name === 'camera') return <svg {...common}><path d="M14 4h-4l-2 3H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2-3Z"/><circle cx="12" cy="13" r="3"/></svg>;
  if (name === 'copy') return <svg {...common}><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>;
  if (name === 'download') return <svg {...common}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m4-5 5 5 5-5m-5 5V3"/></svg>;
  if (name === 'share') return <svg {...common}><path d="M12 16V4m-4 4 4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>;
  if (name === 'whatsapp') return <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M13.601 2.326A7.85 7.85 0 0 0 7.994 0C3.627 0 .068 3.558.064 7.926c0 1.399.366 2.76 1.057 3.965L0 16l4.204-1.102a7.9 7.9 0 0 0 3.79.965h.004c4.368 0 7.926-3.558 7.93-7.93a7.9 7.9 0 0 0-2.327-5.607ZM7.994 14.521a6.6 6.6 0 0 1-3.356-.92l-.24-.144-2.494.654.666-2.433-.156-.251a6.56 6.56 0 0 1-1.007-3.505c0-3.626 2.957-6.584 6.591-6.584a6.56 6.56 0 0 1 4.66 1.931 6.56 6.56 0 0 1 1.928 4.66c-.004 3.639-2.961 6.592-6.592 6.592m3.615-4.934c-.197-.099-1.17-.578-1.353-.646-.182-.065-.315-.099-.445.099-.133.197-.513.646-.627.775-.114.133-.232.148-.43.05-.197-.1-.836-.308-1.592-.985-.59-.525-.985-1.175-1.103-1.372-.114-.198-.011-.304.088-.403.087-.088.197-.232.296-.346.1-.114.133-.198.198-.33.065-.134.034-.248-.015-.347-.05-.099-.445-1.076-.612-1.47-.16-.389-.323-.335-.445-.34-.114-.007-.247-.007-.38-.007a.73.73 0 0 0-.529.247c-.182.198-.691.677-.691 1.654s.71 1.916.81 2.049c.098.133 1.394 2.132 3.383 2.992.47.205.84.326 1.129.418.475.152.904.129 1.246.08.38-.058 1.171-.48 1.338-.943.164-.464.164-.86.114-.943-.049-.084-.182-.133-.38-.232"/></svg>;
  return <svg {...common}><path d="M20 11.5a8 8 0 0 1-8 8 8.8 8.8 0 0 1-4-.9L3 20l1.4-4.5A8 8 0 1 1 20 11.5Z"/><path d="M8 8.5c.5 2.5 2 4 4.5 4.5"/></svg>;
}

function Brand({ light = false }: { light?: boolean }) { return <div className={`brand${light ? ' brand-light' : ''}`}><span className="brand-symbol"><Icon name="heart" size={19}/><span>+</span></span><span>carequeue</span></div>; }
function formatTime(value: string) { if (!value) return 'Set time'; const [hour, minute] = value.split(':').map(Number); return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'pm' : 'am'}`; }
function dateOffset(offset: number) { const date = new Date(); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() + offset); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function formatArrivalTime(timestamp?: number) {
  if (!timestamp) return '9:00 am';
  const d = new Date(timestamp);
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const h = hours % 12 || 12;
  const m = String(minutes).padStart(2, '0');
  const ampm = hours >= 12 ? 'pm' : 'am';
  return `${h}:${m} ${ampm}`;
}

function reminderLink(patient: QueueBooking, clinic: string, today: string, tomorrow: string) {
  const date = patient.revisitDate;
  const due = date === today ? 'today' : date === tomorrow ? 'tomorrow' : date ? `on ${new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}` : 'soon';
  return `https://wa.me/?text=${encodeURIComponent(`Hello ${patient.name}, this is ${clinic}. A friendly reminder that your revisit is due ${due}. Reply here if you need help.`)}`;
}
function makeCompactPhoto(source: File | string): Promise<string> {
  return new Promise(resolve => {
    const objectUrl = typeof source === 'string' ? '' : URL.createObjectURL(source);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      const render = (size: number, quality: number) => {
        canvas.width = size; canvas.height = size;
        const side = Math.min(image.naturalWidth, image.naturalHeight);
        const x = (image.naturalWidth - side) / 2;
        const y = (image.naturalHeight - side) / 2;
        canvas.getContext('2d')?.drawImage(image, x, y, side, side, 0, 0, size, size);
        let data = canvas.toDataURL('image/webp', quality);
        if (!data.startsWith('data:image/webp;')) data = canvas.toDataURL('image/jpeg', quality);
        return data;
      };
      let photoData = render(64, 0.5);
      if (photoData.length > 900) photoData = render(48, 0.38);
      if (photoData.length > 900) photoData = render(36, 0.28);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      resolve(photoData);
    };
    image.onerror = () => { if (objectUrl) URL.revokeObjectURL(objectUrl); resolve(''); };
    image.src = objectUrl || source as string;
  });
}

function formatCountdown(deadline?: number) {
  if (!deadline) return '';
  const remainingSec = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
  const mins = Math.floor(remainingSec / 60);
  const secs = remainingSec % 60;
  if (remainingSec === 0) return 'due now';
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>('home');
  const [clinicHandle, setClinicHandle] = useState<string>('willow-family-clinic');
  const [handleCreated, setHandleCreated] = useState<boolean>(false);
  const [phoneSheetPatient, setPhoneSheetPatient] = useState<QueueBooking | null>(null);
  const [phoneCopied, setPhoneCopied] = useState(false);
  const [, setTick] = useState(0);
  const [doctor, setDoctor] = useState('Dr. Maya Patel');
  const [clinic, setClinic] = useState('Willow Family Clinic');
  const [specialty, setSpecialty] = useState('Family medicine');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [photo, setPhoto] = useState('');
  const [days, setDays] = useState<Day[]>(seedDays);
  const [expandedDay, setExpandedDay] = useState<number | null>(0);
  const [qr, setQr] = useState('');
  const [appOrigin, setAppOrigin] = useState('https://carequeue.health');
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [devMenuOpen, setDevMenuOpen] = useState(false);
  const [patients, setPatients] = useState<QueueBooking[]>([]);
  const [revisitPatientId, setRevisitPatientId] = useState<string | null>(null);
  const [revisitChoice, setRevisitChoice] = useState<RevisitChoice>('none');
  const [customRevisitDate, setCustomRevisitDate] = useState('');
  const [advanceAfterDone, setAdvanceAfterDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const activeHandle = clinicHandle || 'willow-family-clinic';
  const today = getTodayDateKey();
  const tomorrow = dateOffset(1);
  const endOfWeek = dateOffset(7);
  const publicPath = `/${activeHandle}`;
  const publicLink = `${appOrigin}${publicPath}`;

  useEffect(() => {
    const handle = activeHandle;
    const date = getTodayDateKey();
    setPatients(getQueue(handle, date));

    const unsubscribe = storeSubscribe(handle, () => {
      setPatients(getQueue(handle, date));
    });
    return () => unsubscribe();
  }, [activeHandle]);

  useEffect(() => {
    const timer = window.setInterval(() => setTick(t => t + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      const savedScreen = localStorage.getItem('carequeue-active-screen');
      if (savedScreen && ['home', 'signup', 'signin', 'profile', 'availability', 'link', 'queue', 'followups'].includes(savedScreen)) {
        setScreen(savedScreen as Screen);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('carequeue-active-screen', screen);
    } catch {}
  }, [screen]);

  useEffect(() => {
    const handler = (e: ErrorEvent) => {
      if (e.filename?.startsWith('chrome-extension:') || e.message?.includes('M_ID')) {
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('error', handler, true);
    return () => window.removeEventListener('error', handler, true);
  }, []);

  useEffect(() => {
    try {
      // Read clinic data from the canonical carequeue-clinic:<handle> key.
      // We first check if a handle was persisted; if so, load that clinic.
      // Otherwise, fall back to the default demo clinic (willow-family-clinic).
      const handles: string[] = JSON.parse(localStorage.getItem('carequeue-handles') || '[]');
      // The most recently used handle is last in the list
      const persistedHandle = handles.length > 0 ? handles[handles.length - 1] : null;
      const targetHandle = persistedHandle || 'willow-family-clinic';

      const data = getStoredClinic(targetHandle);
      if (data) {
        setClinicHandle(data.handle);
        setHandleCreated(true);
        if (data.doctor) setDoctor(data.doctor);
        if (data.clinic) setClinic(data.clinic);
        if (data.specialty) setSpecialty(data.specialty);
        if (data.photo) makeCompactPhoto(data.photo).then(setPhoto);
        if (data.days) setDays((data.days as any[]).map((day: any) => ({ ...day, windows: day.windows ?? [{ start: day.start ?? '09:00', end: day.end ?? '17:00' }] })));
      } else {
        // Ensure default clinic seed is written so patient pages can find it
        getStoredClinic('willow-family-clinic');
      }
    } catch { /* demo remains usable if local storage is unavailable */ }
  }, []);


  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const s = params.get('screen') as Screen | null;
      if (s && ['home', 'signup', 'signin', 'profile', 'availability', 'link', 'queue', 'followups'].includes(s)) {
        setScreen(s);
      }
    } catch { /* safe */ }
  }, []);

  useEffect(() => {
    const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL;
    try { setAppOrigin(configuredOrigin ? new URL(configuredOrigin).origin : window.location.origin); }
    catch { setAppOrigin(window.location.origin); }
  }, []);

  // Generate QR at error-correction level M, at least 280px (288px), white background, quiet zone of 4 modules
  useEffect(() => {
    QRCode.toDataURL(publicLink, {
      width: 288,
      margin: 4,
      errorCorrectionLevel: 'M',
      color: { dark: '#163a49', light: '#ffffff' },
    })
      .then(setQr)
      .catch(() => setQr(''));
  }, [publicLink]);

  useEffect(() => { if (toast) { const timer = window.setTimeout(() => setToast(''), 2500); return () => window.clearTimeout(timer); } }, [toast]);

  // Profile save: automatically generate handle when first saved; once created it never changes
  function saveProfileAndContinue() {
    let finalHandle = clinicHandle;
    if (!handleCreated || !finalHandle || (finalHandle === 'willow-family-clinic' && clinic !== 'Willow Family Clinic')) {
      const allHandles = readAllHandles();
      finalHandle = generateClinicHandle(clinic, allHandles);
      setClinicHandle(finalHandle);
      setHandleCreated(true);
    }
    saveStoredClinic({
      handle: finalHandle,
      clinic,
      doctor,
      specialty,
      photo,
      days,
    });
    setScreen('availability');
  }

  // Availability save: persists clinic hours under the handle
  function saveHoursAndContinue() {
    const finalHandle = clinicHandle || 'willow-family-clinic';
    saveStoredClinic({
      handle: finalHandle,
      clinic,
      doctor,
      specialty,
      photo,
      days,
    });
    setScreen('link');
  }

  function saveAndGo(next: Screen) {
    const finalHandle = clinicHandle || 'willow-family-clinic';
    saveStoredClinic({
      handle: finalHandle,
      clinic,
      doctor,
      specialty,
      photo,
      days,
    });
    setScreen(next);
  }

  function updateDay(index: number, open: boolean) { setDays(current => current.map((day, i) => i === index ? { ...day, open } : day)); if (open) setExpandedDay(index); }
  function updateWindow(dayIndex: number, windowIndex: number, field: keyof TimeWindow, value: string) { setDays(current => current.map((day, i) => i === dayIndex ? { ...day, windows: day.windows.map((window, j) => j === windowIndex ? { ...window, [field]: value } : window) } : day)); }
  function addWindow(dayIndex: number) { setDays(current => current.map((day, i) => i === dayIndex ? { ...day, windows: [...day.windows, { start: '', end: '' }] } : day)); setExpandedDay(dayIndex); }
  function removeWindow(dayIndex: number, windowIndex: number) { setDays(current => current.map((day, i) => i === dayIndex ? { ...day, windows: day.windows.filter((_, j) => j !== windowIndex) } : day)); }
  function openRevisitPicker(patientId: string, advance: boolean) { setRevisitPatientId(patientId); setRevisitChoice('none'); setCustomRevisitDate(''); setAdvanceAfterDone(advance); }
  function saveDone() {
    if (!revisitPatientId) return;
    const revisitDate = revisitChoice === 'none' ? undefined : revisitChoice === 'custom' ? customRevisitDate : dateOffset(Number(revisitChoice));
    if (revisitChoice === 'custom' && (!customRevisitDate || customRevisitDate < dateOffset(0))) return;
    storeMarkDone(activeHandle, today, revisitPatientId, revisitDate);
    if (advanceAfterDone) {
      storeCallNext(activeHandle, today);
    }
    setRevisitPatientId(null);
    setToast(advanceAfterDone ? 'Patient completed and next patient called' : 'Patient marked done');
  }
  function markNotHere() {
    const serving = patients.find(patient => patient.status === 'serving');
    if (!serving) return;
    storeMarkSkipped(activeHandle, today, serving.id);
    storeCallNext(activeHandle, today);
    setToast(`${serving.name} marked not here and moved to Skipped`);
  }

  function handleOutcomeComing(minutes: number) {
    if (!phoneSheetPatient) return;
    storeSetComingIn(activeHandle, today, phoneSheetPatient.id, minutes);
    setPhoneSheetPatient(null);
    setToast(`${phoneSheetPatient.name} arriving in ${minutes} min`);
  }

  function handleOutcomeNotComing() {
    if (!phoneSheetPatient) return;
    storeMarkCancelled(activeHandle, today, phoneSheetPatient.id);
    storeCallNext(activeHandle, today);
    setPhoneSheetPatient(null);
    setToast(`${phoneSheetPatient.name} marked cancelled and next patient called`);
  }

  function handleOutcomeNoAnswer() {
    if (!phoneSheetPatient) return;
    storeMarkSkipped(activeHandle, today, phoneSheetPatient.id);
    storeCallNext(activeHandle, today);
    setPhoneSheetPatient(null);
    setToast(`${phoneSheetPatient.name} marked skipped (no answer) and next patient called`);
  }

  function bringBack(patientId: string) {
    const restored = storeBringBack(activeHandle, today, patientId);
    if (restored) {
      setToast(`${restored.name} placed right after current patient`);
    }
  }

  async function copyPatientPhone(phone: string) {
    try {
      await navigator.clipboard.writeText(phone);
      setPhoneCopied(true);
      setToast('Phone number copied');
      window.setTimeout(() => setPhoneCopied(false), 2000);
    } catch {
      setToast('Copy: ' + phone);
    }
  }

  function callNext() {
    const serving = patients.find(patient => patient.status === 'serving');
    if (serving) {
      openRevisitPicker(serving.id, true);
      return;
    }
    const result = storeCallNext(activeHandle, today);
    if (!result.nowServing) {
      setToast('No patients are waiting');
      return;
    }
    setToast(`Now serving number ${result.nowServing.queueNumber}`);
  }
  function undoLastAction() {
    const success = storeUndoLast(activeHandle, today);
    if (success) {
      setToast('Action undone');
    } else {
      setToast('Nothing to undo');
    }
  }
  function handleLoadDemoPatients() {
    try {
      loadDemoSeedBookings(activeHandle, today);
      setPatients(getQueue(activeHandle, today));
      setDevMenuOpen(false);
      setToast('Demo patients loaded');
    } catch {
      setToast('Could not load demo patients');
    }
  }
  function announcePatient(patient: QueueBooking) {
    if (!('speechSynthesis' in window)) {
      setToast('Speech announcements are not available in this browser');
      return;
    }
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(`Number ${patient.queueNumber}, ${patient.name}`));
  }
  function uploadPhoto(file?: File) { if (file) makeCompactPhoto(file).then(value => { if (value) setPhoto(value); }); }
  async function copyLink() { try { await navigator.clipboard.writeText(publicLink); setCopied(true); setToast('Link copied to clipboard'); window.setTimeout(() => setCopied(false), 2200); } catch { setToast('Copy this link: ' + publicLink); } }

  // Download QR saves the same image as a PNG at 1024px
  async function downloadQr() {
    try {
      const highResQr = await QRCode.toDataURL(publicLink, {
        width: 1024,
        margin: 4,
        errorCorrectionLevel: 'M',
        color: { dark: '#163a49', light: '#ffffff' },
      });
      const a = document.createElement('a');
      a.href = highResQr;
      a.download = `${activeHandle}-booking-qr.png`;
      a.click();
      setToast('Your 1024px QR code is ready');
    } catch {
      setToast('Could not download QR code');
    }
  }

  const currentStep = steps.findIndex(s => s.id === screen);
  const isAuth = screen === 'signup' || screen === 'signin';
  const isQueueScreen = screen === 'queue' || screen === 'followups';
  const servingPatient = patients.find(patient => patient.status === 'serving');
  useEffect(() => {
    if (!servingPatient?.comingInDeadline) return;
    const interval = window.setInterval(() => setTick(t => t + 1), 1000);
    return () => window.clearInterval(interval);
  }, [servingPatient?.comingInDeadline]);
  const waitingPatients = patients.filter(patient => patient.status === 'waiting');
  const skippedPatients = patients.filter(patient => patient.status === 'skipped');
  const daysUntil = (date: string) => {
    const [year, month, day] = date.split('-').map(Number);
    const [todayYear, todayMonth, todayDay] = today.split('-').map(Number);
    return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(todayYear, todayMonth - 1, todayDay)) / 86400000);
  };
  const followupPatients = patients.filter(patient => patient.status === 'done' && !!patient.revisitDate);
  const dueToday = followupPatients.filter(patient => daysUntil(patient.revisitDate!) <= 0);
  const dueTomorrow = followupPatients.filter(patient => daysUntil(patient.revisitDate!) === 1);
  const dueThisWeek = followupPatients.filter(patient => daysUntil(patient.revisitDate!) > 1 && daysUntil(patient.revisitDate!) <= 7);
  return (
    <main className={`shell ${screen === 'home' ? 'shell-home' : ''}`}>
      <section className="main-panel">
        <header className="topbar">
          <Brand/>
          <span className="topbar-note">{isQueueScreen ? 'Clinic assistant' : 'Simple tools for better care'}</span>
          <div className="topbar-right">
            {screen !== 'home' && currentStep >= 0 && (
              <button className="save-label" onClick={() => setToast('Your progress saves automatically')}>
                <span className="save-dot"/> Saved just now
              </button>
            )}
            <button
              type="button"
              className="help-support-button"
              onClick={() => setHelpOpen(true)}
              aria-label="Open help and support"
            >
              <span className="help-icon" aria-hidden="true">?</span>
              <span>Help and support</span>
            </button>
            <div className="dev-menu-container" style={{ position: 'relative', display: 'inline-block' }}>
              <button
                type="button"
                className="help-support-button dev-menu-button"
                onClick={() => setDevMenuOpen(v => !v)}
                aria-label="Developer options"
                style={{ padding: '6px 12px' }}
              >
                <span>⚙ Dev</span>
              </button>
              {devMenuOpen && (
                <div
                  className="dev-menu-dropdown"
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    right: 0,
                    background: '#ffffff',
                    border: '1px solid #d8e5e8',
                    borderRadius: '12px',
                    boxShadow: '0 8px 24px rgba(22, 58, 73, 0.12)',
                    padding: '10px',
                    zIndex: 1000,
                    minWidth: '190px',
                  }}
                >
                  <button
                    type="button"
                    className="primary-button"
                    style={{ width: '100%', fontSize: '13px', padding: '8px 12px' }}
                    onClick={handleLoadDemoPatients}
                  >
                    Load demo patients
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        {isQueueScreen && <div className="queue-dashboard"><div className="queue-heading-row"><div><span className="eyebrow">{screen === 'queue' ? 'CLINIC ASSISTANT' : 'PATIENT REVISITS'}</span><h1>{screen === 'queue' ? 'Today’s queue' : 'Follow-ups'}</h1><p>{clinic}<span className="heading-dot">·</span>{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p></div><button className="undo-button" onClick={undoLastAction}><Icon name="back" size={16}/> Undo</button></div><div className="dashboard-tabs" role="tablist" aria-label="Queue views"><button role="tab" aria-selected={screen === 'queue'} className={screen === 'queue' ? 'active' : ''} onClick={() => setScreen('queue')}>Queue <span>{waitingPatients.length}</span></button><button role="tab" aria-selected={screen === 'followups'} className={screen === 'followups' ? 'active' : ''} onClick={() => setScreen('followups')}>Follow-ups <span>{followupPatients.length}</span></button></div>
          {screen === 'queue' ? <><section className="now-serving-card"><div className="serving-top"><span className="serving-live"><i/> NOW SERVING</span></div>{servingPatient ? <><div className="serving-patient"><span className="serving-number">{servingPatient.queueNumber}</span><div><span className="serving-name-label">PATIENT</span><h2>{servingPatient.name}</h2><p>Arrived at {formatArrivalTime(servingPatient.createdAt)}</p>{servingPatient.comingInMinutes && (<div className="serving-arriving-tag" role="status"><span className="arriving-dot"/><span className="arriving-text">Arriving in {servingPatient.comingInMinutes} min</span><span className="arriving-countdown">{formatCountdown(servingPatient.comingInDeadline)}</span></div>)}</div></div><div className="serving-actions"><button className="announce-button" onClick={() => announcePatient(servingPatient)}><Icon name="announce" size={16}/> Announce</button><button className="phone-patient-button" onClick={() => { setPhoneSheetPatient(servingPatient); setPhoneCopied(false); }}><Icon name="phone" size={16}/> Phone</button><button className="done-button" onClick={() => openRevisitPicker(servingPatient.id, true)}>Done</button><button className="skip-button" onClick={markNotHere}>Not here</button></div></> : <div className="empty-serving"><h2>Ready for the next patient?</h2><p>Call the next person when the doctor is ready.</p></div>}</section><div className="queue-lists"><section className="queue-panel"><div className="panel-heading"><div><h2>Waiting</h2><p>Patients ready to be seen</p></div><span className="panel-count">{waitingPatients.length}</span></div>{waitingPatients.length ? <div className="patient-list">{waitingPatients.map(patient => <div className="queue-patient-row" key={patient.id}><span className="patient-token">{patient.queueNumber}</span><div className="patient-row-copy"><b>{patient.name}</b><span>Arrived {formatArrivalTime(patient.createdAt)}</span></div><a className="call-icon-button" href={`tel:${patient.phone.replace(/[^\d+]/g, '')}`} aria-label={`Call ${patient.name}`}><Icon name="phone" size={15}/></a></div>)}</div> : <p className="empty-list">No one is waiting.</p>}</section><section className="queue-panel skipped-panel"><div className="panel-heading"><div><h2>Skipped</h2><p>Patients to call back</p></div><span className="panel-count skipped-count">{skippedPatients.length}</span></div>{skippedPatients.length ? <div className="patient-list">{skippedPatients.map(patient => <div className="queue-patient-row" key={patient.id}><span className="patient-token skipped-token">{patient.queueNumber}</span><div className="patient-row-copy"><b>{patient.name}</b><span>Number {patient.queueNumber}</span></div><div className="patient-row-actions"><a className="call-icon-button" href={`tel:${patient.phone.replace(/[^\d+]/g, '')}`} aria-label={`Call ${patient.name}`}><Icon name="phone" size={15}/></a><button className="call-back-button" onClick={() => bringBack(patient.id)}>Bring back</button></div></div>)}</div> : <p className="empty-list">No skipped patients.</p>}</section></div><button className="next-patient-button" onClick={callNext}><span>Next Patient</span><Icon name="arrow" size={19}/></button><p className="next-patient-hint">{servingPatient ? 'Choose a revisit when finishing to call the next patient.' : `${waitingPatients.length} patient${waitingPatients.length === 1 ? '' : 's'} waiting in line.`}</p></> : <div className="followup-groups">{[{ title: 'Today', patients: dueToday }, { title: 'Tomorrow', patients: dueTomorrow }, { title: 'This week', patients: dueThisWeek }].map(group => <section className="followup-panel" key={group.title}><div className="followup-heading"><h2>{group.title}</h2><span>{group.patients.length}</span></div>{group.patients.length ? group.patients.map(patient => <div className="followup-row" key={patient.id}><span className="patient-token followup-token">{patient.queueNumber}</span><div className="patient-row-copy"><b>{patient.name}</b><span>Number {patient.queueNumber} · Revisit due {patient.revisitDate && new Date(`${patient.revisitDate}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span></div><a className="call-icon-button followup-call-button" href={`tel:${patient.phone.replace(/[^\d+]/g, '')}`} aria-label={`Call ${patient.name}`}><Icon name="phone" size={15}/></a><a className="reminder-button" href={reminderLink(patient, clinic, today, tomorrow)} target="_blank" rel="noreferrer"><Icon name="whatsapp" size={17}/><span>Send WhatsApp reminder</span></a></div>) : <p className="empty-list">No follow-ups due {group.title.toLowerCase()}.</p>}</section>)}</div>}
        </div>}
        {screen === 'home' && <div className="home-grid"><div className="hero-copy"><span className="eyebrow"><span className="eyebrow-dot"/> THE CALMER WAY TO MANAGE YOUR CLINIC</span><h1>Great care.<br/><span>Smoother days.</span></h1><p className="hero-description">Give patients an easy way to find you and book a visit. Your clinic, ready for the day in just a few minutes.</p><div className="hero-actions"><button className="primary-button" onClick={() => setScreen('signup')}>Get started <Icon name="arrow" size={18}/></button><button className="secondary-button" onClick={() => setScreen('signin')}>Sign in</button><a className="secondary-button" href={publicPath} style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>Patient demo <Icon name="arrow" size={16}/></a></div><div className="hero-assurance"><span className="assurance-icon"><Icon name="heart" size={17}/></span><span>Thoughtful tools for<br/><b>independent clinics</b></span><span className="assurance-separator"/><span className="assurance-spark">✳</span><span>Set up in<br/><b>just a few minutes</b></span></div></div>
          <div className="visual-side"><div className="ambient ambient-one"/><div className="ambient ambient-two"/><div className="preview-label"><span className="online-dot"/> YOUR PRACTICE, ONLINE</div><div className="phone-card"><div className="phone-top"><span>9:41</span><span className="phone-icons">● ▮▮</span></div><div className="patient-preview"><div className="patient-topline"><div className="patient-mark"><Icon name="heart" size={18}/><b>carequeue</b></div><span className="patient-avatar">M</span></div><span className="patient-greeting">WELCOME TO</span><h3>{clinic}</h3><p>Care that fits into your day.</p><div className="patient-doctor"><div className="doctor-photo">{photo ? <img src={photo} alt="Doctor"/> : <span>MP</span>}</div><div><span className="patient-doctor-name">{doctor}</span><span className="patient-specialty">{specialty || 'Your doctor'}</span></div><span className="online-dot"/></div><div className="patient-divider"/><div className="patient-availability"><span>AVAILABLE TODAY</span><span className="available-label"><i/> Appointments open</span></div><div className="slot-row"><span>9:30 am</span><span>11:00 am</span><span>2:15 pm</span></div><a className="patient-book" href={publicPath} style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Find a time <Icon name="arrow" size={15}/></a></div><div className="phone-home"/></div><div className="float-card"><div className="float-icon"><Icon name="clock" size={18}/></div><div><b>Your time, back.</b><span>Less admin. More care.</span></div><span className="float-check">✓</span></div><div className="little-star star-one">✳</div><div className="little-star star-two">✳</div></div></div>}
        {isAuth && <div className="form-wrap auth-wrap"><button className="back-button" onClick={() => setScreen('home')}><Icon name="back" size={17}/> Back</button><div className="form-heading"><span className="form-icon"><Icon name="heart" size={21}/></span><span className="eyebrow">{screen === 'signup' ? 'A FRESH START FOR YOUR PRACTICE' : 'WELCOME BACK'}</span><h1>{screen === 'signup' ? 'Let’s get started.' : 'Good to see you.'}</h1><p>{screen === 'signup' ? 'Your own little corner of the internet for better patient care.' : 'Sign in to manage your practice and patient bookings.'}</p></div><form className="auth-form" onSubmit={e => { e.preventDefault(); saveAndGo('profile'); }}><label>Email address<input required type="email" placeholder="you@yourclinic.com" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email"/></label><label>Password<input required type="password" minLength={6} placeholder="At least 6 characters" value={password} onChange={e => setPassword(e.target.value)} autoComplete={screen === 'signup' ? 'new-password' : 'current-password'}/></label><button className="primary-button full-button" type="submit">{screen === 'signup' ? 'Create your account' : 'Sign in'} <Icon name="arrow" size={18}/></button></form><p className="auth-switch">{screen === 'signup' ? 'Already set up?' : 'New around here?'} <button onClick={() => setScreen(screen === 'signup' ? 'signin' : 'signup')}>{screen === 'signup' ? 'Sign in' : 'Create your account'}</button></p><p className="fine-print">By continuing, you agree to our <a href="#terms" onClick={e => { e.preventDefault(); setToast('Demo experience — no account is created'); }}>Terms</a> and <a href="#privacy" onClick={e => { e.preventDefault(); setToast('Demo experience — no data is shared'); }}>Privacy Policy</a>.</p></div>}
        {currentStep >= 0 && <><div className="setup-header"><div className="setup-overline">YOUR CLINIC, YOUR WAY <span>·</span> FREE SETUP</div><div className="mobile-progress-label"><span>STEP {currentStep + 1} OF 3</span><b>{steps[currentStep].label}</b></div><div className="progress-row">{steps.map((step, index) => <div key={step.id} className={`progress-step ${index === currentStep ? 'active' : ''} ${index < currentStep ? 'completed' : ''}`}><span className="step-number">{index < currentStep ? '✓' : step.number}</span><span className="step-label">{step.label}</span></div>)}</div><div className="progress-track"><div style={{ width: `${(currentStep / 2) * 100}%` }}/></div></div>
          {screen === 'profile' && <div className="form-wrap setup-wrap"><div className="page-title"><span className="eyebrow">A GOOD INTRODUCTION GOES A LONG WAY</span><h1>Let’s meet<br/><span>your practice.</span></h1><p>Tell patients a little about the person and place they’ll be visiting.</p></div><form className="profile-form" onSubmit={e => { e.preventDefault(); saveProfileAndContinue(); }}><div className="photo-picker"><button className="photo-circle" type="button" onClick={() => fileRef.current?.click()} aria-label="Upload profile photo">{photo ? <img src={photo} alt="Profile preview"/> : <span className="photo-monogram">MP</span>}<span className="camera-dot"><Icon name="camera" size={14}/></span></button><input ref={fileRef} className="visually-hidden" type="file" accept="image/*" onChange={e => uploadPhoto(e.target.files?.[0])}/><div className="photo-copy"><button type="button" onClick={() => fileRef.current?.click()}>{photo ? 'Change photo' : 'Add a profile photo'}</button><span>A friendly face goes a long way.</span></div></div><label>Doctor’s name<span className="input-shell"><input required value={doctor} onChange={e => setDoctor(e.target.value)} placeholder="e.g. Dr. Maya Patel"/></span></label><label>Clinic name<span className="input-shell"><input required value={clinic} onChange={e => setClinic(e.target.value)} placeholder="e.g. Willow Family Clinic"/></span></label><label>Specialty <span className="optional">OPTIONAL</span><span className="input-shell select-shell"><select value={specialty} onChange={e => setSpecialty(e.target.value)}><option value="">Choose a specialty</option>{specialties.map(s => <option key={s}>{s}</option>)}</select></span></label><div className="form-bottom"><button className="back-button" type="button" onClick={() => setScreen('home')}><Icon name="back" size={17}/> Back</button><button className="primary-button" type="submit">Continue <Icon name="arrow" size={18}/></button></div><div className="save-hint"><span className="save-dot"/> Your information is saved as you go.</div></form></div>}
          {screen === 'availability' && <div className="setup-wrap availability-wrap"><div className="page-title"><span className="eyebrow">SET YOUR BOOKABLE HOURS</span><h1>Clinic hours</h1><p>Add one or more appointment windows for each open day.</p></div><form onSubmit={e => { e.preventDefault(); saveHoursAndContinue(); }}><div className="hours-card">{days.map((day, index) => <section className={`day-card ${day.open ? 'day-open' : 'day-closed'}`} key={day.name}><div className="day-card-top"><div className="day-title"><span className="day-name">{day.name}</span><button className={`toggle ${day.open ? 'on' : ''}`} type="button" role="switch" aria-checked={day.open} aria-label={`${day.open ? 'Close' : 'Open'} ${day.name}`} onClick={() => updateDay(index, !day.open)}><span/></button><span className={`day-status ${day.open ? 'status-open' : ''}`}>{day.open ? 'Open' : 'Closed'}</span></div>{day.open && <button type="button" className="edit-day" aria-expanded={expandedDay === index} onClick={() => setExpandedDay(expandedDay === index ? null : index)}>{expandedDay === index ? 'Done' : 'Schedule'}</button>}</div>{day.open && <><div className="day-windows-summary"><span>{day.windows.map(window => window.start || window.end ? `${formatTime(window.start)} – ${formatTime(window.end)}` : 'New time window').join('  ·  ')}</span></div>{expandedDay === index && <div className="window-editor">{day.windows.map((window, windowIndex) => <div className="time-window" key={`${day.name}-${windowIndex}`}><label><span>FROM</span><input required aria-label={`${day.name}, window ${windowIndex + 1}, start`} type="time" value={window.start} onChange={e => updateWindow(index, windowIndex, 'start', e.target.value)}/></label><span className="window-separator">to</span><label><span>TO</span><input required aria-label={`${day.name}, window ${windowIndex + 1}, end`} type="time" value={window.end} onChange={e => updateWindow(index, windowIndex, 'end', e.target.value)}/></label><button type="button" className="remove-window" aria-label={`Remove ${day.name} window ${windowIndex + 1}`} disabled={day.windows.length === 1} onClick={() => removeWindow(index, windowIndex)}>×</button></div>)}<button type="button" className="add-window" onClick={() => addWindow(index)}>+ Add time window</button></div>}</>}</section>)}</div><div className="schedule-tip"><span className="tip-icon"><Icon name="clock" size={16}/></span><p>Patients will see appointment times within the windows you set.</p></div><div className="form-bottom"><button className="back-button" type="button" onClick={() => setScreen('profile')}><Icon name="back" size={17}/> Back</button><button className="primary-button" type="submit">Preview my page <Icon name="arrow" size={18}/></button></div></form></div>}
          {screen === 'link' && <div className="setup-wrap link-wrap"><div className="page-title link-title"><span className="eyebrow">LOOK AT YOU, ALL SET UP</span><h1>Your clinic is<br/><span>open for care.</span></h1><p>Share your page with patients so they can find you and book a visit.</p></div><div className="share-card"><div className="share-copy"><div className="share-status"><i/> YOUR PUBLIC BOOKING PAGE</div><h2>{clinic}</h2><p>Appointments, made a little easier.</p><div className="link-field"><span>↗</span><a href={publicLink}>{publicLink}</a></div><button className="primary-button copy-button" onClick={copyLink}><Icon name="copy" size={17}/>{copied ? 'Copied!' : 'Copy your link'}</button><div className="share-rule"/><div className="share-buttons"><button className="share-action" onClick={downloadQr}><Icon name="download" size={17}/><span>Download QR</span></button><a className="share-action whatsapp" href={`https://wa.me/?text=${encodeURIComponent(`Book an appointment with ${doctor} at ${clinic}: ${publicLink}`)}`} target="_blank" rel="noreferrer"><Icon name="whatsapp" size={18}/><span>Share on WhatsApp</span></a></div></div><div className="qr-side"><div className="qr-frame">{qr ? <img src={qr} alt={`QR code for ${clinic}'s booking page`}/> : <div className="qr-loading">Making your<br/>QR code…</div>}<span className="qr-corner qr-tl"/><span className="qr-corner qr-tr"/><span className="qr-corner qr-bl"/></div><span className="qr-caption">SCAN TO VISIT YOUR PAGE</span><span className="qr-subcaption">Print it, post it, share it anywhere.</span></div></div><button className="primary-button dashboard-launch" onClick={() => setScreen('queue')}>Open queue dashboard <Icon name="arrow" size={18}/></button><button className="edit-link" onClick={() => setScreen('availability')}><Icon name="back" size={15}/> Back to my hours</button><div className="celebrate"><span>✳</span> Thanks for caring. We’ll take it from here.</div></div>}
        </>}
        {screen === 'home' && <footer className="footer"><span>© 2026 CareQueue</span><span>Made for independent clinics <span className="footer-heart">♥</span></span></footer>}
      </section>
      {revisitPatientId && <div className="modal-scrim" onMouseDown={e => { if (e.target === e.currentTarget) setRevisitPatientId(null); }}><section className="revisit-modal" role="dialog" aria-modal="true" aria-labelledby="revisit-title"><button className="modal-close" type="button" aria-label="Close revisit options" onClick={() => setRevisitPatientId(null)}>×</button><span className="eyebrow">VISIT COMPLETED</span><h2 id="revisit-title">Schedule a revisit</h2><p>When should {patients.find(patient => patient.id === revisitPatientId)?.name} come back?</p><form onSubmit={e => { e.preventDefault(); saveDone(); }}><div className="revisit-options">{([{ value: 'none', label: 'No revisit' }, { value: '3', label: 'In 3 days' }, { value: '5', label: 'In 5 days' }, { value: '7', label: 'In 1 week' }, { value: 'custom', label: 'Choose a date' }] as { value: RevisitChoice; label: string }[]).map(option => <label className={`revisit-option ${revisitChoice === option.value ? 'selected' : ''}`} key={option.value}><input type="radio" name="revisit" value={option.value} checked={revisitChoice === option.value} onChange={() => setRevisitChoice(option.value)}/><span>{option.label}</span>{revisitChoice === option.value && <i>✓</i>}</label>)}</div>{revisitChoice === 'custom' && <label className="custom-date-field">Custom revisit date<input type="date" min={dateOffset(0)} value={customRevisitDate} onChange={e => setCustomRevisitDate(e.target.value)} required/></label>}<div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setRevisitPatientId(null)}>Cancel</button><button className="primary-button" type="submit" disabled={revisitChoice === 'custom' && (!customRevisitDate || customRevisitDate < dateOffset(0))}>{advanceAfterDone ? 'Save & next' : 'Save revisit'}</button></div></form></section></div>}
      {phoneSheetPatient && (
        <div
          className="modal-scrim"
          onMouseDown={e => {
            if (e.target === e.currentTarget) setPhoneSheetPatient(null);
          }}
        >
          <section className="phone-sheet-modal" role="dialog" aria-modal="true" aria-labelledby="phone-sheet-title">
            <button
              className="modal-close"
              type="button"
              aria-label="Close phone sheet"
              onClick={() => setPhoneSheetPatient(null)}
            >
              ×
            </button>
            <span className="eyebrow">PATIENT PHONE CALL</span>
            <h2 id="phone-sheet-title">{phoneSheetPatient.name}</h2>
            <p className="phone-sheet-sub">
              Queue number {phoneSheetPatient.queueNumber} · Arrived at {formatArrivalTime(phoneSheetPatient.createdAt)}
            </p>

            <div className="phone-sheet-contact-card">
              <span className="contact-label">PATIENT MOBILE</span>
              <div className="contact-main-row">
                <span className="contact-phone-number">{phoneSheetPatient.phone}</span>
                <button
                  type="button"
                  className="phone-sheet-copy-btn desktop-only"
                  onClick={() => copyPatientPhone(phoneSheetPatient.phone)}
                >
                  <Icon name="copy" size={15} />
                  <span>{phoneCopied ? 'Copied!' : 'Copy'}</span>
                </button>
              </div>

              {/* Mobile tap-to-call link */}
              <a
                href={`tel:${phoneSheetPatient.phone.replace(/[^\d+]/g, '')}`}
                className="phone-sheet-call-action mobile-only"
              >
                <Icon name="phone" size={16} />
                <span>Call {phoneSheetPatient.phone}</span>
              </a>

              {/* Desktop dialer app link */}
              <a
                href={`tel:${phoneSheetPatient.phone.replace(/[^\d+]/g, '')}`}
                className="phone-sheet-tel-link desktop-only"
              >
                <Icon name="phone" size={13} />
                <span>Call via dialer app</span>
              </a>
            </div>

            <div className="phone-sheet-outcomes">
              <span className="outcomes-kicker">AFTER THE CALL · SELECT OUTCOME</span>

              {/* Outcome 1: Coming */}
              <div className="outcome-card-coming">
                <div className="outcome-title-row">
                  <strong>1. Coming</strong>
                  <span>Keep as Now Serving & set arrival time</span>
                </div>
                <div className="outcome-chips-row">
                  <button
                    type="button"
                    className="outcome-chip"
                    onClick={() => handleOutcomeComing(5)}
                  >
                    5 minutes
                  </button>
                  <button
                    type="button"
                    className="outcome-chip"
                    onClick={() => handleOutcomeComing(10)}
                  >
                    10 minutes
                  </button>
                  <button
                    type="button"
                    className="outcome-chip"
                    onClick={() => handleOutcomeComing(15)}
                  >
                    15 minutes
                  </button>
                </div>
              </div>

              {/* Outcome 2: Not coming & Outcome 3: No answer */}
              <div className="outcome-duo-row">
                <button
                  type="button"
                  className="outcome-action-btn outcome-not-coming"
                  onClick={handleOutcomeNotComing}
                >
                  <span className="outcome-btn-heading">2. Not coming</span>
                  <span className="outcome-btn-sub">Mark cancelled · Next patient</span>
                </button>

                <button
                  type="button"
                  className="outcome-action-btn outcome-no-answer"
                  onClick={handleOutcomeNoAnswer}
                >
                  <span className="outcome-btn-heading">3. No answer</span>
                  <span className="outcome-btn-sub">Move to Skipped · Next patient</span>
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
      {helpOpen && (
        <div
          className="modal-scrim"
          onMouseDown={e => {
            if (e.target === e.currentTarget) setHelpOpen(false);
          }}
        >
          <section className="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title">
            <button
              className="modal-close"
              type="button"
              aria-label="Close help and support"
              onClick={() => setHelpOpen(false)}
            >
              ×
            </button>
            <span className="eyebrow">CAREQUEUE ASSISTANCE</span>
            <h2 id="help-title">Help and support</h2>
            <p className="help-modal-subtitle">
              Everything you need to run a calmer clinic and manage your queue smoothly.
            </p>

            <div className="help-channels">
              <a
                className="help-channel-card help-channel-wa"
                href="https://wa.me/?text=Hello%20CareQueue%20Support%2C%20I%20need%20help%20with%20my%20clinic%20setup."
                target="_blank"
                rel="noreferrer"
              >
                <div className="help-channel-icon wa-icon">
                  <Icon name="whatsapp" size={18} />
                </div>
                <div className="help-channel-info">
                  <strong>Chat on WhatsApp</strong>
                  <span>Quick help from our support team</span>
                </div>
                <span className="help-channel-arrow">→</span>
              </a>

              <a
                className="help-channel-card help-channel-email"
                href="mailto:support@carequeue.health?subject=CareQueue%20Help%20%26%20Support"
              >
                <div className="help-channel-icon email-icon">✉</div>
                <div className="help-channel-info">
                  <strong>Email support</strong>
                  <span>support@carequeue.health</span>
                </div>
                <span className="help-channel-arrow">→</span>
              </a>
            </div>

            <div className="help-faq-section">
              <h3>Frequently asked questions</h3>
              <details className="help-faq-item">
                <summary>How do patients join the queue?</summary>
                <p>
                  Patients scan your clinic’s QR code or visit your booking link on their mobile phone, pick an open window, and instantly receive their live queue number.
                </p>
              </details>
              <details className="help-faq-item">
                <summary>Do patients need to install an app?</summary>
                <p>
                  No app download is needed. CareQueue runs directly in mobile browsers with real-time updates and audio-visual turn alerts.
                </p>
              </details>
              <details className="help-faq-item">
                <summary>How do I call the next patient?</summary>
                <p>
                  From the Clinic Assistant dashboard, tap <strong>Next Patient</strong> to advance Now serving and notify the patient to enter the consultation room.
                </p>
              </details>
            </div>

            <button
              type="button"
              className="primary-button full-button help-got-it-btn"
              onClick={() => setHelpOpen(false)}
            >
              Got it
            </button>
          </section>
        </div>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}



