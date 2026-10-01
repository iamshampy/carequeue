/**
 * CareQueue Central Queue Store
 *
 * Single source of truth for clinic bookings and queue state, backed by localStorage.
 * Everything is keyed by clinic handle and date: `carequeue-queue:<handle>:<YYYY-MM-DD>`.
 *
 * Real-time synchronization is handled via BroadcastChannel (scoped by clinic handle),
 * with a cross-tab localStorage storage event fallback.
 */

import {
  pushBookingToSupabase,
  fetchQueueFromSupabase,
  pushArrivalNoticeToSupabase,
  deleteArrivalNoticeFromSupabase,
  subscribeToSupabase,
} from './supabaseSync';

export type BookingStatus = 'waiting' | 'serving' | 'done' | 'skipped' | 'cancelled';
export type Gender = 'male' | 'female' | 'other' | string;

export interface QueueBooking {
  id: string;
  trackingCode: string; // Random alphanumeric code, e.g. "TK8F92A1"
  handle: string; // Clinic handle, e.g. "willow-family-clinic"
  date: string; // YYYY-MM-DD
  session: string; // e.g. "09:00-17:00"
  queueNumber: number; // Plain integer (restarts daily: 1, 2, 3...)
  name: string;
  phone: string;
  age: number;
  gender: Gender;
  status: BookingStatus;
  revisitDate?: string; // YYYY-MM-DD
  comingInMinutes?: number; // e.g. 5, 10, 15
  comingInDeadline?: number; // Unix timestamp in ms
  createdAt: number; // Unix timestamp in ms
  startedAt?: number; // Unix timestamp in ms when called to serve
  completedAt?: number; // Unix timestamp in ms when marked done
}

export interface AddBookingInput {
  handle: string;
  date: string; // YYYY-MM-DD
  session: string;
  name: string;
  phone: string;
  age: number;
  gender: Gender;
  status?: BookingStatus;
  revisitDate?: string;
  id?: string;
  trackingCode?: string;
  createdAt?: number;
  startedAt?: number;
  completedAt?: number;
}

export interface ArrivalNotice {
  handle: string;
  trackingCode: string;
  queueNumber: number;
  minutes: number;
  until: number; // Unix timestamp in ms
  message: string;
  createdAt: number;
}

export interface QueueStoreEvent {
  type:
    | 'booking_added'
    | 'call_next'
    | 'marked_done'
    | 'marked_skipped'
    | 'marked_cancelled'
    | 'brought_back'
    | 'coming_in'
    | 'arrival_notice'
    | 'arrival_notice_cleared'
    | 'undo'
    | 'sync';
  handle: string;
  date?: string;
  bookingId?: string;
  trackingCode?: string;
  timestamp: number;
  [key: string]: unknown;
}

const QUEUE_STORAGE_PREFIX = 'carequeue-queue:';
const ARRIVAL_STORAGE_PREFIX = 'carequeue-arrival:';
const UNDO_STORAGE_PREFIX = 'carequeue-undo:';
const SYNC_STORAGE_PREFIX = 'carequeue-sync:';
const CHANNEL_PREFIX = 'carequeue-channel:';

/** Average minutes per consultation — used for wait-time estimates everywhere. */
export const AVG_CONSULT_MINUTES = 10;

/**
 * Thrown by addBooking when booking parameters fail validation.
 * The UI should catch this and display error.message directly to the patient.
 */
export class BookingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BookingValidationError';
  }
}

// In-memory BroadcastChannel cache to prevent memory leaks and redundant channel creation
const channelCache = new Map<string, BroadcastChannel>();

/**
 * Returns the localStorage key for a clinic's queue on a specific date.
 */
export function getQueueKey(handle: string, date: string): string {
  const cleanHandle = (handle || '').toLowerCase().trim();
  return `${QUEUE_STORAGE_PREFIX}${cleanHandle}:${date}`;
}

/**
 * Returns the localStorage key for a scoped patient arrival notice.
 */
export function getArrivalNoticeKey(handle: string, trackingCode: string): string {
  const cleanHandle = (handle || '').toLowerCase().trim();
  const cleanCode = (trackingCode || '').trim().toUpperCase();
  return `${ARRIVAL_STORAGE_PREFIX}${cleanHandle}:${cleanCode}`;
}

function getUndoKey(handle: string, date: string): string {
  const cleanHandle = (handle || '').toLowerCase().trim();
  return `${UNDO_STORAGE_PREFIX}${cleanHandle}:${date}`;
}

function getSyncKey(handle: string): string {
  const cleanHandle = (handle || '').toLowerCase().trim();
  return `${SYNC_STORAGE_PREFIX}${cleanHandle}`;
}

export function normalizeMobile(value: string): string {
  return (value || '').replace(/\D/g, '');
}

export function normalizeIndianMobile(value: string): string {
  const digits = normalizeMobile(value);
  if (digits.length > 10 && digits.startsWith('91')) return digits.slice(-10);
  return digits.slice(-10);
}

export function getTodayDateKey(d = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function createTrackingCode(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return 'TK' + crypto.randomUUID().replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase();
  }
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let result = 'TK';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function createBookingId(): string {
  return `bk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Clean plain integer conversion for queue numbers.
 * Never prefixes with '#' and never has leading zeros.
 */
export function parseQueueNumber(val: unknown): number {
  if (typeof val === 'number' && !isNaN(val)) return Math.floor(val);
  const digits = String(val || '').replace(/\D/g, '');
  const parsed = parseInt(digits, 10);
  return isNaN(parsed) ? 1 : parsed;
}

/**
 * Gets or creates a BroadcastChannel for a given clinic handle.
 */
function getBroadcastChannel(handle: string): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return null;
  }
  const cleanHandle = (handle || '').toLowerCase().trim();
  if (!channelCache.has(cleanHandle)) {
    try {
      const channel = new BroadcastChannel(`${CHANNEL_PREFIX}${cleanHandle}`);
      channelCache.set(cleanHandle, channel);
    } catch {
      return null;
    }
  }
  return channelCache.get(cleanHandle) || null;
}

/**
 * Broadcasts an event to all open tabs for this handle via BroadcastChannel
 * and writes to a sync localStorage key for storage event fallback.
 */
export function notifyChange(handle: string, detail: Partial<QueueStoreEvent> = {}) {
  if (typeof window === 'undefined') return;
  const cleanHandle = (handle || '').toLowerCase().trim();
  const event: QueueStoreEvent = {
    type: detail.type || 'sync',
    handle: cleanHandle,
    timestamp: Date.now(),
    ...detail,
  };

  // 1. BroadcastChannel (sub-millisecond tab-to-tab messaging)
  try {
    const channel = getBroadcastChannel(cleanHandle);
    channel?.postMessage(event);
  } catch {
    // safe fallback
  }

  // 2. Storage event fallback (guaranteed cross-tab trigger)
  try {
    localStorage.setItem(getSyncKey(cleanHandle), JSON.stringify(event));
  } catch {
    // safe fallback
  }
}

/**
 * Subscribes to real-time changes for a given clinic handle.
 * Listens to BroadcastChannel and window 'storage' events.
 * Returns an unsubscribe cleanup function.
 */
export function subscribe(
  handle: string,
  callback: (event?: QueueStoreEvent) => void
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const cleanHandle = (handle || '').toLowerCase().trim();

  // 1. BroadcastChannel listener
  const channel = getBroadcastChannel(cleanHandle);
  const onChannelMessage = (event: MessageEvent<QueueStoreEvent>) => {
    if (event.data && event.data.handle === cleanHandle) {
      callback(event.data);
    }
    // Ignore messages from other clinic handles on the same channel.
  };

  if (channel) {
    channel.addEventListener('message', onChannelMessage);
  }

  // 2. Storage event fallback
  const onStorage = (e: StorageEvent) => {
    if (!e.key) {
      callback();
      return;
    }
    if (
      e.key === getSyncKey(cleanHandle) ||
      e.key.startsWith(`${QUEUE_STORAGE_PREFIX}${cleanHandle}:`) ||
      e.key.startsWith(`${ARRIVAL_STORAGE_PREFIX}${cleanHandle}:`)
    ) {
      let eventPayload: QueueStoreEvent | undefined = undefined;
      if (e.newValue) {
        try {
          eventPayload = JSON.parse(e.newValue);
        } catch {
          // ignore parse error
        }
      }
      callback(eventPayload);
    }
  };

  // 3. Supabase Realtime listener
  const unsubSupabase = subscribeToSupabase(cleanHandle, () => {
    // When a change arrives via Supabase Realtime, fetch updated queue and notify
    const today = getTodayDateKey();
    fetchQueueFromSupabase(cleanHandle, today).then(remoteQueue => {
      if (remoteQueue && remoteQueue.length > 0) {
        try {
          localStorage.setItem(getQueueKey(cleanHandle, today), JSON.stringify(remoteQueue));
        } catch {}
      }
      callback();
    }).catch(() => {
      callback();
    });
  });

  return () => {
    if (channel) {
      channel.removeEventListener('message', onChannelMessage);
    }
    window.removeEventListener('storage', onStorage);
    unsubSupabase();
  };
}

/**
 * Saves a queue array to localStorage for a handle and date, and syncs to Supabase.
 */
function saveQueue(handle: string, date: string, queue: QueueBooking[]) {
  if (typeof window === 'undefined') return;
  const key = getQueueKey(handle, date);
  try {
    localStorage.setItem(key, JSON.stringify(queue));
  } catch {
    // safe fallback
  }

  // Asynchronously sync all bookings to Supabase in the background
  try {
    for (const b of queue) {
      pushBookingToSupabase(b).catch(() => {});
    }
  } catch {}
}

/**
 * Saves an undo snapshot of the queue state before a mutation.
 */
function pushUndoSnapshot(handle: string, date: string, queue: QueueBooking[]) {
  if (typeof window === 'undefined') return;
  const key = getUndoKey(handle, date);
  try {
    const raw = localStorage.getItem(key);
    const stack: QueueBooking[][] = raw ? JSON.parse(raw) : [];
    stack.push(queue);
    const trimmed = stack.slice(-15); // retain last 15 actions
    localStorage.setItem(key, JSON.stringify(trimmed));
  } catch {
    // safe fallback
  }
}

/**
 * Populates default demo seed bookings for Willow Family Clinic on today's date
 * with plain integer queue numbers (no leading zeros and no '#').
 */
/**
 * Returns the current queue for a clinic handle and date.
 * Returns an empty array if no bookings exist yet.
 */
export function getQueue(handle: string, date: string): QueueBooking[] {
  if (typeof window === 'undefined') return [];
  const cleanHandle = (handle || '').toLowerCase().trim();
  const key = getQueueKey(cleanHandle, date);

  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map(b => ({
          ...b,
          queueNumber: parseQueueNumber(b.queueNumber),
        }));
      }
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Loads demo patients into the queue by writing each booking through `addBooking`.
 */
export function loadDemoSeedBookings(handle: string, date: string): QueueBooking[] {
  const cleanHandle = (handle || '').toLowerCase().trim();
  const now = Date.now();
  const minute = 60 * 1000;

  const demoSeeds = [
    {
      name: 'Anaya Nair',
      phone: '+91 98765 40019',
      age: 28,
      gender: 'female',
      session: '09:00-17:00',
      status: 'done' as const,
      revisitDate: date,
      trackingCode: 'TK019PAST',
      createdAt: now - 95 * minute,
      startedAt: now - 85 * minute,
      completedAt: now - 75 * minute,
    },
    {
      name: 'Vivaan Kapoor',
      phone: '+91 98765 40020',
      age: 34,
      gender: 'male',
      session: '09:00-17:00',
      status: 'done' as const,
      trackingCode: 'TK020DONE',
      createdAt: now - 85 * minute,
      startedAt: now - 75 * minute,
      completedAt: now - 65 * minute,
    },
    {
      name: 'Sana Verma',
      phone: '+91 98765 40021',
      age: 45,
      gender: 'female',
      session: '09:00-17:00',
      status: 'done' as const,
      trackingCode: 'TK021DONE',
      createdAt: now - 75 * minute,
      startedAt: now - 65 * minute,
      completedAt: now - 55 * minute,
    },
    {
      name: 'Rohan Das',
      phone: '+91 98765 40023',
      age: 39,
      gender: 'male',
      session: '09:00-17:00',
      status: 'skipped' as const,
      trackingCode: 'TK023SKIP',
      createdAt: now - 60 * minute,
    },
    {
      name: 'Aarav Mehta',
      phone: '+91 98765 40024',
      age: 32,
      gender: 'male',
      session: '09:00-17:00',
      status: 'serving' as const,
      trackingCode: 'TK024SERV',
      createdAt: now - 50 * minute,
      startedAt: now - 8 * minute,
    },
    {
      name: 'Diya Shah',
      phone: '+91 98765 40025',
      age: 29,
      gender: 'female',
      session: '09:00-17:00',
      status: 'waiting' as const,
      trackingCode: 'TK025TODAY',
      createdAt: now - 40 * minute,
    },
    {
      name: 'Kabir Rao',
      phone: '+91 98765 40026',
      age: 35,
      gender: 'male',
      session: '09:00-17:00',
      status: 'waiting' as const,
      trackingCode: 'TK026FUTUR',
      createdAt: now - 35 * minute,
    },
    {
      name: 'Mira Iyer',
      phone: '+91 98765 40027',
      age: 41,
      gender: 'female',
      session: '09:00-17:00',
      status: 'waiting' as const,
      trackingCode: 'TK027MULTI1',
      createdAt: now - 25 * minute,
    },
  ];

  const added: QueueBooking[] = [];
  for (const seed of demoSeeds) {
    added.push(
      addBooking({
        handle: cleanHandle,
        date,
        session: seed.session,
        name: seed.name,
        phone: seed.phone,
        age: seed.age,
        gender: seed.gender,
        status: seed.status,
        revisitDate: seed.revisitDate,
        trackingCode: seed.trackingCode,
        createdAt: seed.createdAt,
        startedAt: seed.startedAt,
        completedAt: seed.completedAt,
      })
    );
  }
  return added;
}

/**
 * Check if a booking submit is a duplicate.
 * Detects:
 * 1. Rapid double-clicks (same phone, name, date within 2 minutes)
 * 2. Active booking already existing for the same phone, handle, date, and session
 */
export function findDuplicateBooking(
  existingQueue: QueueBooking[],
  candidate: { phone: string; name: string; session: string }
): QueueBooking | null {
  const normCandPhone = normalizeIndianMobile(candidate.phone);
  const normCandName = (candidate.name || '').trim().toLowerCase();

  for (const b of existingQueue) {
    if (b.status === 'cancelled') continue;
    const normPhone = normalizeIndianMobile(b.phone);
    const normName = (b.name || '').trim().toLowerCase();

    // Active booking in the exact same session
    if (normCandPhone && normPhone === normCandPhone && b.session === candidate.session) {
      return b;
    }

    // Rapid double submission within 2 minutes with matching phone and name
    if (
      normCandPhone &&
      normPhone === normCandPhone &&
      normCandName &&
      normCandName === normName &&
      Date.now() - b.createdAt < 2 * 60 * 1000
    ) {
      return b;
    }
  }

  return null;
}

/**
 * A privacy-safe projection of queue state for a single patient.
 * Never exposes other patients' names, phone numbers, ages, or genders.
 */
export interface PatientView {
  /** The patient's own booking fields, or null if not found. */
  booking: {
    id: string;
    trackingCode: string;
    handle: string;
    date: string;
    session: string;
    queueNumber: number;
    name: string;
    status: BookingStatus;
    revisitDate?: string;
    comingInMinutes?: number;
    comingInDeadline?: number;
    startedAt?: number;
    completedAt?: number;
    createdAt: number;
  } | null;
  /** Queue number currently being served, or null if not started. */
  nowServing: number | null;
  /** Patients with a lower queueNumber still waiting or serving. */
  patientsAhead: number;
  /** 1-based position (patientsAhead + 1). */
  position: number;
  /** Lowest queueNumber among done/serving patients — used for progress bar. */
  initialServing: number;
  /** Clinic display name read from carequeue-clinic:<handle>. */
  clinicName: string;
  /** Doctor display name read from carequeue-clinic:<handle>. */
  doctorName: string;
}

/**
 * Returns a privacy-safe view for a single patient by tracking code (or handle + tracking code).
 * Does NOT expose other patients' names, phone numbers, ages, or genders.
 * Returns null only if the tracking code cannot be found.
 */
export function getPatientView(handleOrCode: string, maybeCode?: string): PatientView | null {
  const trackingCode = (maybeCode || handleOrCode || '').trim().toUpperCase();
  const expectedHandle = maybeCode ? (handleOrCode || '').toLowerCase().trim() : '';
  const raw = getBookingByCode(trackingCode);
  if (!raw) return null;
  if (expectedHandle && raw.handle.toLowerCase().trim() !== expectedHandle) return null;

  const queue = getQueue(raw.handle, raw.date);
  const patientNum = raw.queueNumber;

  const nowServingEntry = queue.find(b => b.status === 'serving');
  const nowServing = nowServingEntry ? nowServingEntry.queueNumber : null;

  const patientsAhead = queue.filter(
    b => b.queueNumber < patientNum && (b.status === 'waiting' || b.status === 'serving')
  ).length;

  // Lowest number that has been served or is serving — used for progress bar.
  const doneOrServed = queue.filter(b => b.status === 'done' || b.status === 'serving');
  const initialServing = doneOrServed.length === 0
    ? patientNum
    : Math.min(...doneOrServed.map(b => b.queueNumber));

  // Read clinic display name and doctor name from the canonical store key.
  // Never use the handle slug as a display name.
  let clinicName = '';
  let doctorName = '';
  try {
    if (typeof window !== 'undefined') {
      const clinicRaw = localStorage.getItem(`carequeue-clinic:${raw.handle}`);
      if (clinicRaw) {
        const clinic = JSON.parse(clinicRaw) as { clinic?: string; doctor?: string };
        clinicName = clinic.clinic || '';
        doctorName = clinic.doctor || '';
      }
      if (!clinicName && raw.handle === 'willow-family-clinic') {
        clinicName = 'Willow Family Clinic';
        doctorName = 'Dr. Maya Patel';
      }
      if (!clinicName) {
        const adminRaw = localStorage.getItem('carequeue-admin-clinics');
        if (adminRaw) {
          const list = JSON.parse(adminRaw);
          if (Array.isArray(list)) {
            const match = list.find((c: any) => c.handle?.toLowerCase() === raw.handle.toLowerCase());
            if (match) {
              clinicName = match.name || '';
              doctorName = match.doctorName || '';
            }
          }
        }
      }
    }
  } catch {
    // safe fallback — display names remain empty strings
  }

  return {
    booking: {
      id: raw.id,
      trackingCode: raw.trackingCode,
      handle: raw.handle,
      date: raw.date,
      session: raw.session,
      queueNumber: raw.queueNumber,
      name: raw.name,
      status: raw.status,
      revisitDate: raw.revisitDate,
      comingInMinutes: raw.comingInMinutes,
      comingInDeadline: raw.comingInDeadline,
      startedAt: raw.startedAt,
      completedAt: raw.completedAt,
      createdAt: raw.createdAt,
    },
    nowServing,
    patientsAhead,
    position: patientsAhead + 1,
    initialServing,
    clinicName,
    doctorName,
  };
}

/**
 * Adds a new booking to the queue.
 * Assigns the next sequential queueNumber (restarts each day: 1, 2, 3...).
 * Blocks duplicate submits by returning the existing booking without increments.
 * Throws BookingValidationError for date-window, closed-day, or ended-session violations.
 */
export function addBooking(input: AddBookingInput): QueueBooking {
  const cleanHandle = (input.handle || '').toLowerCase().trim();
  const date = input.date;

  // ── Validation (throws BookingValidationError for UI-displayable messages) ─
  const todayKey = getTodayDateKey();
  const maxDateObj = new Date();
  maxDateObj.setDate(maxDateObj.getDate() + 15);
  const maxKey = getTodayDateKey(maxDateObj);

  if (date < todayKey || date > maxKey) {
    throw new BookingValidationError(
      'Bookings are only accepted for today through the next 15 days.'
    );
  }

  if (typeof window !== 'undefined') {
    try {
      const clinicRaw = localStorage.getItem(`carequeue-clinic:${cleanHandle}`);
      if (clinicRaw) {
        type ScheduleDay = { name: string; open: boolean; windows?: { start: string; end: string }[] };
        const clinicData = JSON.parse(clinicRaw) as { days?: ScheduleDay[] };

        if (Array.isArray(clinicData.days)) {
          const weekdayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
          const dayOfWeek = weekdayNames[new Date(`${date}T12:00:00`).getDay()];
          const scheduleDay = clinicData.days.find(
            d => d.name?.toLowerCase() === dayOfWeek.toLowerCase()
          );

          if (!scheduleDay?.open || !scheduleDay.windows?.length) {
            throw new BookingValidationError(
              `The clinic is closed on ${dayOfWeek}s. Please choose another day.`
            );
          }

          // If booking is for today, ensure the chosen session has not already ended.
          if (date === todayKey && input.session) {
            const sessionParts = input.session.split('-');
            const sessionEnd = sessionParts[sessionParts.length - 1]?.trim();
            if (sessionEnd && /^\d{2}:\d{2}$/.test(sessionEnd)) {
              const [endHour, endMin] = sessionEnd.split(':').map(Number);
              const now = new Date();
              const endMinutes = endHour * 60 + endMin;
              const currentMinutes = now.getHours() * 60 + now.getMinutes();
              if (currentMinutes >= endMinutes) {
                throw new BookingValidationError(
                  'This session has already ended for today. Please choose another time.'
                );
              }
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof BookingValidationError) throw err;
      // Ignore storage/parse errors — do not block the booking
    }
  }
  // ── End validation ─────────────────────────────────────────────────────────

  const currentQueue = getQueue(cleanHandle, date);

  // Duplicate submission check
  const duplicate = findDuplicateBooking(currentQueue, {
    phone: input.phone,
    name: input.name,
    session: input.session,
  });

  if (duplicate) {
    return duplicate;
  }

  // Queue numbers restart each day: next number is max(queueNumber) + 1, or 1 if empty
  const maxNumber = currentQueue.reduce((max, b) => Math.max(max, parseQueueNumber(b.queueNumber)), 0);
  const nextQueueNumber = maxNumber > 0 ? maxNumber + 1 : 1;

  const newBooking: QueueBooking = {
    id: input.id || createBookingId(),
    trackingCode: input.trackingCode || createTrackingCode(),
    handle: cleanHandle,
    date,
    session: input.session,
    queueNumber: nextQueueNumber,
    name: input.name.trim(),
    phone: input.phone.trim(),
    age: input.age,
    gender: input.gender,
    status: input.status || 'waiting',
    revisitDate: input.revisitDate,
    createdAt: input.createdAt || Date.now(),
    startedAt: input.startedAt,
    completedAt: input.completedAt,
  };

  const nextQueue = [...currentQueue, newBooking];
  saveQueue(cleanHandle, date, nextQueue);

  notifyChange(cleanHandle, {
    type: 'booking_added',
    date,
    bookingId: newBooking.id,
    trackingCode: newBooking.trackingCode,
  });

  return newBooking;
}

/**
 * Finds a booking across all queues by its tracking code.
 */
export function getBookingByCode(code: string): QueueBooking | null {
  if (typeof window === 'undefined' || !code) return null;
  const searchCode = code.trim().toUpperCase();

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(QUEUE_STORAGE_PREFIX)) continue;

      const raw = localStorage.getItem(key);
      if (!raw) continue;

      const queue: QueueBooking[] = JSON.parse(raw);
      if (!Array.isArray(queue)) continue;

      const match = queue.find(
        b => b.trackingCode && b.trackingCode.toUpperCase() === searchCode
      );
      if (match) {
        return {
          ...match,
          queueNumber: parseQueueNumber(match.queueNumber),
        };
      }
    }
  } catch {
    return null;
  }

  // Fallback 1: check legacy carequeue-patient-bookings
  try {
    const raw = localStorage.getItem('carequeue-patient-bookings');
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        const found = list.find((b: any) => b.trackingCode && b.trackingCode.toUpperCase() === searchCode);
        if (found) {
          const converted: QueueBooking = {
            id: found.id || createBookingId(),
            trackingCode: found.trackingCode,
            handle: found.clinicSlug || 'willow-family-clinic',
            date: found.date || getTodayDateKey(),
            session: found.session || '09:00-17:00',
            queueNumber: parseQueueNumber(found.queueNumber),
            name: found.patientName || 'Patient',
            phone: found.mobile || '',
            age: found.age || 30,
            gender: found.gender || 'other',
            status: found.status === 'completed' ? 'done' : 'waiting',
            revisitDate: found.revisitDate,
            createdAt: found.createdAt || Date.now(),
          };
          const currentQueue = getQueue(converted.handle, converted.date);
          if (!currentQueue.some(b => b.trackingCode.toUpperCase() === searchCode)) {
            currentQueue.push(converted);
            saveQueue(converted.handle, converted.date, currentQueue);
          }
          return converted;
        }
      }
    }
  } catch {}

  // Fallback 2: If willow today queue is not yet populated, seed it and check
  try {
    const today = getTodayDateKey();
    const willowKey = getQueueKey('willow-family-clinic', today);
    if (!localStorage.getItem(willowKey)) {
      const seeded = loadDemoSeedBookings('willow-family-clinic', today);
      const match = seeded.find(b => b.trackingCode && b.trackingCode.toUpperCase() === searchCode);
      if (match) {
        return {
          ...match,
          queueNumber: parseQueueNumber(match.queueNumber),
        };
      }
    }
  } catch {}

  return null;
}

/**
 * Returns all bookings matching a phone number for a given clinic handle across all dates.
 */
export function getBookingsByPhone(handle: string, phone: string): QueueBooking[] {
  if (typeof window === 'undefined' || !handle || !phone) return [];
  const cleanHandle = (handle || '').toLowerCase().trim();
  const searchPhone = normalizeIndianMobile(phone);
  if (!searchPhone) return [];

  const results: QueueBooking[] = [];
  const prefix = `${QUEUE_STORAGE_PREFIX}${cleanHandle}:`;

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(prefix)) continue;

      const raw = localStorage.getItem(key);
      if (!raw) continue;

      const queue: QueueBooking[] = JSON.parse(raw);
      if (!Array.isArray(queue)) continue;

      for (const b of queue) {
        const norm = normalizeIndianMobile(b.phone);
        if (norm === searchPhone && b.status !== 'cancelled') {
          results.push({
            ...b,
            queueNumber: parseQueueNumber(b.queueNumber),
          });
        }
      }
    }
  } catch {
    return [];
  }

  // Sort by date ascending, then session, then queueNumber
  return results.sort((a, b) => {
    const dComp = a.date.localeCompare(b.date);
    if (dComp !== 0) return dComp;
    return a.queueNumber - b.queueNumber;
  });
}

/**
 * Advances the queue:
 * - If someone is currently serving, marks them done (completedAt = now).
 * - Finds the first waiting patient and marks them serving (startedAt = now).
 * Saves an undo snapshot and broadcasts the change.
 */
export function callNext(
  handle: string,
  date: string
): { previousServing: QueueBooking | null; nowServing: QueueBooking | null } {
  const cleanHandle = (handle || '').toLowerCase().trim();
  const currentQueue = getQueue(cleanHandle, date);

  pushUndoSnapshot(cleanHandle, date, currentQueue);

  let previousServing: QueueBooking | null = null;
  let nextQueue = currentQueue.map(b => {
    if (b.status === 'serving') {
      previousServing = { ...b };
      return {
        ...b,
        status: 'done' as const,
        completedAt: Date.now(),
        comingInMinutes: undefined,
        comingInDeadline: undefined,
      };
    }
    return b;
  });

  const nextWaiting = nextQueue.find(b => b.status === 'waiting');
  let nowServing: QueueBooking | null = null;

  if (nextWaiting) {
    nextQueue = nextQueue.map(b => {
      if (b.id === nextWaiting.id) {
        nowServing = {
          ...b,
          status: 'serving' as const,
          startedAt: Date.now(),
        };
        return nowServing;
      }
      return b;
    });
  }

  saveQueue(cleanHandle, date, nextQueue);

  notifyChange(cleanHandle, {
    type: 'call_next',
    date,
    previousServingId: previousServing ? (previousServing as QueueBooking).id : undefined,
    nowServingId: nowServing ? (nowServing as QueueBooking).id : undefined,
  });

  return { previousServing, nowServing };
}

/**
 * Marks a specific booking as done, optionally saving a follow-up revisit date.
 */
export function markDone(
  handle: string,
  date: string,
  bookingId: string,
  revisitDate?: string
): QueueBooking | null {
  const cleanHandle = (handle || '').toLowerCase().trim();
  const currentQueue = getQueue(cleanHandle, date);

  const target = currentQueue.find(b => b.id === bookingId || b.trackingCode === bookingId);
  if (!target) return null;

  pushUndoSnapshot(cleanHandle, date, currentQueue);

  let updatedBooking: QueueBooking | null = null;
  const nextQueue = currentQueue.map(b => {
    if (b.id === target.id) {
      updatedBooking = {
        ...b,
        status: 'done' as const,
        completedAt: Date.now(),
        revisitDate: revisitDate || b.revisitDate,
        comingInMinutes: undefined,
        comingInDeadline: undefined,
      };
      return updatedBooking;
    }
    return b;
  });

  saveQueue(cleanHandle, date, nextQueue);
  clearArrivalNotice(cleanHandle, target.trackingCode);

  notifyChange(cleanHandle, {
    type: 'marked_done',
    date,
    bookingId: target.id,
    trackingCode: target.trackingCode,
    revisitDate,
  });

  return updatedBooking;
}

/**
 * Marks a specific booking as skipped ("Not here" or "No answer").
 */
export function markSkipped(handle: string, date: string, bookingId: string): QueueBooking | null {
  const cleanHandle = (handle || '').toLowerCase().trim();
  const currentQueue = getQueue(cleanHandle, date);

  const target = currentQueue.find(b => b.id === bookingId || b.trackingCode === bookingId);
  if (!target) return null;

  pushUndoSnapshot(cleanHandle, date, currentQueue);

  let updatedBooking: QueueBooking | null = null;
  const nextQueue = currentQueue.map(b => {
    if (b.id === target.id) {
      updatedBooking = {
        ...b,
        status: 'skipped' as const,
        comingInMinutes: undefined,
        comingInDeadline: undefined,
      };
      return updatedBooking;
    }
    return b;
  });

  saveQueue(cleanHandle, date, nextQueue);
  clearArrivalNotice(cleanHandle, target.trackingCode);

  notifyChange(cleanHandle, {
    type: 'marked_skipped',
    date,
    bookingId: target.id,
    trackingCode: target.trackingCode,
  });

  return updatedBooking;
}

/**
 * Marks a specific booking as cancelled ("Not coming").
 */
export function markCancelled(handle: string, date: string, bookingId: string): QueueBooking | null {
  const cleanHandle = (handle || '').toLowerCase().trim();
  const currentQueue = getQueue(cleanHandle, date);

  const target = currentQueue.find(b => b.id === bookingId || b.trackingCode === bookingId);
  if (!target) return null;

  pushUndoSnapshot(cleanHandle, date, currentQueue);

  let updatedBooking: QueueBooking | null = null;
  const nextQueue = currentQueue.map(b => {
    if (b.id === target.id) {
      updatedBooking = {
        ...b,
        status: 'cancelled' as const,
        comingInMinutes: undefined,
        comingInDeadline: undefined,
      };
      return updatedBooking;
    }
    return b;
  });

  saveQueue(cleanHandle, date, nextQueue);
  clearArrivalNotice(cleanHandle, target.trackingCode);

  notifyChange(cleanHandle, {
    type: 'marked_cancelled',
    date,
    bookingId: target.id,
    trackingCode: target.trackingCode,
  });

  return updatedBooking;
}

/**
 * Brings a skipped or cancelled patient back into the queue.
 * Inserts them right after the currently serving patient (so they are next in line).
 */
export function bringBack(handle: string, date: string, bookingId: string): QueueBooking | null {
  const cleanHandle = (handle || '').toLowerCase().trim();
  const currentQueue = getQueue(cleanHandle, date);

  const target = currentQueue.find(b => b.id === bookingId || b.trackingCode === bookingId);
  if (!target) return null;

  pushUndoSnapshot(cleanHandle, date, currentQueue);

  const restoredPatient: QueueBooking = {
    ...target,
    status: 'waiting' as const,
    comingInMinutes: undefined,
    comingInDeadline: undefined,
  };

  const listWithout = currentQueue.filter(b => b.id !== target.id);
  const servingIdx = listWithout.findIndex(b => b.status === 'serving');

  let nextQueue: QueueBooking[];
  if (servingIdx >= 0) {
    // Put patient right after the current serving patient
    nextQueue = [
      ...listWithout.slice(0, servingIdx + 1),
      restoredPatient,
      ...listWithout.slice(servingIdx + 1),
    ];
  } else {
    // Put at top of waiting line
    nextQueue = [restoredPatient, ...listWithout];
  }

  saveQueue(cleanHandle, date, nextQueue);

  notifyChange(cleanHandle, {
    type: 'brought_back',
    date,
    bookingId: target.id,
    trackingCode: target.trackingCode,
  });

  return restoredPatient;
}

/**
 * Scopes the "patient is on the way" arrival notice strictly by handle and trackingCode.
 */
export function setArrivalNotice(
  handle: string,
  trackingCode: string,
  queueNumber: number,
  minutes: number
): ArrivalNotice {
  const cleanHandle = (handle || '').toLowerCase().trim();
  const cleanCode = (trackingCode || '').trim().toUpperCase();
  const until = Date.now() + minutes * 60 * 1000;

  const notice: ArrivalNotice = {
    handle: cleanHandle,
    trackingCode: cleanCode,
    queueNumber,
    minutes,
    until,
    message: `The clinic is waiting for you. Please come in within ${minutes} minutes.`,
    createdAt: Date.now(),
  };

  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(getArrivalNoticeKey(cleanHandle, cleanCode), JSON.stringify(notice));
    } catch {
      // safe fallback
    }
  }

  // Push to Supabase in the background
  try {
    pushArrivalNoticeToSupabase(notice).catch(() => {});
  } catch {}

  notifyChange(cleanHandle, {
    type: 'arrival_notice',
    trackingCode: cleanCode,
    minutes,
  });

  return notice;
}

/**
 * Retrieves the arrival notice for a patient, strictly checking expiration.
 */
export function getArrivalNotice(handle: string, trackingCode: string): ArrivalNotice | null {
  if (typeof window === 'undefined' || !handle || !trackingCode) return null;
  const cleanHandle = (handle || '').toLowerCase().trim();
  const cleanCode = (trackingCode || '').trim().toUpperCase();

  try {
    const raw = localStorage.getItem(getArrivalNoticeKey(cleanHandle, cleanCode));
    if (!raw) return null;
    const parsed: ArrivalNotice = JSON.parse(raw);
    if (parsed && typeof parsed.until === 'number') {
      if (parsed.until > Date.now()) {
        return parsed;
      }
      // Clean expired notice
      localStorage.removeItem(getArrivalNoticeKey(cleanHandle, cleanCode));
      return null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Clears the scoped arrival notice for a patient.
 */
export function clearArrivalNotice(handle: string, trackingCode: string): void {
  if (typeof window === 'undefined' || !handle || !trackingCode) return;
  const cleanHandle = (handle || '').toLowerCase().trim();
  const cleanCode = (trackingCode || '').trim().toUpperCase();

  try {
    localStorage.removeItem(getArrivalNoticeKey(cleanHandle, cleanCode));
  } catch {
    // safe fallback
  }

  // Delete from Supabase in the background
  try {
    deleteArrivalNoticeFromSupabase(cleanHandle, cleanCode).catch(() => {});
  } catch {}

  notifyChange(cleanHandle, {
    type: 'arrival_notice_cleared',
    trackingCode: cleanCode,
  });
}

/**
 * Sets the "Coming in X minutes" outcome on a patient in the queue.
 * Updates both the booking record and the scoped arrival notice.
 */
export function setComingIn(
  handle: string,
  date: string,
  bookingId: string,
  minutes: number
): QueueBooking | null {
  const cleanHandle = (handle || '').toLowerCase().trim();
  const currentQueue = getQueue(cleanHandle, date);

  const target = currentQueue.find(b => b.id === bookingId || b.trackingCode === bookingId);
  if (!target) return null;

  pushUndoSnapshot(cleanHandle, date, currentQueue);

  const deadline = Date.now() + minutes * 60 * 1000;
  let updatedBooking: QueueBooking | null = null;

  const nextQueue = currentQueue.map(b => {
    if (b.id === target.id) {
      updatedBooking = {
        ...b,
        comingInMinutes: minutes,
        comingInDeadline: deadline,
      };
      return updatedBooking;
    }
    return b;
  });

  saveQueue(cleanHandle, date, nextQueue);
  setArrivalNotice(cleanHandle, target.trackingCode, target.queueNumber, minutes);

  notifyChange(cleanHandle, {
    type: 'coming_in',
    date,
    bookingId: target.id,
    trackingCode: target.trackingCode,
    minutes,
  });

  return updatedBooking;
}

/**
 * Reverts the queue to its previous state from the undo snapshot stack.
 */
export function undoLast(handle: string, date: string): boolean {
  if (typeof window === 'undefined') return false;
  const cleanHandle = (handle || '').toLowerCase().trim();
  const key = getUndoKey(cleanHandle, date);

  try {
    const raw = localStorage.getItem(key);
    if (!raw) return false;

    const stack: QueueBooking[][] = JSON.parse(raw);
    if (!Array.isArray(stack) || stack.length === 0) return false;

    const previousQueue = stack.pop();
    localStorage.setItem(key, JSON.stringify(stack));

    if (previousQueue && Array.isArray(previousQueue)) {
      // Snapshot the current queue BEFORE overwriting so we can detect which
      // bookings are losing their comingInMinutes as a result of this undo.
      const currentQueue = getQueue(cleanHandle, date);
      const currentMap = new Map(currentQueue.map(b => [b.id, b]));

      saveQueue(cleanHandle, date, previousQueue);

      // Update arrival notices:
      // 1. Clear arrival notices for any booking that had comingInMinutes set
      //    before the undo but no longer has it in the restored snapshot.
      // 2. Re-set arrival notices for any booking whose comingInMinutes is restored
      //    and whose deadline has not expired yet.
      for (const restored of previousQueue) {
        const prev = currentMap.get(restored.id);
        if (prev?.comingInMinutes && !restored.comingInMinutes) {
          clearArrivalNotice(cleanHandle, restored.trackingCode);
        } else if (!prev?.comingInMinutes && restored.comingInMinutes && restored.comingInDeadline && restored.comingInDeadline > Date.now()) {
          const remainingMinutes = Math.max(1, Math.round((restored.comingInDeadline - Date.now()) / (60 * 1000)));
          setArrivalNotice(cleanHandle, restored.trackingCode, restored.queueNumber, remainingMinutes);
        }
      }

      notifyChange(cleanHandle, {
        type: 'undo',
        date,
      });
      return true;
    }

    return false;
  } catch {
    return false;
  }
}
