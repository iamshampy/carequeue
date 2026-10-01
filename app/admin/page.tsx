'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

// ============================================================================
// TODO: SERVER-SIDE SUPER ADMIN AUTHENTICATION
// In production, replace this local "admin mode" client-side flag with a robust
// server-side auth gate. Example implementation with Supabase Auth / Next.js Server Components:
//
//   import { createServerClient } from '@supabase/ssr';
//   import { cookies } from 'next/headers';
//   import { redirect } from 'next/navigation';
//
//   export default async function AdminPage() {
//     const cookieStore = cookies();
//     const supabase = createServerClient(...);
//     const { data: { user } } = await supabase.auth.getUser();
//     if (!user) redirect('/signin?redirect=/admin');
//
//     const { data: profile } = await supabase
//       .from('profiles')
//       .select('role')
//       .eq('id', user.id)
//       .single();
//
//     if (profile?.role !== 'super_admin') {
//       redirect('/?error=unauthorized');
//     }
//     ...
//   }
//
// This ensures super admin analytics, clinic management, and operational data
// are never exposed to unauthorized users over the wire.
// ============================================================================

export type AdminRole = 'Owner' | 'Sales' | 'Support';
export type ClinicStatus = 'Trial' | 'Active' | 'Suspended' | 'Blocked';
export type ClinicPlan = 'Trial' | 'Starter' | 'Professional' | 'Clinic Pro';

export type OnboardingChecklist = {
  profile: boolean;
  hours: boolean;
  qrPlaced: boolean;
  firstBooking: boolean;
  assistantTrained: boolean;
};

export type AdminClinic = {
  id: string;
  name: string;
  doctorName: string;
  handle: string;
  signupDate: string; // ISO date 'YYYY-MM-DD'
  appointmentsThisWeek: number; // Plain count
  lastActiveDate: string; // ISO date 'YYYY-MM-DD'
  totalAppointments: number; // Plain count
  specialty: string;
  city: string;
  status: ClinicStatus;
  verified: boolean;
  internalNotes: string;
  plan: ClinicPlan;
  trialExpiry: string; // ISO date 'YYYY-MM-DD'
  paidUntil?: string; // ISO date 'YYYY-MM-DD'
  onboarding: OnboardingChecklist;
};

export type LeadStage = 'Lead' | 'Demo given' | 'Signed up' | 'Activated' | 'Paying';

export type SalesLead = {
  id: string;
  name: string; // Doctor / Clinic Lead Contact Name
  phone: string; // Clinic Contact Phone
  city: string;
  owner: string; // Sales Owner
  nextFollowUpDate: string; // ISO date 'YYYY-MM-DD'
  stage: LeadStage;
  notes: string;
  createdAt: string;
};

export type AuditLogEntry = {
  id: string;
  time: string; // Formatted date & time
  adminName: string; // Name & Role
  action: string;
  clinic: string; // Affected Clinic or Target
};

function AdminIcon({ name, size = 18 }: { name: string; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  };
  if (name === 'heart') return <svg {...common}><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" /></svg>;
  if (name === 'arrow') return <svg {...common}><path d="M5 12h14m-6-6 6 6-6 6" /></svg>;
  if (name === 'back') return <svg {...common}><path d="m15 18-6-6 6-6M9 12h12" /></svg>;
  if (name === 'phone') return <svg {...common}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.2-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.8 2.1Z"/></svg>;
  if (name === 'copy') return <svg {...common}><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>;
  if (name === 'search') return <svg {...common}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>;
  if (name === 'check') return <svg {...common}><path d="M20 6 9 17l-5-5"/></svg>;
  if (name === 'lock') return <svg {...common}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>;
  return null;
}

const SEED_CLINICS: AdminClinic[] = [
  {
    id: 'c-01',
    name: 'Willow Family Clinic',
    doctorName: 'Dr. Maya Patel',
    handle: 'willow-family-clinic',
    signupDate: '2026-09-28',
    appointmentsThisWeek: 56,
    lastActiveDate: '2026-10-01',
    totalAppointments: 142,
    specialty: 'Family medicine',
    city: 'Bengaluru',
    status: 'Active',
    verified: true,
    internalNotes: 'Flagship demo clinic. Dr. Maya requested multi-doctor token display for November rollout.',
    plan: 'Professional',
    trialExpiry: '2026-10-28',
    paidUntil: '2026-12-31',
    onboarding: {
      profile: true,
      hours: true,
      qrPlaced: true,
      firstBooking: true,
      assistantTrained: true,
    },
  },
  {
    id: 'c-02',
    name: 'City Health Centre',
    doctorName: 'Dr. Rajesh Sharma',
    handle: 'city-health-centre',
    signupDate: '2026-09-29',
    appointmentsThisWeek: 48,
    lastActiveDate: '2026-10-01',
    totalAppointments: 92,
    specialty: 'Internal medicine',
    city: 'Mumbai',
    status: 'Trial',
    verified: true,
    internalNotes: 'On day 3 of 14-day trial. Assistant Sunita trained on tap-to-call phone outcomes.',
    plan: 'Trial',
    trialExpiry: '2026-10-13',
    onboarding: {
      profile: true,
      hours: true,
      qrPlaced: true,
      firstBooking: true,
      assistantTrained: true,
    },
  },
  {
    id: 'c-03',
    name: 'Metro Pediatric Care',
    doctorName: 'Dr. Priya Nair',
    handle: 'metro-pediatric-care',
    signupDate: '2026-09-26',
    appointmentsThisWeek: 38,
    lastActiveDate: '2026-09-30',
    totalAppointments: 110,
    specialty: 'Pediatrics',
    city: 'Kochi',
    status: 'Active',
    verified: true,
    internalNotes: 'High patient satisfaction with soft chime and vibration notifications.',
    plan: 'Professional',
    trialExpiry: '2026-10-26',
    paidUntil: '2026-11-30',
    onboarding: {
      profile: true,
      hours: true,
      qrPlaced: true,
      firstBooking: true,
      assistantTrained: true,
    },
  },
  {
    id: 'c-04',
    name: 'Sunlight Dermatology',
    doctorName: 'Dr. Ananya Sen',
    handle: 'sunlight-dermatology',
    signupDate: '2026-09-25',
    appointmentsThisWeek: 31,
    lastActiveDate: '2026-10-01',
    totalAppointments: 85,
    specialty: 'Dermatology',
    city: 'Kolkata',
    status: 'Trial',
    verified: false,
    internalNotes: 'Waiting room standee QR delivered via courier. Waiting for placement verification.',
    plan: 'Trial',
    trialExpiry: '2026-10-09',
    onboarding: {
      profile: true,
      hours: true,
      qrPlaced: false,
      firstBooking: true,
      assistantTrained: false,
    },
  },
  {
    id: 'c-05',
    name: 'Apex Orthopedics & Sports Care',
    doctorName: 'Dr. Vikram Rao',
    handle: 'apex-orthopedics',
    signupDate: '2026-09-15',
    appointmentsThisWeek: 24,
    lastActiveDate: '2026-09-29',
    totalAppointments: 215,
    specialty: 'Orthopedics',
    city: 'Hyderabad',
    status: 'Active',
    verified: true,
    internalNotes: 'Annual subscriber. Uses morning and evening split OPD sessions.',
    plan: 'Clinic Pro',
    trialExpiry: '2026-10-15',
    paidUntil: '2027-09-15',
    onboarding: {
      profile: true,
      hours: true,
      qrPlaced: true,
      firstBooking: true,
      assistantTrained: true,
    },
  },
  {
    id: 'c-06',
    name: 'Lotus Dental Practice',
    doctorName: 'Dr. Rohan Gupta',
    handle: 'lotus-dental-practice',
    signupDate: '2026-09-10',
    appointmentsThisWeek: 19,
    lastActiveDate: '2026-09-30',
    totalAppointments: 178,
    specialty: 'Dentistry',
    city: 'Delhi NCR',
    status: 'Active',
    verified: true,
    internalNotes: 'Receptionist handles walk-ins and QR bookings through CareQueue dashboard.',
    plan: 'Starter',
    trialExpiry: '2026-10-10',
    paidUntil: '2026-11-10',
    onboarding: {
      profile: true,
      hours: true,
      qrPlaced: true,
      firstBooking: true,
      assistantTrained: true,
    },
  },
  {
    id: 'c-07',
    name: 'Blossom Children’s Clinic',
    doctorName: 'Dr. Kavita Reddy',
    handle: 'blossom-children-clinic',
    signupDate: '2026-08-28',
    appointmentsThisWeek: 29,
    lastActiveDate: '2026-10-01',
    totalAppointments: 320,
    specialty: 'Pediatrics',
    city: 'Chennai',
    status: 'Active',
    verified: true,
    internalNotes: 'Parent feedback praised the calm countdown and waiting room peace.',
    plan: 'Professional',
    trialExpiry: '2026-09-28',
    paidUntil: '2026-12-28',
    onboarding: {
      profile: true,
      hours: true,
      qrPlaced: true,
      firstBooking: true,
      assistantTrained: true,
    },
  },
  {
    id: 'c-08',
    name: 'St. Jude Family Medicine',
    doctorName: 'Dr. Amit Verma',
    handle: 'st-jude-family-medicine',
    signupDate: '2026-08-14',
    appointmentsThisWeek: 14,
    lastActiveDate: '2026-09-28',
    totalAppointments: 260,
    specialty: 'Family medicine',
    city: 'Pune',
    status: 'Active',
    verified: false,
    internalNotes: 'Requested additional assistant login account.',
    plan: 'Starter',
    trialExpiry: '2026-09-14',
    paidUntil: '2026-10-14',
    onboarding: {
      profile: true,
      hours: true,
      qrPlaced: true,
      firstBooking: true,
      assistantTrained: false,
    },
  },
  {
    id: 'c-09',
    name: 'CarePoint Cardiology & Diabetes',
    doctorName: 'Dr. Sneha Kulkarni',
    handle: 'carepoint-cardiology',
    signupDate: '2026-08-02',
    appointmentsThisWeek: 22,
    lastActiveDate: '2026-09-29',
    totalAppointments: 295,
    specialty: 'Cardiology',
    city: 'Nagpur',
    status: 'Trial',
    verified: true,
    internalNotes: 'Evaluating Pro plan after hospital board review.',
    plan: 'Trial',
    trialExpiry: '2026-10-05',
    onboarding: {
      profile: true,
      hours: true,
      qrPlaced: true,
      firstBooking: true,
      assistantTrained: true,
    },
  },
  {
    id: 'c-10',
    name: 'Horizon Eye Hospital',
    doctorName: 'Dr. Arjun Deshmukh',
    handle: 'horizon-eye-hospital',
    signupDate: '2026-07-19',
    appointmentsThisWeek: 17,
    lastActiveDate: '2026-09-27',
    totalAppointments: 380,
    specialty: 'Ophthalmology',
    city: 'Ahmedabad',
    status: 'Active',
    verified: true,
    internalNotes: 'High volume OPD on Tuesday and Friday mornings.',
    plan: 'Clinic Pro',
    trialExpiry: '2026-08-19',
    paidUntil: '2027-01-19',
    onboarding: {
      profile: true,
      hours: true,
      qrPlaced: true,
      firstBooking: true,
      assistantTrained: true,
    },
  },
  {
    id: 'c-11',
    name: 'Greenfield Medical Centre',
    doctorName: 'Dr. Pooja Joshi',
    handle: 'greenfield-medical',
    signupDate: '2026-06-30',
    appointmentsThisWeek: 8,
    lastActiveDate: '2026-09-25',
    totalAppointments: 410,
    specialty: 'General practice',
    city: 'Jaipur',
    status: 'Suspended',
    verified: false,
    internalNotes: 'Clinic undergoing premise renovation until mid October. Suspended by clinic request.',
    plan: 'Starter',
    trialExpiry: '2026-07-30',
    onboarding: {
      profile: true,
      hours: true,
      qrPlaced: true,
      firstBooking: true,
      assistantTrained: true,
    },
  },
  {
    id: 'c-12',
    name: 'Zenith Wellness & Rehab',
    doctorName: 'Dr. Siddharth Malhotra',
    handle: 'zenith-wellness',
    signupDate: '2026-05-12',
    appointmentsThisWeek: 0,
    lastActiveDate: '2026-09-18',
    totalAppointments: 190,
    specialty: 'Rehabilitation',
    city: 'Chandigarh',
    status: 'Blocked',
    verified: false,
    internalNotes: 'Payment dispute pending. Account blocked on 18th Sept.',
    plan: 'Starter',
    trialExpiry: '2026-06-12',
    onboarding: {
      profile: true,
      hours: true,
      qrPlaced: false,
      firstBooking: true,
      assistantTrained: false,
    },
  },
];

const SEED_LEADS: SalesLead[] = [
  {
    id: 'lead-01',
    name: 'Dr. Ritu Verma (Sunrise Clinic)',
    phone: '+91 98234 56789',
    city: 'Pune',
    owner: 'Rahul Mehta',
    nextFollowUpDate: '2026-10-01', // Due today!
    stage: 'Lead',
    notes: 'Expressed strong interest in reducing crowded reception lobby. Requested 15 min OPD demo.',
    createdAt: '2026-09-29',
  },
  {
    id: 'lead-02',
    name: 'Dr. Aakash Singhania (Delhi Dental Lounge)',
    phone: '+91 98112 34567',
    city: 'Delhi NCR',
    owner: 'Pooja Sharma',
    nextFollowUpDate: '2026-10-02',
    stage: 'Lead',
    notes: 'Inbound inquiry from Instagram medical ad. Wants WhatsApp booking link integration.',
    createdAt: '2026-09-30',
  },
  {
    id: 'lead-03',
    name: 'Dr. Meenakshi Sundaram (Apex PolyClinic)',
    phone: '+91 94441 23890',
    city: 'Chennai',
    owner: 'Rahul Mehta',
    nextFollowUpDate: '2026-10-01', // Due today!
    stage: 'Demo given',
    notes: 'Product demo given to doctor & head receptionist yesterday. Reviewing pricing with co-founder.',
    createdAt: '2026-09-27',
  },
  {
    id: 'lead-04',
    name: 'Dr. Sameer Joshi (Joshi Child Care)',
    phone: '+91 97654 32109',
    city: 'Nagpur',
    owner: 'Dr. Admin',
    nextFollowUpDate: '2026-10-04',
    stage: 'Demo given',
    notes: 'Liked clean medical queue token display. Waiting for partner doctor approval.',
    createdAt: '2026-09-28',
  },
  {
    id: 'lead-05',
    name: 'Dr. Neha Kapoor (Kapoor Skin & Laser)',
    phone: '+91 99001 87654',
    city: 'Bengaluru',
    owner: 'Pooja Sharma',
    nextFollowUpDate: '2026-10-01', // Due today!
    stage: 'Signed up',
    notes: 'Registered handle /kapoor-skin-care. Needs assistance configuring split Saturday hours.',
    createdAt: '2026-09-25',
  },
  {
    id: 'lead-06',
    name: 'Dr. Farooq Khan (CareFirst Clinic)',
    phone: '+91 98490 12345',
    city: 'Hyderabad',
    owner: 'Rahul Mehta',
    nextFollowUpDate: '2026-10-03',
    stage: 'Signed up',
    notes: 'Clinic profile created. Assistant will attend demo training call tomorrow.',
    createdAt: '2026-09-26',
  },
  {
    id: 'lead-07',
    name: 'Dr. Tanvi Merchant (SmileWorks Dental)',
    phone: '+91 98200 45678',
    city: 'Mumbai',
    owner: 'Pooja Sharma',
    nextFollowUpDate: '2026-10-01', // Due today!
    stage: 'Activated',
    notes: 'Printed standee QR placed in reception. Assistant loves the tap-to-call Phone outcome sheet.',
    createdAt: '2026-09-22',
  },
  {
    id: 'lead-08',
    name: 'Dr. Aniruddh Bose (Bose Ortho Clinic)',
    phone: '+91 98310 98765',
    city: 'Kolkata',
    owner: 'Dr. Admin',
    nextFollowUpDate: '2026-10-05',
    stage: 'Activated',
    notes: 'First 25 patient queue tokens successfully handled without reception congestion.',
    createdAt: '2026-09-20',
  },
  {
    id: 'lead-09',
    name: 'Dr. Harish Kothari (Kothari Hospital OPD)',
    phone: '+91 98250 11223',
    city: 'Ahmedabad',
    owner: 'Rahul Mehta',
    nextFollowUpDate: '2026-10-18',
    stage: 'Paying',
    notes: 'Subscribed to Annual Pro Plan. Sent GST tax invoice and onboarding certificate.',
    createdAt: '2026-09-12',
  },
  {
    id: 'lead-10',
    name: 'Dr. Shalini Swaminathan (Lotus Pediatrics)',
    phone: '+91 94470 55443',
    city: 'Kochi',
    owner: 'Dr. Admin',
    nextFollowUpDate: '2026-10-25',
    stage: 'Paying',
    notes: 'Active paying clinic on Clinic Pro plan. Extremely satisfied with live waiting page.',
    createdAt: '2026-09-10',
  },
];

const SEED_AUDIT_LOG: AuditLogEntry[] = [
  {
    id: 'log-01',
    time: '01 Oct 2026, 11:20 AM',
    adminName: 'Dr. Admin (Owner)',
    action: 'Verified clinic profile and QR standee',
    clinic: 'Willow Family Clinic',
  },
  {
    id: 'log-02',
    time: '01 Oct 2026, 10:45 AM',
    adminName: 'Pooja (Sales)',
    action: 'Moved sales lead to Activated stage',
    clinic: 'Dr. Tanvi Merchant (SmileWorks Dental)',
  },
  {
    id: 'log-03',
    time: '01 Oct 2026, 09:30 AM',
    adminName: 'Vikram (Support)',
    action: 'Completed assistant training checklist step',
    clinic: 'City Health Centre',
  },
  {
    id: 'log-04',
    time: '30 Sep 2026, 05:15 PM',
    adminName: 'Dr. Admin (Owner)',
    action: 'Extended trial by 7 days',
    clinic: 'CarePoint Cardiology & Diabetes',
  },
  {
    id: 'log-05',
    time: '30 Sep 2026, 03:00 PM',
    adminName: 'Vikram (Support)',
    action: 'Added internal note: Saturday split hours configured',
    clinic: 'Lotus Dental Practice',
  },
  {
    id: 'log-06',
    time: '29 Sep 2026, 02:40 PM',
    adminName: 'Dr. Admin (Owner)',
    action: 'Marked clinic as paid until 31 Dec 2026',
    clinic: 'Willow Family Clinic',
  },
  {
    id: 'log-07',
    time: '28 Sep 2026, 11:10 AM',
    adminName: 'Vikram (Support)',
    action: 'Changed status to Suspended upon clinic request for renovation',
    clinic: 'Greenfield Medical Centre',
  },
  {
    id: 'log-08',
    time: '27 Sep 2026, 04:00 PM',
    adminName: 'Pooja (Sales)',
    action: 'Scheduled follow-up demo for Apex PolyClinic',
    clinic: 'Dr. Meenakshi Sundaram (Apex PolyClinic)',
  },
];

const ADMIN_STORAGE_KEY = 'carequeue-admin-clinics';
const ADMIN_MODE_KEY = 'carequeue_admin_mode';
const ADMIN_ROLE_KEY = 'carequeue_admin_role';
const ADMIN_LEADS_KEY = 'carequeue-admin-leads';
const ADMIN_AUDIT_KEY = 'carequeue-admin-audit-log';

function formatDate(dateStr: string) {
  if (!dateStr) return '—';
  try {
    const d = new Date(`${dateStr}T12:00:00`);
    return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function formatRelativeActivity(dateStr: string) {
  if (!dateStr) return 'Never';
  const today = '2026-10-01';
  if (dateStr === today) return 'Today';
  if (dateStr === '2026-09-30') return 'Yesterday';
  try {
    const d = new Date(`${dateStr}T12:00:00`);
    return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

function isWithinLast7Days(dateStr: string) {
  if (!dateStr) return false;
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    const target = Date.UTC(y, m - 1, d);
    const now = Date.UTC(2026, 9, 1); // 2026-10-01 UTC
    const diffDays = Math.floor((now - target) / 86400000);
    return diffDays >= 0 && diffDays <= 7;
  } catch {
    return false;
  }
}

function getTodayISO() {
  return '2026-10-01';
}

function formatCurrentAuditTime() {
  return '01 Oct 2026, 11:45 AM';
}

export default function SuperAdminPage() {
  const [adminMode, setAdminMode] = useState<boolean>(false);
  const [adminRole, setAdminRole] = useState<AdminRole>('Owner');
  const [passkeyInput, setPasskeyInput] = useState('');
  const [authError, setAuthError] = useState('');

  // Active navigation tab
  const [activeTab, setActiveTab] = useState<'clinics' | 'leads' | 'audit'>('clinics');
  const [selectedClinicId, setSelectedClinicId] = useState<string | null>(null);

  // Clinics Data
  const [clinics, setClinics] = useState<AdminClinic[]>(SEED_CLINICS);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOption, setSortOption] = useState<'newest' | 'oldest' | 'appointments' | 'name'>('newest');
  const [statusFilter, setStatusFilter] = useState<'all' | ClinicStatus>('all');
  const [copiedHandle, setCopiedHandle] = useState<string | null>(null);

  // Status Change Confirmation Modal
  const [pendingStatusChange, setPendingStatusChange] = useState<{
    clinicId: string;
    newStatus: ClinicStatus;
  } | null>(null);

  // Notes state for detail view
  const [notesDraft, setNotesDraft] = useState('');
  const [notesSaveStatus, setNotesSaveStatus] = useState<string | null>(null);

  // Custom Paid Date Modal
  const [paidDateModal, setPaidDateModal] = useState<{ clinicId: string; defaultDate: string } | null>(null);
  const [customPaidDate, setCustomPaidDate] = useState('2026-11-01');

  // Leads Data
  const [leads, setLeads] = useState<SalesLead[]>(SEED_LEADS);
  const [dueTodayOnly, setDueTodayOnly] = useState<boolean>(false);
  const [leadsSearch, setLeadsSearch] = useState('');
  const [leadViewMode, setLeadViewMode] = useState<'pipeline' | 'list'>('pipeline');
  const [newLeadModalOpen, setNewLeadModalOpen] = useState(false);
  const [newLeadName, setNewLeadName] = useState('');
  const [newLeadPhone, setNewLeadPhone] = useState('');
  const [newLeadCity, setNewLeadCity] = useState('');
  const [newLeadOwner, setNewLeadOwner] = useState('Rahul Mehta');
  const [newLeadDate, setNewLeadDate] = useState('2026-10-01');
  const [newLeadNotes, setNewLeadNotes] = useState('');

  // Audit Log Data
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>(SEED_AUDIT_LOG);
  const [auditSearch, setAuditSearch] = useState('');

  // Load state from localStorage on mount
  useEffect(() => {
    try {
      const mode = localStorage.getItem(ADMIN_MODE_KEY);
      if (mode === 'true') {
        setAdminMode(true);
      }

      const storedRole = localStorage.getItem(ADMIN_ROLE_KEY) as AdminRole;
      if (storedRole && ['Owner', 'Sales', 'Support'].includes(storedRole)) {
        setAdminRole(storedRole);
        if (storedRole === 'Sales') {
          setActiveTab('leads');
        }
      }

      // Load Clinics
      const storedClinics = localStorage.getItem(ADMIN_STORAGE_KEY);
      if (storedClinics) {
        const parsed = JSON.parse(storedClinics);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setClinics(parsed);
        } else {
          localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(SEED_CLINICS));
        }
      } else {
        localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(SEED_CLINICS));
      }

      // Load Leads
      const storedLeads = localStorage.getItem(ADMIN_LEADS_KEY);
      if (storedLeads) {
        const parsed = JSON.parse(storedLeads);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setLeads(parsed);
        } else {
          localStorage.setItem(ADMIN_LEADS_KEY, JSON.stringify(SEED_LEADS));
        }
      } else {
        localStorage.setItem(ADMIN_LEADS_KEY, JSON.stringify(SEED_LEADS));
      }

      // Load Audit Log
      const storedAudit = localStorage.getItem(ADMIN_AUDIT_KEY);
      if (storedAudit) {
        const parsed = JSON.parse(storedAudit);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setAuditLogs(parsed);
        } else {
          localStorage.setItem(ADMIN_AUDIT_KEY, JSON.stringify(SEED_AUDIT_LOG));
        }
      } else {
        localStorage.setItem(ADMIN_AUDIT_KEY, JSON.stringify(SEED_AUDIT_LOG));
      }
    } catch {
      // LocalStorage safe fallback
    }
  }, []);

  // Helper to record audit events
  function logAdminAction(action: string, clinic: string) {
    const actor =
      adminRole === 'Owner'
        ? 'Dr. Admin (Owner)'
        : adminRole === 'Sales'
        ? 'Pooja (Sales)'
        : 'Vikram (Support)';

    const newEntry: AuditLogEntry = {
      id: `log-${Date.now()}`,
      time: formatCurrentAuditTime(),
      adminName: actor,
      action,
      clinic,
    };

    setAuditLogs(prev => {
      const updated = [newEntry, ...prev];
      try {
        localStorage.setItem(ADMIN_AUDIT_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });
  }

  // Handle Role Switching
  function handleRoleChange(newRole: AdminRole) {
    setAdminRole(newRole);
    try {
      localStorage.setItem(ADMIN_ROLE_KEY, newRole);
    } catch {}

    // Enforce role constraints
    if (newRole === 'Sales') {
      setActiveTab('leads');
      setSelectedClinicId(null);
    }
  }

  // Unlock Admin Gate
  function handleUnlock(e?: FormEvent) {
    if (e) e.preventDefault();
    const clean = passkeyInput.trim().toLowerCase();
    if (!passkeyInput || clean === 'admin' || clean === 'admin2026' || clean === 'carequeue') {
      try {
        localStorage.setItem(ADMIN_MODE_KEY, 'true');
      } catch {}
      setAdminMode(true);
      setAuthError('');
    } else {
      setAuthError('Incorrect passkey. (Demo passkey: "admin")');
    }
  }

  // Lock Admin Gate
  function handleLock() {
    try {
      localStorage.removeItem(ADMIN_MODE_KEY);
    } catch {}
    setAdminMode(false);
    setPasskeyInput('');
    setAuthError('');
    setSelectedClinicId(null);
  }

  // Copy handle URL
  function handleCopyHandle(handle: string) {
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : 'https://carequeue.health';
      navigator.clipboard.writeText(`${origin}/${handle}`);
      setCopiedHandle(handle);
      window.setTimeout(() => setCopiedHandle(null), 2000);
    } catch {}
  }

  // Save clinics state and update status override key for public booking page
  function updateClinic(updated: AdminClinic, actionDescription?: string) {
    setClinics(prev => {
      const nextList = prev.map(c => (c.id === updated.id ? updated : c));
      try {
        localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(nextList));
        // Sync status directly so public /[handle] reads it instantly
        localStorage.setItem(`carequeue-clinic-status:${updated.handle}`, updated.status);
      } catch {}
      return nextList;
    });

    if (actionDescription) {
      logAdminAction(actionDescription, updated.name);
    }
  }

  // Get currently selected clinic
  const selectedClinic = useMemo(() => {
    return clinics.find(c => c.id === selectedClinicId) || null;
  }, [clinics, selectedClinicId]);

  // Sync draft notes when selected clinic changes
  useEffect(() => {
    if (selectedClinic) {
      setNotesDraft(selectedClinic.internalNotes || '');
      setNotesSaveStatus(null);
    }
  }, [selectedClinicId, selectedClinic]);

  // Aggregate stats calculations (plain numbers, no "#")
  const stats = useMemo(() => {
    const totalClinics = clinics.length;
    const newClinicsThisWeek = clinics.filter(c => isWithinLast7Days(c.signupDate)).length;
    const activeClinics = clinics.filter(c => c.appointmentsThisWeek > 0).length;
    const totalAppointments = clinics.reduce((acc, c) => acc + c.totalAppointments, 0);

    return {
      totalClinics,
      newClinicsThisWeek,
      activeClinics,
      totalAppointments,
    };
  }, [clinics]);

  // Filtered & sorted clinics
  const filteredClinics = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = clinics.filter(clinic => {
      if (statusFilter !== 'all' && clinic.status !== statusFilter) return false;
      if (!q) return true;
      return (
        clinic.name.toLowerCase().includes(q) ||
        clinic.doctorName.toLowerCase().includes(q) ||
        clinic.handle.toLowerCase().includes(q) ||
        clinic.specialty.toLowerCase().includes(q) ||
        clinic.city.toLowerCase().includes(q)
      );
    });

    list = [...list].sort((a, b) => {
      if (sortOption === 'newest') {
        return new Date(b.signupDate).getTime() - new Date(a.signupDate).getTime();
      }
      if (sortOption === 'oldest') {
        return new Date(a.signupDate).getTime() - new Date(b.signupDate).getTime();
      }
      if (sortOption === 'appointments') {
        return b.appointmentsThisWeek - a.appointmentsThisWeek;
      }
      if (sortOption === 'name') {
        return a.name.localeCompare(b.name);
      }
      return 0;
    });

    return list;
  }, [clinics, searchQuery, sortOption, statusFilter]);

  // Leads calculations & filters
  const leadsDueTodayCount = useMemo(() => {
    const today = getTodayISO();
    return leads.filter(lead => lead.nextFollowUpDate === today).length;
  }, [leads]);

  const filteredLeads = useMemo(() => {
    const q = leadsSearch.trim().toLowerCase();
    const today = getTodayISO();

    return leads.filter(lead => {
      if (dueTodayOnly && lead.nextFollowUpDate !== today) {
        return false;
      }
      if (!q) return true;
      return (
        lead.name.toLowerCase().includes(q) ||
        lead.city.toLowerCase().includes(q) ||
        lead.owner.toLowerCase().includes(q) ||
        lead.notes.toLowerCase().includes(q)
      );
    });
  }, [leads, dueTodayOnly, leadsSearch]);

  // Filtered audit logs
  const filteredAuditLogs = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    if (!q) return auditLogs;
    return auditLogs.filter(
      item =>
        item.action.toLowerCase().includes(q) ||
        item.clinic.toLowerCase().includes(q) ||
        item.adminName.toLowerCase().includes(q)
    );
  }, [auditLogs, auditSearch]);

  // Status Change with Confirmation Handlers
  function promptStatusChange(clinicId: string, newStatus: ClinicStatus) {
    const c = clinics.find(item => item.id === clinicId);
    if (!c || c.status === newStatus) return;
    setPendingStatusChange({ clinicId, newStatus });
  }

  function confirmStatusChange() {
    if (!pendingStatusChange) return;
    const { clinicId, newStatus } = pendingStatusChange;
    const c = clinics.find(item => item.id === clinicId);
    if (c) {
      const updated: AdminClinic = { ...c, status: newStatus };
      updateClinic(updated, `Changed status from ${c.status} to ${newStatus}`);
    }
    setPendingStatusChange(null);
  }

  function cancelStatusChange() {
    setPendingStatusChange(null);
  }

  // Toggle Verified Handler
  function toggleVerified(clinic: AdminClinic) {
    const nextVal = !clinic.verified;
    const updated: AdminClinic = { ...clinic, verified: nextVal };
    updateClinic(updated, `${nextVal ? 'Granted' : 'Removed'} verified clinic badge`);
  }

  // Save Internal Notes
  function handleSaveNotes(clinic: AdminClinic) {
    const updated: AdminClinic = { ...clinic, internalNotes: notesDraft.trim() };
    updateClinic(updated, `Updated internal notes`);
    setNotesSaveStatus('Saved ✓');
    window.setTimeout(() => setNotesSaveStatus(null), 2500);
  }

  // Extend Trial 7 Days
  function handleExtendTrial(clinic: AdminClinic) {
    try {
      const currentExpiry = clinic.trialExpiry ? new Date(`${clinic.trialExpiry}T12:00:00`) : new Date('2026-10-01T12:00:00');
      const baseTime = currentExpiry.getTime() > new Date('2026-10-01T12:00:00').getTime() ? currentExpiry : new Date('2026-10-01T12:00:00');
      baseTime.setDate(baseTime.getDate() + 7);
      const newExpiry = baseTime.toISOString().slice(0, 10);

      const updated: AdminClinic = {
        ...clinic,
        trialExpiry: newExpiry,
        status: clinic.status === 'Trial' ? 'Trial' : clinic.status,
      };
      updateClinic(updated, `Extended trial by 7 days (new expiry: ${formatDate(newExpiry)})`);
    } catch {}
  }

  // Mark as Paid Until [date]
  function handleMarkPaid(clinic: AdminClinic, paidUntilDate: string) {
    const updated: AdminClinic = {
      ...clinic,
      status: 'Active',
      plan: clinic.plan === 'Trial' ? 'Professional' : clinic.plan,
      paidUntil: paidUntilDate,
    };
    updateClinic(updated, `Marked as paid until ${formatDate(paidUntilDate)}`);
    setPaidDateModal(null);
  }

  // Toggle Onboarding Checklist Item
  function toggleOnboardingItem(clinic: AdminClinic, itemKey: keyof OnboardingChecklist) {
    const updatedChecklist = {
      ...clinic.onboarding,
      [itemKey]: !clinic.onboarding[itemKey],
    };
    const updated: AdminClinic = {
      ...clinic,
      onboarding: updatedChecklist,
    };
    const labels: Record<keyof OnboardingChecklist, string> = {
      profile: 'Clinic profile',
      hours: 'Operating hours',
      qrPlaced: 'QR standee placed',
      firstBooking: 'First patient booking',
      assistantTrained: 'Assistant trained',
    };
    const stateStr = updatedChecklist[itemKey] ? 'completed' : 'pending';
    updateClinic(updated, `Updated onboarding checklist: marked ${labels[itemKey]} as ${stateStr}`);
  }

  // Move Lead Stage
  function moveLeadStage(leadId: string, newStage: LeadStage) {
    setLeads(prev => {
      const target = prev.find(l => l.id === leadId);
      const next = prev.map(l => (l.id === leadId ? { ...l, stage: newStage } : l));
      try {
        localStorage.setItem(ADMIN_LEADS_KEY, JSON.stringify(next));
      } catch {}
      if (target) {
        logAdminAction(`Moved lead stage to "${newStage}"`, target.name);
      }
      return next;
    });
  }

  // Create New Lead
  function handleCreateLead(e: FormEvent) {
    e.preventDefault();
    if (!newLeadName.trim()) return;

    const newLead: SalesLead = {
      id: `lead-${Date.now()}`,
      name: newLeadName.trim(),
      phone: newLeadPhone.trim() || '+91 98000 00000',
      city: newLeadCity.trim() || 'Bengaluru',
      owner: newLeadOwner || 'Rahul Mehta',
      nextFollowUpDate: newLeadDate || '2026-10-01',
      stage: 'Lead',
      notes: newLeadNotes.trim() || 'New inbound sales inquiry.',
      createdAt: '2026-10-01',
    };

    setLeads(prev => {
      const updated = [newLead, ...prev];
      try {
        localStorage.setItem(ADMIN_LEADS_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });

    logAdminAction(`Added new sales lead: ${newLead.name}`, newLead.name);
    setNewLeadModalOpen(false);
    setNewLeadName('');
    setNewLeadPhone('');
    setNewLeadCity('');
    setNewLeadNotes('');
  }

  // If locked, render authentication gate consistent with CareQueue auth flow
  if (!adminMode) {
    return (
      <main className="admin-gate-shell">
        <div className="admin-gate-wrap">
          <div className="admin-gate-box">
            <div className="brand" style={{ justifyContent: 'center', marginBottom: '22px' }}>
              <span className="brand-symbol">
                <AdminIcon name="heart" size={19} />
                <span>+</span>
              </span>
              <span>carequeue</span>
            </div>

            <div className="form-heading" style={{ textAlign: 'center' }}>
              <span className="eyebrow" style={{ justifyContent: 'center' }}>
                <span className="eyebrow-dot" /> SUPER ADMIN OPERATIONS
              </span>
              <h1>Ops Console</h1>
              <p style={{ margin: '0 auto', maxWidth: '340px' }}>
                Restricted access for CareQueue practice management, sales pipeline, and clinic verification.
              </p>
            </div>

            <form onSubmit={handleUnlock} className="auth-form" style={{ marginTop: '24px' }}>
              <label>
                Admin passkey
                <input
                  type="password"
                  placeholder="Enter passkey (e.g. admin)"
                  value={passkeyInput}
                  onChange={e => setPasskeyInput(e.target.value)}
                  autoFocus
                />
              </label>

              {authError && <p style={{ color: '#dc2626', fontSize: '12px', margin: 0, fontWeight: 600 }}>{authError}</p>}

              <button type="submit" className="primary-button full-button" style={{ marginTop: '6px' }}>
                Unlock Console <AdminIcon name="arrow" size={18} />
              </button>

              <button
                type="button"
                className="secondary-button full-button"
                onClick={() => {
                  setPasskeyInput('admin');
                  try {
                    localStorage.setItem(ADMIN_MODE_KEY, 'true');
                  } catch {}
                  setAdminMode(true);
                }}
              >
                Instant Demo Access
              </button>
            </form>

            <p className="fine-print">
              Demo passkey: <code>admin</code> · Role-protected with client flag; production uses Supabase server auth.
            </p>
          </div>
        </div>
      </main>
    );
  }

  // Authenticated Admin Dashboard
  return (
    <div className="admin-shell">
      {/* Top Header - CareQueue Aligned */}
      <header className="admin-topbar">
        <div className="admin-brand-cluster">
          <Link href="/admin" className="brand" onClick={() => setSelectedClinicId(null)}>
            <span className="brand-symbol">
              <AdminIcon name="heart" size={19} />
              <span>+</span>
            </span>
            <span>carequeue</span>
          </Link>
          <span className="admin-badge-ops">OPERATIONS CONSOLE</span>
        </div>

        <div className="admin-topbar-actions">
          {/* Demo Role Switcher */}
          <div className="admin-role-picker">
            <span className="admin-role-label">Role:</span>
            <select
              className="admin-role-select"
              value={adminRole}
              onChange={e => handleRoleChange(e.target.value as AdminRole)}
            >
              <option value="Owner">Owner (Full access)</option>
              <option value="Sales">Sales (Leads only)</option>
              <option value="Support">Support (No billing)</option>
            </select>
            <span className={`admin-role-tag role-${adminRole.toLowerCase()}`}>
              {adminRole}
            </span>
          </div>

          <button onClick={handleLock} className="admin-lock-btn" title="Exit admin session">
            Lock & Exit
          </button>
        </div>
      </header>

      {/* Tabs Navigation Bar (CareQueue style) */}
      <nav className="admin-tabs-bar" role="tablist">
        {adminRole !== 'Sales' && (
          <button
            role="tab"
            aria-selected={activeTab === 'clinics' && !selectedClinicId}
            className={activeTab === 'clinics' && !selectedClinicId ? 'active' : ''}
            onClick={() => {
              setActiveTab('clinics');
              setSelectedClinicId(null);
            }}
          >
            <span>Clinics</span>
            <span className="tab-pill">{clinics.length}</span>
          </button>
        )}

        <button
          role="tab"
          aria-selected={activeTab === 'leads'}
          className={activeTab === 'leads' ? 'active' : ''}
          onClick={() => {
            setActiveTab('leads');
            setSelectedClinicId(null);
          }}
        >
          <span>Leads Pipeline</span>
          <span className="tab-pill">{leads.length}</span>
          {leadsDueTodayCount > 0 && (
            <span className="tab-due-badge" title={`${leadsDueTodayCount} leads due for follow-up today`}>
              {leadsDueTodayCount} due
            </span>
          )}
        </button>

        {adminRole !== 'Sales' && (
          <button
            role="tab"
            aria-selected={activeTab === 'audit'}
            className={activeTab === 'audit' ? 'active' : ''}
            onClick={() => {
              setActiveTab('audit');
              setSelectedClinicId(null);
            }}
          >
            <span>Audit Log</span>
            <span className="tab-pill">{auditLogs.length}</span>
          </button>
        )}

        {selectedClinicId && (
          <div className="active-clinic-crumb">
            <span>Managing:</span> <b>{selectedClinic?.name || 'Clinic'}</b>
          </div>
        )}
      </nav>

      {/* Sales Mode Notice Banner */}
      {adminRole === 'Sales' && (
        <div className="sales-mode-banner">
          <span>⚠️</span>
          <span>Sales Mode Active: Viewing CRM Leads pipeline only. Clinic settings and billing controls are restricted.</span>
        </div>
      )}

      {/* MAIN BODY AREA */}
      <main className="admin-body">
        {/* VIEW 1: CLINIC DETAIL PAGE */}
        {selectedClinicId && selectedClinic ? (
          <section className="admin-detail-view">
            {/* Header & Back Navigation */}
            <div className="admin-detail-header-row">
              <div>
                <button
                  type="button"
                  className="back-button"
                  onClick={() => {
                    setSelectedClinicId(null);
                    setActiveTab('clinics');
                  }}
                >
                  <AdminIcon name="back" size={16} /> Back to all clinics
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '6px', flexWrap: 'wrap' }}>
                  <h1>{selectedClinic.name}</h1>
                  <span className={`status-pill status-${selectedClinic.status.toLowerCase()}`}>
                    ● {selectedClinic.status}
                  </span>
                  {selectedClinic.verified ? (
                    <span className="verified-badge">Verified ✓</span>
                  ) : (
                    <span className="unverified-badge">Unverified</span>
                  )}
                </div>
                <p style={{ color: 'var(--muted)', fontSize: '13px', margin: '4px 0 0' }}>
                  {selectedClinic.doctorName} · {selectedClinic.specialty} · {selectedClinic.city} · Registered on {formatDate(selectedClinic.signupDate)}
                </p>
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                  type="button"
                  className="secondary-button"
                  style={{ height: '38px', fontSize: '12px' }}
                  onClick={() => handleCopyHandle(selectedClinic.handle)}
                >
                  <AdminIcon name="copy" size={15} />
                  <span>{copiedHandle === selectedClinic.handle ? 'Copied link! ✓' : `carequeue.com/${selectedClinic.handle}`}</span>
                </button>
                <a
                  href={`/${selectedClinic.handle}`}
                  target="_blank"
                  rel="noreferrer"
                  className="primary-button"
                  style={{ height: '38px', fontSize: '12px', textDecoration: 'none' }}
                >
                  Public page ↗
                </a>
              </div>
            </div>

            {/* Grid Layout */}
            <div className="admin-detail-two-col">
              {/* Left Column: Status, Verified, Notes, Onboarding */}
              <div>
                {/* Card 1: Status & Verification Controls */}
                <div className="detail-section-card">
                  <h3>
                    <span>Operating Status & Verification</span>
                    <span style={{ fontSize: '11.5px', color: 'var(--muted)', fontWeight: 500 }}>
                      Live changes sync to patient booking
                    </span>
                  </h3>

                  <div className="field-label" style={{ marginBottom: '8px' }}>
                    Status Selection (Prompts confirmation)
                  </div>
                  <div className="status-tiles-grid">
                    {(['Trial', 'Active', 'Suspended', 'Blocked'] as ClinicStatus[]).map(st => (
                      <button
                        key={st}
                        type="button"
                        className={`status-tile-btn ${selectedClinic.status === st ? `is-active-${st}` : ''}`}
                        onClick={() => promptStatusChange(selectedClinic.id, st)}
                      >
                        <span>● {st}</span>
                        <small style={{ fontSize: '10px', opacity: 0.85, fontWeight: 500 }}>
                          {st === 'Active'
                            ? 'Bookings open'
                            : st === 'Suspended'
                            ? 'Shows unavailable'
                            : st === 'Trial'
                            ? 'Trial period'
                            : 'Access blocked'}
                        </small>
                      </button>
                    ))}
                  </div>

                  {/* Verified Toggle */}
                  <div className="admin-toggle-panel">
                    <div>
                      <strong>Verified Practice Badge</strong>
                      <span>Displays verified medical trust seal on booking screens</span>
                    </div>
                    <button
                      type="button"
                      className={selectedClinic.verified ? 'primary-button' : 'secondary-button'}
                      style={{ height: '34px', fontSize: '12px', padding: '0 14px' }}
                      onClick={() => toggleVerified(selectedClinic)}
                    >
                      {selectedClinic.verified ? 'Verified ✓' : 'Mark Verified'}
                    </button>
                  </div>
                </div>

                {/* Card 2: Onboarding Checklist */}
                <div className="detail-section-card">
                  <h3>
                    <span>Onboarding Checklist</span>
                    {(() => {
                      const total = 5;
                      const doneCount = Object.values(selectedClinic.onboarding).filter(Boolean).length;
                      return (
                        <span style={{ fontSize: '12px', color: 'var(--blue)', fontWeight: 700 }}>
                          {doneCount} of {total} complete ({Math.round((doneCount / total) * 100)}%)
                        </span>
                      );
                    })()}
                  </h3>

                  <div className="onboarding-progress-bar">
                    <div
                      className="onboarding-progress-fill"
                      style={{
                        width: `${(Object.values(selectedClinic.onboarding).filter(Boolean).length / 5) * 100}%`,
                      }}
                    />
                  </div>

                  <div className="checklist-list">
                    {[
                      { key: 'profile' as const, label: 'Clinic profile & doctor details saved' },
                      { key: 'hours' as const, label: 'Weekly schedule & session windows configured' },
                      { key: 'qrPlaced' as const, label: 'Queue QR standee placed in waiting room' },
                      { key: 'firstBooking' as const, label: 'First patient token booked & verified' },
                      { key: 'assistantTrained' as const, label: 'Clinic assistant trained on Phone/Call dashboard' },
                    ].map(item => {
                      const isDone = selectedClinic.onboarding[item.key];
                      return (
                        <div
                          key={item.key}
                          className={`checklist-row ${isDone ? 'is-done' : ''}`}
                          onClick={() => toggleOnboardingItem(selectedClinic, item.key)}
                        >
                          <div className="checklist-checkbox">{isDone ? '✓' : ''}</div>
                          <span className="checklist-text">{item.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Card 3: Internal Notes Box */}
                <div className="detail-section-card">
                  <h3>
                    <span>Internal Admin Notes</span>
                    {notesSaveStatus && (
                      <span style={{ color: '#059669', fontSize: '12px', fontWeight: 700 }}>
                        {notesSaveStatus}
                      </span>
                    )}
                  </h3>
                  <textarea
                    className="admin-textarea"
                    value={notesDraft}
                    onChange={e => setNotesDraft(e.target.value)}
                    placeholder="Record operational remarks, custom pricing agreements, follow-up promises, doctor preferences... (Confidential: never visible to clinic or patients)"
                  />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '8px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                      Zero patient details · Internal admin log only
                    </span>
                    <button
                      type="button"
                      className="primary-button"
                      style={{ height: '34px', fontSize: '12px', padding: '0 16px' }}
                      onClick={() => handleSaveNotes(selectedClinic)}
                    >
                      Save Notes
                    </button>
                  </div>
                </div>
              </div>

              {/* Right Column: Plan & Billing (Hidden for Support), Stats */}
              <div>
                {/* Card 4: Plan & Subscription (SUPPORT CANNOT SEE PLAN OR PAYMENT FIELDS) */}
                {adminRole === 'Support' ? (
                  <div className="detail-section-card" style={{ background: '#f8fafc' }}>
                    <h3>Plan & Billing Controls</h3>
                    <p style={{ fontSize: '13px', color: 'var(--muted)', margin: '8px 0 0', lineHeight: '1.55' }}>
                      🔒 <strong>Support Role Restriction:</strong> Subscription plan, pricing, and payment controls are restricted to Super Admin Owner.
                    </p>
                  </div>
                ) : (
                  <div className="detail-section-card">
                    <h3>
                      <span>Plan & Subscription</span>
                      <span className="status-pill status-trial">
                        {selectedClinic.plan}
                      </span>
                    </h3>

                    <div className="plan-fields-grid">
                      <div className="field-group">
                        <label className="field-label">Tier Plan</label>
                        <select
                          className="field-input"
                          value={selectedClinic.plan}
                          onChange={e => {
                            const newPlan = e.target.value as ClinicPlan;
                            updateClinic({ ...selectedClinic, plan: newPlan }, `Changed subscription plan to ${newPlan}`);
                          }}
                        >
                          <option value="Trial">Trial</option>
                          <option value="Starter">Starter</option>
                          <option value="Professional">Professional</option>
                          <option value="Clinic Pro">Clinic Pro</option>
                        </select>
                      </div>

                      <div className="field-group">
                        <label className="field-label">Trial Expiry</label>
                        <input
                          type="date"
                          className="field-input"
                          value={selectedClinic.trialExpiry || '2026-10-15'}
                          onChange={e => {
                            const val = e.target.value;
                            updateClinic({ ...selectedClinic, trialExpiry: val }, `Updated trial expiry to ${val}`);
                          }}
                        />
                      </div>
                    </div>

                    {selectedClinic.paidUntil && (
                      <div style={{ background: '#ecfdf5', padding: '10px 12px', borderRadius: '8px', fontSize: '12.5px', color: '#065f46', marginBottom: '14px', border: '1px solid #a7f3d0' }}>
                        ✓ Paid subscription active until <strong>{formatDate(selectedClinic.paidUntil)}</strong>
                      </div>
                    )}

                    {/* Billing Action Buttons */}
                    <div className="billing-actions-row">
                      <button
                        type="button"
                        className="secondary-button"
                        style={{ height: '36px', fontSize: '12px' }}
                        onClick={() => handleExtendTrial(selectedClinic)}
                      >
                        + Extend trial 7 days
                      </button>

                      <button
                        type="button"
                        className="primary-button"
                        style={{ height: '36px', fontSize: '12px' }}
                        onClick={() => {
                          setPaidDateModal({
                            clinicId: selectedClinic.id,
                            defaultDate: '2026-11-01',
                          });
                          setCustomPaidDate('2026-11-01');
                        }}
                      >
                        Mark as paid until [date]
                      </button>
                    </div>
                  </div>
                )}

                {/* Card 5: Clinic OPD Volume & Counts (Plain numbers, No "#", Zero patient info) */}
                <div className="detail-section-card">
                  <h3>Queue Activity & Bookings</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                    <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '8px', border: '1px solid #e8edf1' }}>
                      <span className="eyebrow" style={{ fontSize: '9.5px' }}>TOTAL BOOKINGS</span>
                      <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--ink)', fontFamily: 'Manrope, sans-serif', marginTop: '4px' }}>
                        {selectedClinic.totalAppointments}
                      </div>
                    </div>

                    <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '8px', border: '1px solid #e8edf1' }}>
                      <span className="eyebrow" style={{ fontSize: '9.5px' }}>THIS WEEK</span>
                      <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--blue)', fontFamily: 'Manrope, sans-serif', marginTop: '4px' }}>
                        {selectedClinic.appointmentsThisWeek}
                      </div>
                    </div>
                  </div>

                  <div style={{ fontSize: '12.5px', color: 'var(--muted)', lineHeight: '1.65' }}>
                    <div>Last queue activity: <strong style={{ color: 'var(--ink)' }}>{formatRelativeActivity(selectedClinic.lastActiveDate)}</strong> ({selectedClinic.lastActiveDate})</div>
                    <div>Account created: <strong style={{ color: 'var(--ink)' }}>{formatDate(selectedClinic.signupDate)}</strong></div>
                  </div>

                  <div style={{ marginTop: '16px', padding: '12px', borderRadius: '8px', background: '#f0f5fd', fontSize: '11.5px', color: '#456273', lineHeight: '1.5' }}>
                    🛡️ <strong>Privacy Protection:</strong> Patient names, contact numbers, and medical visit histories are quarantined strictly on clinic devices and are never transmitted to or rendered on admin screens.
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : activeTab === 'clinics' && adminRole !== 'Sales' ? (
          /* VIEW 2: CLINICS TABLE & STATS */
          <>
            {/* Stat Cards Row */}
            <section className="admin-stats-grid">
              <div className="admin-stat-card">
                <span className="eyebrow"><span className="eyebrow-dot" /> TOTAL CLINICS</span>
                <div className="admin-stat-val">{stats.totalClinics}</div>
                <p className="admin-stat-desc">Registered medical practices</p>
              </div>

              <div className="admin-stat-card">
                <span className="eyebrow"><span className="eyebrow-dot" /> NEW THIS WEEK</span>
                <div className="admin-stat-val">{stats.newClinicsThisWeek}</div>
                <p className="admin-stat-desc">Joined in the last 7 days</p>
              </div>

              <div className="admin-stat-card">
                <span className="eyebrow"><span className="eyebrow-dot" /> ACTIVE CLINICS</span>
                <div className="admin-stat-val">{stats.activeClinics}</div>
                <p className="admin-stat-desc">OPD activity in past 7 days</p>
              </div>

              <div className="admin-stat-card">
                <span className="eyebrow"><span className="eyebrow-dot" /> TOTAL APPOINTMENTS</span>
                <div className="admin-stat-val">
                  {stats.totalAppointments.toLocaleString('en-IN')}
                </div>
                <p className="admin-stat-desc">Aggregated patient tokens served</p>
              </div>
            </section>

            {/* Clinics Table Section */}
            <section className="admin-card">
              <div className="admin-toolbar">
                <div className="admin-search-box">
                  <span className="search-icon"><AdminIcon name="search" size={15} /></span>
                  <input
                    type="text"
                    placeholder="Search clinics, doctors, handle, specialty, city…"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')} className="clear-btn">
                      ✕
                    </button>
                  )}
                </div>

                {/* Status Filter */}
                <div className="admin-filter-group">
                  <span className="admin-filter-label">Status:</span>
                  <select
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value as any)}
                    className="admin-select"
                  >
                    <option value="all">All statuses</option>
                    <option value="Active">Active only</option>
                    <option value="Trial">Trial only</option>
                    <option value="Suspended">Suspended only</option>
                    <option value="Blocked">Blocked only</option>
                  </select>
                </div>

                {/* Sort Selection */}
                <div className="admin-filter-group">
                  <span className="admin-filter-label">Sort by:</span>
                  <select
                    value={sortOption}
                    onChange={e => setSortOption(e.target.value as any)}
                    className="admin-select"
                  >
                    <option value="newest">Signup date (newest first)</option>
                    <option value="oldest">Signup date (oldest first)</option>
                    <option value="appointments">Appointments this week</option>
                    <option value="name">Clinic name (A–Z)</option>
                  </select>
                </div>
              </div>

              {/* Desktop Table View */}
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>CLINIC & DOCTOR</th>
                      <th>HANDLE & LINK</th>
                      <th>STATUS & BADGE</th>
                      <th>SIGNUP DATE</th>
                      <th>THIS WEEK</th>
                      <th>LAST ACTIVE</th>
                      <th>TOTAL</th>
                      <th>ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredClinics.length === 0 ? (
                      <tr>
                        <td colSpan={8} style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--muted)' }}>
                          No clinics match your search query.
                        </td>
                      </tr>
                    ) : (
                      filteredClinics.map(clinic => (
                        <tr key={clinic.id}>
                          <td>
                            <div className="clinic-title-row">{clinic.name}</div>
                            <div className="clinic-sub-row">
                              {clinic.doctorName} · {clinic.specialty} · <span style={{ color: 'var(--ink)' }}>{clinic.city}</span>
                            </div>
                          </td>

                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <a href={`/${clinic.handle}`} target="_blank" rel="noreferrer" className="handle-pill">
                                /{clinic.handle} <span>↗</span>
                              </a>
                              <button
                                type="button"
                                onClick={() => handleCopyHandle(clinic.handle)}
                                className="icon-btn-subtle"
                                title="Copy public booking link"
                              >
                                {copiedHandle === clinic.handle ? '✓' : <AdminIcon name="copy" size={13} />}
                              </button>
                            </div>
                          </td>

                          <td>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                              <span className={`status-pill status-${clinic.status.toLowerCase()}`}>
                                ● {clinic.status}
                              </span>
                              {clinic.verified && (
                                <span className="verified-badge">Verified ✓</span>
                              )}
                            </div>
                          </td>

                          <td style={{ color: '#456273', whiteSpace: 'nowrap' }}>{formatDate(clinic.signupDate)}</td>

                          <td>
                            <span
                              className={`badge-count ${
                                clinic.appointmentsThisWeek > 0 ? 'active-pulse' : 'idle'
                              }`}
                            >
                              {clinic.appointmentsThisWeek}
                            </span>
                          </td>

                          <td style={{ whiteSpace: 'nowrap' }}>
                            <div style={{ fontWeight: 600 }}>{formatRelativeActivity(clinic.lastActiveDate)}</div>
                            <div style={{ fontSize: '11px', color: 'var(--muted)' }}>{clinic.lastActiveDate}</div>
                          </td>

                          <td>
                            <span style={{ font: '700 13px Manrope, sans-serif', color: 'var(--ink)' }}>
                              {clinic.totalAppointments.toLocaleString('en-IN')}
                            </span>
                          </td>

                          <td>
                            <button
                              type="button"
                              className="secondary-button"
                              style={{ height: '32px', padding: '0 12px', fontSize: '12px' }}
                              onClick={() => setSelectedClinicId(clinic.id)}
                            >
                              Manage →
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards View (< 768px) */}
              <div className="admin-mobile-list">
                {filteredClinics.map(clinic => (
                  <div key={clinic.id} className="admin-mobile-clinic-card">
                    <div className="mobile-card-top">
                      <div>
                        <div style={{ font: '700 15px Manrope, sans-serif', color: 'var(--ink)' }}>{clinic.name}</div>
                        <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                          {clinic.doctorName} · {clinic.specialty}
                        </div>
                      </div>
                      <span className={`status-pill status-${clinic.status.toLowerCase()}`}>
                        ● {clinic.status}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '8px 0' }}>
                      <span className="handle-pill">/{clinic.handle}</span>
                      <button
                        type="button"
                        onClick={() => handleCopyHandle(clinic.handle)}
                        className="icon-btn-subtle"
                        style={{ fontSize: '11.5px' }}
                      >
                        {copiedHandle === clinic.handle ? '✓ Copied' : 'Copy'}
                      </button>
                      <a
                        href={`/${clinic.handle}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ fontSize: '12px', color: 'var(--blue)', textDecoration: 'none', marginLeft: 'auto' }}
                      >
                        Open ↗
                      </a>
                    </div>

                    <div className="mobile-card-stats">
                      <div className="mobile-stat-box">
                        <span>SIGNED UP</span>
                        <b>{formatDate(clinic.signupDate)}</b>
                      </div>

                      <div className="mobile-stat-box">
                        <span>THIS WEEK</span>
                        <b style={{ color: 'var(--blue)' }}>{clinic.appointmentsThisWeek}</b>
                      </div>

                      <div className="mobile-stat-box">
                        <span>TOTAL TOKENS</span>
                        <b>{clinic.totalAppointments}</b>
                      </div>
                    </div>

                    <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #edf0f2', display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        className="primary-button"
                        style={{ height: '34px', fontSize: '12px', padding: '0 14px' }}
                        onClick={() => setSelectedClinicId(clinic.id)}
                      >
                        Manage Clinic <span>→</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </>
        ) : activeTab === 'leads' ? (
          /* VIEW 3: LEADS CRM TAB */
          <section className="admin-card">
            {/* Leads Toolbar */}
            <div className="admin-toolbar">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <div className="admin-search-box" style={{ minWidth: '240px' }}>
                  <span className="search-icon"><AdminIcon name="search" size={15} /></span>
                  <input
                    type="text"
                    placeholder="Search leads by doctor, city, owner…"
                    value={leadsSearch}
                    onChange={e => setLeadsSearch(e.target.value)}
                  />
                </div>

                {/* Due Today Filter */}
                <button
                  type="button"
                  className={dueTodayOnly ? 'primary-button' : 'secondary-button'}
                  style={{
                    height: '38px',
                    borderRadius: '999px',
                    fontSize: '12px',
                    gap: '6px',
                    padding: '0 14px',
                    background: dueTodayOnly ? '#ef4444' : '#ffffff',
                    borderColor: dueTodayOnly ? '#ef4444' : '#e0e8ee',
                  }}
                  onClick={() => setDueTodayOnly(!dueTodayOnly)}
                >
                  <span>📅 Due today</span>
                  <span
                    className="tab-pill"
                    style={{
                      background: dueTodayOnly ? '#ffffff' : '#edf2f6',
                      color: dueTodayOnly ? '#ef4444' : '#55707d',
                      height: '18px',
                      minWidth: '18px',
                    }}
                  >
                    {leadsDueTodayCount}
                  </span>
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <button
                  type="button"
                  className="secondary-button"
                  style={{ height: '38px', fontSize: '12px' }}
                  onClick={() => setLeadViewMode(leadViewMode === 'pipeline' ? 'list' : 'pipeline')}
                >
                  {leadViewMode === 'pipeline' ? 'List View' : 'Kanban Board'}
                </button>

                <button
                  type="button"
                  className="primary-button"
                  style={{ height: '38px', fontSize: '12px', padding: '0 14px' }}
                  onClick={() => setNewLeadModalOpen(true)}
                >
                  + Add Lead
                </button>
              </div>
            </div>

            {/* Pipeline Kanban Board View */}
            {leadViewMode === 'pipeline' ? (
              <div className="leads-kanban-board">
                {(['Lead', 'Demo given', 'Signed up', 'Activated', 'Paying'] as LeadStage[]).map(stage => {
                  const stageLeads = filteredLeads.filter(l => l.stage === stage);
                  return (
                    <div key={stage} className="leads-column">
                      <div className="leads-col-header">
                        <span>{stage}</span>
                        <span className="leads-col-pill">{stageLeads.length}</span>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {stageLeads.length === 0 ? (
                          <div style={{ padding: '20px 8px', textAlign: 'center', color: 'var(--muted)', fontSize: '12px' }}>
                            No leads in this stage
                          </div>
                        ) : (
                          stageLeads.map(lead => {
                            const isDue = lead.nextFollowUpDate === getTodayISO();
                            return (
                              <div key={lead.id} className="lead-card-box">
                                <div className="lead-card-title">{lead.name}</div>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                  <a href={`tel:${lead.phone.replace(/\s+/g, '')}`} className="lead-card-phone-link">
                                    📞 {lead.phone}
                                  </a>
                                  <span style={{ fontSize: '11px', color: 'var(--muted)' }}>{lead.city}</span>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11.5px', color: 'var(--muted)' }}>
                                  <span>Owner: <strong style={{ color: 'var(--ink)' }}>{lead.owner}</strong></span>
                                  <span className={`tab-due-badge ${isDue ? '' : 'idle'}`} style={{ background: isDue ? '#fef2f2' : '#f1f5f9', color: isDue ? '#dc2626' : '#55707d', border: isDue ? '1px solid #fecaca' : 'none' }}>
                                    {isDue ? 'Due Today!' : lead.nextFollowUpDate}
                                  </span>
                                </div>

                                <div className="lead-notes-quote">{lead.notes}</div>

                                {/* Stage Mover Selector */}
                                <div>
                                  <select
                                    className="lead-stage-select"
                                    value={lead.stage}
                                    onChange={e => moveLeadStage(lead.id, e.target.value as LeadStage)}
                                  >
                                    <option value="Lead">Move: Lead</option>
                                    <option value="Demo given">Move: Demo given</option>
                                    <option value="Signed up">Move: Signed up</option>
                                    <option value="Activated">Move: Activated</option>
                                    <option value="Paying">Move: Paying</option>
                                  </select>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Leads Table / List View */
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>DOCTOR / CLINIC LEAD</th>
                      <th>PHONE & CITY</th>
                      <th>STAGE</th>
                      <th>OWNER</th>
                      <th>NEXT FOLLOW-UP</th>
                      <th>NOTES</th>
                      <th>STAGE ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLeads.map(lead => (
                      <tr key={lead.id}>
                        <td style={{ fontWeight: 700, color: 'var(--ink)' }}>{lead.name}</td>
                        <td>
                          <a href={`tel:${lead.phone}`} style={{ color: 'var(--blue)', fontWeight: 600, textDecoration: 'none' }}>
                            {lead.phone}
                          </a>
                          <div style={{ fontSize: '11.5px', color: 'var(--muted)' }}>{lead.city}</div>
                        </td>
                        <td>
                          <span className="status-pill status-trial">
                            {lead.stage}
                          </span>
                        </td>
                        <td>{lead.owner}</td>
                        <td>
                          <span className={`tab-due-badge`} style={{ background: lead.nextFollowUpDate === getTodayISO() ? '#fef2f2' : '#f1f5f9', color: lead.nextFollowUpDate === getTodayISO() ? '#dc2626' : '#55707d' }}>
                            {lead.nextFollowUpDate === getTodayISO() ? 'Due Today' : lead.nextFollowUpDate}
                          </span>
                        </td>
                        <td style={{ maxWidth: '240px', fontSize: '12px', color: '#55707d' }}>{lead.notes}</td>
                        <td>
                          <select
                            className="lead-stage-select"
                            value={lead.stage}
                            onChange={e => moveLeadStage(lead.id, e.target.value as LeadStage)}
                          >
                            <option value="Lead">Lead</option>
                            <option value="Demo given">Demo given</option>
                            <option value="Signed up">Signed up</option>
                            <option value="Activated">Activated</option>
                            <option value="Paying">Paying</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : (
          /* VIEW 4: AUDIT LOG TAB */
          <section className="admin-card">
            <div className="admin-card-header">
              <div>
                <h2>Super Admin Audit Log</h2>
                <p>
                  Immutable administrative record of status updates, verification badges, and billing extensions.
                </p>
              </div>

              <div className="admin-search-box" style={{ minWidth: '240px' }}>
                <span className="search-icon"><AdminIcon name="search" size={15} /></span>
                <input
                  type="text"
                  placeholder="Filter logs by action, clinic, or admin…"
                  value={auditSearch}
                  onChange={e => setAuditSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>TIMESTAMP</th>
                    <th>ADMIN ACTOR</th>
                    <th>ACTION PERFORMED</th>
                    <th>CLINIC / LEAD TARGET</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAuditLogs.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', padding: '30px', color: 'var(--muted)' }}>
                        No audit records match your search.
                      </td>
                    </tr>
                  ) : (
                    filteredAuditLogs.map(item => (
                      <tr key={item.id}>
                        <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '12px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                          {item.time}
                        </td>
                        <td>
                          <span style={{ fontWeight: 600, color: 'var(--ink)' }}>👤 {item.adminName}</span>
                        </td>
                        <td style={{ fontWeight: 500 }}>{item.action}</td>
                        <td style={{ color: 'var(--blue)', fontWeight: 650 }}>{item.clinic}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>

      {/* MODAL 1: STATUS CHANGE CONFIRMATION */}
      {pendingStatusChange && (
        <div className="admin-modal-scrim">
          <div className="admin-modal-card">
            <div className={`admin-modal-icon-badge ${pendingStatusChange.newStatus === 'Suspended' || pendingStatusChange.newStatus === 'Blocked' ? 'warning' : 'primary'}`}>
              {pendingStatusChange.newStatus === 'Suspended' ? '⏸' : pendingStatusChange.newStatus === 'Blocked' ? '🚫' : '✓'}
            </div>
            <h3 className="admin-modal-title">Confirm Status Change</h3>
            <p className="admin-modal-desc">
              Change status of{' '}
              <strong>{clinics.find(c => c.id === pendingStatusChange.clinicId)?.name}</strong> to{' '}
              <span className={`status-pill status-${pendingStatusChange.newStatus.toLowerCase()}`}>
                ● {pendingStatusChange.newStatus}
              </span>
              ?
              {pendingStatusChange.newStatus === 'Suspended' && (
                <span style={{ display: 'block', marginTop: '10px', color: '#b45309', fontWeight: 600 }}>
                  ⚠️ Note: Its public booking page will immediately show "This clinic is temporarily unavailable", and new patient queue bookings will be paused.
                </span>
              )}
            </p>

            <div className="admin-modal-actions">
              <button type="button" className="secondary-button" onClick={cancelStatusChange}>
                Cancel
              </button>
              <button
                type="button"
                className={pendingStatusChange.newStatus === 'Suspended' || pendingStatusChange.newStatus === 'Blocked' ? 'button-danger' : 'primary-button'}
                onClick={confirmStatusChange}
              >
                Confirm Change
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: CUSTOM PAID DATE PICKER */}
      {paidDateModal && (
        <div className="admin-modal-scrim">
          <div className="admin-modal-card">
            <div className="admin-modal-icon-badge primary">💳</div>
            <h3 className="admin-modal-title">Mark Clinic as Paid</h3>
            <p className="admin-modal-desc">
              Select the subscription validity date. This activates the clinic's Professional plan.
            </p>

            <div style={{ marginBottom: '20px', textAlign: 'left' }}>
              <label className="field-label">Paid Until Date</label>
              <input
                type="date"
                className="field-input"
                style={{ width: '100%', marginTop: '6px' }}
                value={customPaidDate}
                onChange={e => setCustomPaidDate(e.target.value)}
              />
              <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                <button
                  type="button"
                  className="secondary-button"
                  style={{ height: '30px', fontSize: '11px', padding: '0 8px' }}
                  onClick={() => setCustomPaidDate('2026-11-01')}
                >
                  1 Month
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  style={{ height: '30px', fontSize: '11px', padding: '0 8px' }}
                  onClick={() => setCustomPaidDate('2027-01-01')}
                >
                  3 Months
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  style={{ height: '30px', fontSize: '11px', padding: '0 8px' }}
                  onClick={() => setCustomPaidDate('2027-10-01')}
                >
                  1 Year
                </button>
              </div>
            </div>

            <div className="admin-modal-actions">
              <button type="button" className="secondary-button" onClick={() => setPaidDateModal(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  const c = clinics.find(item => item.id === paidDateModal.clinicId);
                  if (c) handleMarkPaid(c, customPaidDate);
                }}
              >
                Mark as Paid
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: CREATE NEW SALES LEAD */}
      {newLeadModalOpen && (
        <div className="admin-modal-scrim">
          <div className="admin-modal-card" style={{ maxWidth: '480px', textAlign: 'left' }}>
            <h3 className="admin-modal-title" style={{ textAlign: 'center', marginBottom: '16px' }}>
              Add Sales Lead
            </h3>

            <form onSubmit={handleCreateLead} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label className="field-label">Doctor & Clinic Name *</label>
                <input
                  required
                  type="text"
                  placeholder="e.g. Dr. Ritu Verma (Sunrise Clinic)"
                  className="field-input"
                  style={{ width: '100%', marginTop: '4px' }}
                  value={newLeadName}
                  onChange={e => setNewLeadName(e.target.value)}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label className="field-label">Clinic Phone *</label>
                  <input
                    required
                    type="text"
                    placeholder="+91 98234 56789"
                    className="field-input"
                    style={{ width: '100%', marginTop: '4px' }}
                    value={newLeadPhone}
                    onChange={e => setNewLeadPhone(e.target.value)}
                  />
                </div>

                <div>
                  <label className="field-label">City *</label>
                  <input
                    required
                    type="text"
                    placeholder="e.g. Pune"
                    className="field-input"
                    style={{ width: '100%', marginTop: '4px' }}
                    value={newLeadCity}
                    onChange={e => setNewLeadCity(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label className="field-label">Sales Owner</label>
                  <select
                    className="field-input"
                    style={{ width: '100%', marginTop: '4px' }}
                    value={newLeadOwner}
                    onChange={e => setNewLeadOwner(e.target.value)}
                  >
                    <option value="Rahul Mehta">Rahul Mehta</option>
                    <option value="Pooja Sharma">Pooja Sharma</option>
                    <option value="Dr. Admin">Dr. Admin</option>
                  </select>
                </div>

                <div>
                  <label className="field-label">Next Follow-Up</label>
                  <input
                    type="date"
                    className="field-input"
                    style={{ width: '100%', marginTop: '4px' }}
                    value={newLeadDate}
                    onChange={e => setNewLeadDate(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="field-label">Initial Notes / Requirements</label>
                <textarea
                  className="admin-textarea"
                  style={{ minHeight: '80px', marginTop: '4px' }}
                  placeholder="Doctor's queue challenges, receptionist readiness, demo scheduling..."
                  value={newLeadNotes}
                  onChange={e => setNewLeadNotes(e.target.value)}
                />
              </div>

              <div className="admin-modal-actions" style={{ marginTop: '12px' }}>
                <button type="button" className="secondary-button" onClick={() => setNewLeadModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary-button">
                  Save Lead
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="admin-footer">
        <span>© 2026 CareQueue Operations</span>
        <span>·</span>
        <span>Zero patient details stored</span>
        <span>·</span>
        <span>A calmer way to see your doctor</span>
      </footer>
    </div>
  );
}
