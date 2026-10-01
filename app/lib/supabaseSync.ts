import { supabase, isSupabaseConfigured } from './supabase';
import type { QueueBooking, ArrivalNotice } from './queueStore';
import type { StoredClinic, ClinicHoursDay } from './patient-bookings';

// Cache clinic UUID lookups by handle
const clinicIdCache = new Map<string, string>();

/**
 * Resolves the Supabase clinic UUID from handle.
 */
export async function getClinicIdByHandle(handle: string): Promise<string | null> {
  const cleanHandle = (handle || '').toLowerCase().trim();
  if (!cleanHandle || !isSupabaseConfigured) return null;

  if (clinicIdCache.has(cleanHandle)) {
    return clinicIdCache.get(cleanHandle)!;
  }

  try {
    const { data, error } = await supabase
      .from('clinics')
      .select('id')
      .eq('handle', cleanHandle)
      .maybeSingle();

    if (error || !data) return null;
    clinicIdCache.set(cleanHandle, data.id);
    return data.id;
  } catch {
    return null;
  }
}

/**
 * Maps a camelCase QueueBooking object to snake_case Supabase bookings table row.
 */
export function toSupabaseBooking(clinicId: string, b: QueueBooking) {
  return {
    id: b.id,
    clinic_id: clinicId,
    tracking_code: b.trackingCode,
    date: b.date,
    session: b.session,
    queue_number: b.queueNumber,
    name: b.name,
    phone: b.phone,
    age: b.age || 0,
    gender: b.gender || 'female',
    status: b.status,
    revisit_date: b.revisitDate || null,
    coming_in_minutes: b.comingInMinutes || null,
    coming_in_deadline: b.comingInDeadline ? new Date(b.comingInDeadline).toISOString() : null,
    started_at: b.startedAt ? new Date(b.startedAt).toISOString() : null,
    completed_at: b.completedAt ? new Date(b.completedAt).toISOString() : null,
    created_at: new Date(b.createdAt || Date.now()).toISOString(),
  };
}

/**
 * Maps a Supabase bookings table row to camelCase QueueBooking object.
 */
export function fromSupabaseBooking(handle: string, row: any): QueueBooking {
  return {
    id: row.id,
    trackingCode: row.tracking_code,
    handle: handle.toLowerCase().trim(),
    date: row.date,
    session: row.session,
    queueNumber: Number(row.queue_number),
    name: row.name,
    phone: row.phone,
    age: Number(row.age) || 0,
    gender: row.gender,
    status: row.status,
    revisitDate: row.revisit_date || undefined,
    comingInMinutes: row.coming_in_minutes || undefined,
    comingInDeadline: row.coming_in_deadline ? new Date(row.coming_in_deadline).getTime() : undefined,
    startedAt: row.started_at ? new Date(row.started_at).getTime() : undefined,
    completedAt: row.completed_at ? new Date(row.completed_at).getTime() : undefined,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
  };
}

/**
 * Uploads/upserts a single booking to Supabase in the background.
 */
export async function pushBookingToSupabase(booking: QueueBooking): Promise<void> {
  if (!isSupabaseConfigured) return;
  try {
    const clinicId = await getClinicIdByHandle(booking.handle);
    if (!clinicId) return;

    const row = toSupabaseBooking(clinicId, booking);
    await supabase.from('bookings').upsert(row, { onConflict: 'clinic_id,date,queue_number' });
  } catch (err) {
    console.warn('[Supabase] pushBookingToSupabase error:', err);
  }
}

/**
 * Fetches the queue for a clinic on a specific date from Supabase.
 */
export async function fetchQueueFromSupabase(handle: string, date: string): Promise<QueueBooking[] | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const clinicId = await getClinicIdByHandle(handle);
    if (!clinicId) return null;

    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('clinic_id', clinicId)
      .eq('date', date)
      .order('queue_number', { ascending: true });

    if (error || !data) return null;
    return data.map(row => fromSupabaseBooking(handle, row));
  } catch (err) {
    console.warn('[Supabase] fetchQueueFromSupabase error:', err);
    return null;
  }
}

/**
 * Fetches a single booking by tracking code from Supabase.
 */
export async function fetchBookingByCodeFromSupabase(trackingCode: string): Promise<QueueBooking | null> {
  if (!isSupabaseConfigured || !trackingCode) return null;
  try {
    const cleanCode = trackingCode.trim().toUpperCase();
    const { data, error } = await supabase
      .from('bookings')
      .select('*, clinics(handle)')
      .eq('tracking_code', cleanCode)
      .maybeSingle();

    if (error || !data) return null;
    const clinicHandle = (data as any).clinics?.handle || 'willow-family-clinic';
    return fromSupabaseBooking(clinicHandle, data);
  } catch (err) {
    console.warn('[Supabase] fetchBookingByCodeFromSupabase error:', err);
    return null;
  }
}

/**
 * Upserts a patient arrival notice to Supabase.
 */
export async function pushArrivalNoticeToSupabase(notice: ArrivalNotice): Promise<void> {
  if (!isSupabaseConfigured) return;
  try {
    const clinicId = await getClinicIdByHandle(notice.handle);
    if (!clinicId) return;

    await supabase.from('arrival_notices').upsert({
      clinic_id: clinicId,
      tracking_code: notice.trackingCode.toUpperCase(),
      queue_number: notice.queueNumber,
      minutes: notice.minutes,
      until: new Date(notice.until).toISOString(),
      message: notice.message,
      created_at: new Date(notice.createdAt).toISOString(),
    }, { onConflict: 'clinic_id,tracking_code' });
  } catch (err) {
    console.warn('[Supabase] pushArrivalNoticeToSupabase error:', err);
  }
}

/**
 * Deletes a patient arrival notice from Supabase.
 */
export async function deleteArrivalNoticeFromSupabase(handle: string, trackingCode: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  try {
    const clinicId = await getClinicIdByHandle(handle);
    if (!clinicId) return;

    await supabase
      .from('arrival_notices')
      .delete()
      .eq('clinic_id', clinicId)
      .eq('tracking_code', trackingCode.toUpperCase());
  } catch (err) {
    console.warn('[Supabase] deleteArrivalNoticeFromSupabase error:', err);
  }
}

/**
 * Subscribes to Supabase Realtime changes for a clinic.
 * Triggers callback whenever bookings or arrival notices change on Supabase.
 */
export function subscribeToSupabase(handle: string, onUpdate: () => void): () => void {
  if (!isSupabaseConfigured || typeof window === 'undefined') {
    return () => {};
  }

  const cleanHandle = (handle || '').toLowerCase().trim();
  const channelName = `realtime-clinic-${cleanHandle}`;

  const channel = supabase.channel(channelName)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'bookings' },
      () => { onUpdate(); }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'arrival_notices' },
      () => { onUpdate(); }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel).catch(() => {});
  };
}

/**
 * Fetches clinic profile and hours from Supabase.
 */
export async function fetchClinicFromSupabase(handle: string): Promise<StoredClinic | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const cleanHandle = (handle || '').toLowerCase().trim();
    const { data: clinic, error } = await supabase
      .from('clinics')
      .select('*')
      .eq('handle', cleanHandle)
      .maybeSingle();

    if (error || !clinic) return null;

    const { data: hours } = await supabase
      .from('clinic_hours')
      .select('*')
      .eq('clinic_id', clinic.id)
      .order('day_of_week', { ascending: true });

    const days: ClinicHoursDay[] = (hours && hours.length > 0)
      ? hours.map(h => ({
          name: h.day_name,
          open: h.is_open,
          windows: Array.isArray(h.windows) ? h.windows : [],
        }))
      : [
          { name: 'Monday', open: true, windows: [{ start: '09:00', end: '17:00' }] },
          { name: 'Tuesday', open: true, windows: [{ start: '09:00', end: '17:00' }] },
          { name: 'Wednesday', open: true, windows: [{ start: '09:00', end: '17:00' }] },
          { name: 'Thursday', open: true, windows: [{ start: '09:00', end: '17:00' }] },
          { name: 'Friday', open: true, windows: [{ start: '09:00', end: '16:00' }] },
          { name: 'Saturday', open: false, windows: [] },
          { name: 'Sunday', open: false, windows: [] },
        ];

    return {
      handle: clinic.handle,
      clinic: clinic.name,
      doctor: clinic.doctor_name,
      specialty: clinic.specialty,
      photo: clinic.photo || '',
      days,
    };
  } catch (err) {
    console.warn('[Supabase] fetchClinicFromSupabase error:', err);
    return null;
  }
}

/**
 * Saves/updates a clinic profile and its hours in Supabase.
 */
export async function saveClinicToSupabase(stored: StoredClinic): Promise<void> {
  if (!isSupabaseConfigured) return;
  try {
    const { data: clinic, error } = await supabase
      .from('clinics')
      .upsert({
        handle: stored.handle.toLowerCase().trim(),
        name: stored.clinic,
        doctor_name: stored.doctor,
        specialty: stored.specialty,
        photo: stored.photo || '',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'handle' })
      .select('id')
      .single();

    if (error || !clinic) return;

    if (Array.isArray(stored.days)) {
      const weekdayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      const rows = stored.days.map(d => {
        const dayIdx = weekdayNames.findIndex(w => w.toLowerCase() === d.name.toLowerCase());
        return {
          clinic_id: clinic.id,
          day_of_week: dayIdx >= 0 ? dayIdx : 0,
          day_name: d.name,
          is_open: Boolean(d.open),
          windows: d.windows || [],
        };
      });

      await supabase.from('clinic_hours').upsert(rows, { onConflict: 'clinic_id,day_of_week' });
    }
  } catch (err) {
    console.warn('[Supabase] saveClinicToSupabase error:', err);
  }
}
