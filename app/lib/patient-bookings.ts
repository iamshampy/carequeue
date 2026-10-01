import { saveClinicToSupabase, fetchClinicFromSupabase } from './supabaseSync';

export type ClinicHoursDay = { name: string; open: boolean; windows: { start: string; end: string }[] };
export type PublicClinicConfig = { doctor: string; clinic: string; specialty: string; photo?: string; days: ClinicHoursDay[] };

const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function encodeBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodePublicClinicConfig(config: PublicClinicConfig) {
  const compactDays = weekdayNames.map(name => {
    const day = config.days.find(item => item.name.toLowerCase() === name.toLowerCase());
    const windows = day?.open ? day.windows.map(window => `${window.start.replace(':', '')}-${window.end.replace(':', '')}`).join(',') : '';
    return `${day?.open ? '1' : '0'}${windows ? `:${windows}` : ''}`;
  }).join('.');
  const photoMatch = config.photo?.match(/^data:image\/(webp|jpeg|png);base64,(.+)$/);
  const photo = photoMatch ? `${photoMatch[1] === 'webp' ? 'w' : photoMatch[1] === 'jpeg' ? 'j' : 'p'}${photoMatch[2].replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}` : '';
  return ['2', encodeBase64Url(config.doctor), encodeBase64Url(config.clinic), encodeBase64Url(config.specialty), photo, compactDays].join('~');
}

export function decodePublicClinicConfig(value: string): PublicClinicConfig | null {
  try {
    const parts = value.split('~');
    const [version, encodedDoctor, encodedClinic, encodedSpecialty] = parts;
    const photoToken = version === '2' ? parts[4] : '';
    const compactDays = version === '2' ? parts[5] : parts[4];
    if (!['1', '2'].includes(version) || !encodedDoctor || !encodedClinic || !compactDays) return null;
    const days = compactDays.split('.').map((entry, index) => {
      const open = entry.startsWith('1');
      const compactWindows = entry.slice(1).replace(/^:/, '');
      const windows = compactWindows ? compactWindows.split(',').flatMap(window => {
        const match = /^(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(window);
        return match ? [{ start: `${match[1]}:${match[2]}`, end: `${match[3]}:${match[4]}` }] : [];
      }) : [];
      return { name: weekdayNames[index] || '', open: open && windows.length > 0, windows };
    });
    if (days.length !== 7) return null;
    let photo = '';
    if (photoToken) {
      const type = photoToken[0] === 'w' ? 'webp' : photoToken[0] === 'j' ? 'jpeg' : photoToken[0] === 'p' ? 'png' : '';
      if (type) {
        const data = photoToken.slice(1);
        const base64 = data.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - data.length % 4) % 4);
        photo = `data:image/${type};base64,${base64}`;
      }
    }
    return { doctor: decodeBase64Url(encodedDoctor), clinic: decodeBase64Url(encodedClinic), specialty: encodedSpecialty ? decodeBase64Url(encodedSpecialty) : '', photo, days };
  } catch {
    return null;
  }
}

export function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function normalizeMobile(value: string) {
  return value.replace(/\D/g, '');
}

export function normalizeIndianMobile(value: string) {
  const digits = normalizeMobile(value);
  if (digits.length > 10 && digits.startsWith('91')) return digits.slice(-10);
  return digits.slice(0, 10);
}

export const DEVICE_BOOKINGS_STORAGE_KEY = 'carequeue-device-bookings';
export const DEVICE_VERIFIED_PHONES_KEY = 'carequeue-device-verified-phones';

export function isBookingSavedOnDevice(clinicSlug: string, phone10: string, trackingCodes: string[]): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const rawCodes = localStorage.getItem(DEVICE_BOOKINGS_STORAGE_KEY);
    const savedCodes: string[] = rawCodes ? JSON.parse(rawCodes) : [];
    if (Array.isArray(savedCodes) && trackingCodes.some(code => savedCodes.includes(code))) {
      return true;
    }

    const rawPhones = localStorage.getItem(DEVICE_VERIFIED_PHONES_KEY);
    const savedPhones: string[] = rawPhones ? JSON.parse(rawPhones) : [];
    if (Array.isArray(savedPhones) && savedPhones.includes(phone10)) {
      return true;
    }

    const lastMobile = normalizeMobile(localStorage.getItem(`carequeue-last-mobile:${clinicSlug}`) || '').slice(-10);
    if (lastMobile === phone10) {
      return true;
    }

    if (localStorage.getItem(`carequeue-known-mobile:${clinicSlug}:${phone10}`) === '1') {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function saveBookingOnDevice(clinicSlug: string, phone10: string, trackingCodes: string[]) {
  if (typeof window === 'undefined') return;
  try {
    const rawCodes = localStorage.getItem(DEVICE_BOOKINGS_STORAGE_KEY);
    const savedCodes: string[] = rawCodes ? JSON.parse(rawCodes) : [];
    const newCodes = Array.from(new Set([...(Array.isArray(savedCodes) ? savedCodes : []), ...trackingCodes]));
    localStorage.setItem(DEVICE_BOOKINGS_STORAGE_KEY, JSON.stringify(newCodes));

    const rawPhones = localStorage.getItem(DEVICE_VERIFIED_PHONES_KEY);
    const savedPhones: string[] = rawPhones ? JSON.parse(rawPhones) : [];
    const newPhones = Array.from(new Set([...(Array.isArray(savedPhones) ? savedPhones : []), phone10]));
    localStorage.setItem(DEVICE_VERIFIED_PHONES_KEY, JSON.stringify(newPhones));

    localStorage.setItem(`carequeue-known-mobile:${clinicSlug}:${phone10}`, '1');
    localStorage.setItem(`carequeue-last-mobile:${clinicSlug}`, `+91${phone10}`);
  } catch {
    // continue
  }
}

export function clinicSlugFromName(name: string) {
  return name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'your-clinic';
}

export const RESERVED_HANDLES = new Set([
  'login',
  'signup',
  'signin',
  'dashboard',
  'admin',
  'api',
  'c',
  't',
  'setup',
  'settings',
  'queue',
  'profile',
  'hours',
  'link',
]);

export function generateClinicHandle(
  clinicName: string,
  existingHandles: string[] = [],
  currentHandle?: string
): string {
  // Once created, the handle never changes, even if the clinic name is edited
  if (currentHandle && currentHandle.trim().length > 0) {
    return currentHandle.trim().toLowerCase();
  }

  // 1. Lowercase the clinic name, normalize unicode accents
  let cleaned = (clinicName || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  // 2. Replace spaces and symbols with hyphens, remove other characters
  cleaned = cleaned.replace(/[^a-z0-9]+/g, '-');

  // 3. Collapse repeated hyphens
  cleaned = cleaned.replace(/-+/g, '-');

  // 4. Remove leading and trailing hyphens
  cleaned = cleaned.replace(/^-+|-+$/g, '');

  // 5. Trim to 30 characters
  cleaned = cleaned.slice(0, 30).replace(/-+$/, '');

  // 6. If nothing usable remains, use "clinic-" plus 6 random lowercase characters
  if (!cleaned || !/[a-z0-9]/.test(cleaned)) {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    let rnd = '';
    for (let i = 0; i < 6; i++) {
      rnd += chars[Math.floor(Math.random() * chars.length)];
    }
    cleaned = `clinic-${rnd}`;
  }

  // 7. Check if already used by another saved clinic or is reserved; append -2, -3, and so on
  const existingSet = new Set(existingHandles.map(h => h.toLowerCase()));
  let candidate = cleaned;
  if (RESERVED_HANDLES.has(candidate.toLowerCase()) || existingSet.has(candidate.toLowerCase())) {
    let counter = 2;
    while (
      RESERVED_HANDLES.has(`${cleaned}-${counter}`.toLowerCase()) ||
      existingSet.has(`${cleaned}-${counter}`.toLowerCase())
    ) {
      counter++;
    }
    candidate = `${cleaned}-${counter}`;
  }

  return candidate;
}

export type StoredClinic = {
  handle: string;
  clinic: string;
  doctor: string;
  specialty: string;
  photo?: string;
  days: ClinicHoursDay[];
  createdAt?: number;
  updatedAt?: number;
};

export const HANDLES_STORAGE_KEY = 'carequeue-handles';
export const CLINIC_STORAGE_PREFIX = 'carequeue-clinic:';

export function readAllHandles(): string[] {
  if (typeof window === 'undefined') return ['willow-family-clinic'];
  try {
    const raw = localStorage.getItem(HANDLES_STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    const valid: string[] = Array.isArray(list) ? list.filter(item => typeof item === 'string') : [];
    if (!valid.includes('willow-family-clinic')) {
      valid.unshift('willow-family-clinic');
      localStorage.setItem(HANDLES_STORAGE_KEY, JSON.stringify(valid));
    }
    return valid;
  } catch {
    return ['willow-family-clinic'];
  }
}

export function getStoredClinic(handle: string): StoredClinic | null {
  if (typeof window === 'undefined' || !handle) return null;
  const cleanHandle = handle.toLowerCase().trim();
  const key = `${CLINIC_STORAGE_PREFIX}${cleanHandle}`;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.clinic === 'string') return parsed;
    }
    // Fallback seed for default demo clinic
    if (cleanHandle === 'willow-family-clinic') {
      const seed: StoredClinic = {
        handle: 'willow-family-clinic',
        clinic: 'Willow Family Clinic',
        doctor: 'Dr. Maya Patel',
        specialty: 'Family medicine',
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
        createdAt: Date.now() - 1000 * 60 * 60 * 24,
        updatedAt: Date.now(),
      };
      saveStoredClinic(seed);
      return seed;
    }
    // Background fetch from Supabase if not found locally
    if (typeof window !== 'undefined') {
      fetchClinicFromSupabase(cleanHandle).then(remote => {
        if (remote) {
          saveStoredClinic(remote);
        }
      }).catch(() => {});
    }

    return null;
  } catch {
    return null;
  }
}

export function saveStoredClinic(clinicData: StoredClinic): string {
  if (typeof window === 'undefined') return clinicData.handle;
  const cleanHandle = clinicData.handle.toLowerCase().trim();
  try {
    const dataToSave: StoredClinic = {
      ...clinicData,
      handle: cleanHandle,
      updatedAt: Date.now(),
    };
    localStorage.setItem(`${CLINIC_STORAGE_PREFIX}${cleanHandle}`, JSON.stringify(dataToSave));

    const handles = readAllHandles();
    if (!handles.includes(cleanHandle)) {
      handles.push(cleanHandle);
      localStorage.setItem(HANDLES_STORAGE_KEY, JSON.stringify(handles));
    }

    // Sync clinic profile and hours to Supabase in the background
    try {
      saveClinicToSupabase(dataToSave).catch(() => {});
    } catch {}
  } catch {
    // safe fallback
  }
  return cleanHandle;
}

export function cleanQueueNumber(val: string | number | undefined | null): string {
  if (val === undefined || val === null || val === '') return '';
  const digits = String(val).replace(/\D/g, '');
  if (!digits) return String(val).replace(/^#/, '');
  const parsed = parseInt(digits, 10);
  return isNaN(parsed) ? String(val).replace(/^#/, '') : String(parsed);
}

