// Kiểu dữ liệu API trả về. Bảng gốc lấy từ lược đồ DB (chỉ import type).

import type {
  AccessoryCatalogItem,
  CashEntry,
  Charge,
  Collateral,
  ContractTemplate,
  Customer,
  DocumentRow,
  Handover,
  HandoverAccessory,
  Payment,
  RecurringCost,
  Rental,
  RentalSegment,
  TrafficFine,
  Vehicle,
  VehicleAccessory,
  VehicleBlock,
} from '@api/db/schema';
import type { CashCategory, Period } from '@shared/cashflow';
import type { MoneySummary, PaymentDirection } from '@shared/money';
import type { Quote } from '@shared/pricing';
import type { AccessoryCategory, PaymentMethod, RentalStatus, Role } from '@shared/constants';

export type { AccessoryCatalogItem, CashEntry, RecurringCost, HandoverAccessory, VehicleAccessory, Charge, Collateral, ContractTemplate, Customer, DocumentRow, Handover, Payment, Rental, RentalSegment, TrafficFine, Vehicle, VehicleBlock, MoneySummary, Quote };

export interface SessionUser {
  id: number;
  username: string;
  displayName: string;
  role: Role;
}

export interface UserRow extends SessionUser {
  active: boolean;
  createdAt: number;
  lastLoginAt: number | null;
}

export interface Warning {
  code: string;
  message: string;
  severity: 'info' | 'warn' | 'danger';
}

export interface Conflict {
  type: 'rental' | 'block';
  id: number;
  label: string;
  start: number;
  end: number | null;
}

export interface CustomerLite {
  id: number;
  fullName: string;
  phone: string | null;
}

export interface VehicleStatus {
  state: 'rented' | 'blocked' | 'available' | 'inactive';
  current?: { id: number; code: string; customer: CustomerLite; until: number; scheduledEnd: number };
  next?: { id: number; code: string; customer: CustomerLite; start: number; end: number };
  block?: VehicleBlock;
}

export type VehicleWithStatus = Vehicle & { status?: VehicleStatus; accessoryCount?: number; highlights?: string[] };

export type VehicleAccessoryView = VehicleAccessory & { effectiveValue: number };
export type CatalogItem = AccessoryCatalogItem & { usage: number };

export interface AccessorySuggestion {
  catalogId: number;
  name: string;
  category: AccessoryCategory;
  defaultValue: number;
  score: number;
  reasons: string[];
}

export interface VehicleAccessoriesData {
  items: VehicleAccessoryView[];
  suggestions: AccessorySuggestion[];
  catalog: CatalogItem[];
  copySources: { id: number; plate: string; make: string; model: string; n: number }[];
}

export interface RentalListItem extends Rental {
  customer: CustomerLite;
  vehicle: { id: number; plate: string; make: string; model: string };
  money: MoneySummary;
}

export interface RentalDetail {
  rental: Rental;
  customer: Customer;
  vehicle: Vehicle;
  drivers: Customer[];
  segments: RentalSegment[];
  handovers: Handover[];
  charges: Charge[];
  payments: Payment[];
  collaterals: Collateral[];
  documents: DocumentRow[];
  fines: TrafficFine[];
  users: { id: number; displayName: string }[];
  warnings: Warning[];
  money: MoneySummary;
}

export interface CustomerDetail {
  customer: Customer;
  rentals: (Rental & { vehicle: { id: number; plate: string; make: string; model: string }; role: 'renter' })[];
  asDriver: (Rental & { vehicle: { id: number; plate: string; make: string; model: string }; role: 'driver' })[];
  fines: TrafficFine[];
  totalSpent: number;
  warnings: Warning[];
}

export interface VehicleDetail {
  vehicle: Vehicle;
  accessories: VehicleAccessoryView[];
  status?: VehicleStatus;
  rentals: (Rental & { customer: CustomerLite })[];
  blocks: VehicleBlock[];
  fines: TrafficFine[];
  revenue: number | null;
  lastHandover: Handover | null;
}

export interface Precheck {
  quote: Quote;
  conflicts: Conflict[];
  warnings: Warning[];
  depositSuggested: number;
}

export interface Alert {
  kind: string;
  severity: 'info' | 'warn' | 'danger';
  title: string;
  detail: string;
  link: string;
  at?: number;
}

export interface Dashboard {
  alerts: Alert[];
  vehicles: { id: number; plate: string; make: string; model: string; photoFileId: string | null; odo: number; status?: VehicleStatus }[];
  counts: Record<string, number>;
  upcoming: { id: number; code: string; status: string; customer: { id: number; fullName: string }; vehicle: { id: number; plate: string }; at: number; kind: 'pickup' | 'return' }[];
  finance: null | {
    monthStart: number;
    revenue: number;
    received: number;
    depositsHeld: number;
    /** Thu chi thực tế trong tháng (như trang Thu chi). */
    income: number;
    expense: number;
    profit: number;
    rentals: number;
    utilization: { vehicleId: number; plate: string; pct: number }[];
  };
}

export interface CalendarData {
  vehicles: { id: number; plate: string; make: string; model: string; active: boolean; photoFileId: string | null }[];
  items: {
    type: 'rental' | 'block';
    id: number;
    vehicleId: number;
    status: string;
    code: string;
    label: string;
    start: number;
    end: number;
    scheduledEnd: number | null;
    overdue: boolean;
  }[];
}

export interface FineMatch {
  segment: RentalSegment;
  rental: Rental;
  customer: Customer;
  drivers: Customer[];
  nearBoundary: boolean;
}

export interface FineLookup {
  plateKey: string;
  at: number;
  vehicle: Vehicle | null;
  verdict: 'rented' | 'blocked' | 'idle' | 'unknown_vehicle';
  matches: FineMatch[];
  blocks: VehicleBlock[];
  scheduledOnly: { rental: Rental; customer: Customer }[];
  nearby: { rental: Rental; customer: Customer; segment: RentalSegment }[];
}

export interface FineListItem extends TrafficFine {
  customer: CustomerLite | null;
  rental: { id: number; code: string } | null;
}

export interface BusinessSettings {
  name: string;
  representative: string;
  position: string;
  idNumber: string;
  idIssueDate: string;
  idIssuePlace: string;
  phone: string;
  email: string;
  address: string;
  taxCode: string;
  bankBin: string;
  bankName: string;
  bankAccount: string;
  bankAccountName: string;
  signCity: string;
  shareNote: string;
}

export interface RulesSettings {
  weekendDays: number[];
  hourlyMaxHours: number;
  graceMinutes: number;
  holidays: { name: string; from: string; to: string; surchargePct: number }[];
  bufferMinutes: number;
  defaultPickupTime: string;
  fineHoldAmount: number;
  fineHoldDays: number;
  minDriverAge: number;
  checklist: string[];
  deliveryFeeDefault: number;
  cancelNoticeHours: number;
  cancelForfeitPct: number;
}

export interface SettingsData {
  business: BusinessSettings;
  rules: RulesSettings;
  banks: { bin: string; code: string; name: string }[];
}

export interface MatchedViolation {
  plate: string;
  violatedAt: number | null;
  timeText: string;
  location: string | null;
  violation: string | null;
  status: 'unpaid' | 'paid' | 'unknown';
  statusText: string | null;
  unit: string | null;
  resolvePlaces: string[];
  verdict: 'rented' | 'blocked' | 'idle' | 'unknown_vehicle' | 'no_time';
  renter: { customerId: number; fullName: string; phone: string | null } | null;
  rental: { id: number; code: string } | null;
  nearBoundary: boolean;
  recordedFineId: number | null;
}

export interface ViolationCheckResult {
  ok: boolean;
  error?: string;
  plate: string;
  checkedAt?: number;
  violations: MatchedViolation[];
}

export interface FineAutoCheck {
  frequency: 'off' | 'daily' | 'weekly';
  lastRunAt?: number;
  lastError?: string | null;
  lastFound?: number;
  lastNew?: number;
}

export interface FleetCheckResult {
  ok: boolean;
  error: string | null;
  checked: number;
  found: number;
  recorded: number;
  vehicles: { plate: string; ok: boolean; error?: string; found: number; recorded: number }[];
}

// ── Thu chi ──────────────────────────────────────────────────────────────────

export interface CashTotals {
  /** Tiền thuê thực nhận. */
  rent: number;
  otherIncome: number;
  income: number;
  /** Chi vận hành. */
  expense: number;
  /** Lãi vận hành. */
  profit: number;
  capitalIn: number;
  capitalOut: number;
  /** Dòng tiền ròng. */
  net: number;
}

export interface VehicleCashRow extends CashTotals {
  vehicleId: number;
  plate: string;
  make: string;
  model: string;
  archived: boolean;
  rentals: number;
  utilization: number | null;
}

export interface RentFlow {
  paymentId: number;
  at: number;
  amount: number;
  direction: PaymentDirection;
  method: PaymentMethod;
  note: string | null;
  rentalId: number;
  code: string;
  vehicleId: number;
  customerName: string;
}

export type LedgerRow =
  | { kind: 'rent'; key: string; at: number; direction: 'in' | 'out'; amount: number; flow: RentFlow; plate: string | null }
  | { kind: 'entry'; key: string; at: number; direction: 'in' | 'out'; amount: number; entry: CashEntry; plate: string | null; recurring: { id: number; description: string | null } | null };

export interface CashflowReport {
  period: Period;
  filter: 'all' | 'shared' | number;
  totals: CashTotals;
  receivables: { owed: number; owedCount: number; upcoming: number; upcomingCount: number; depositsHeld: number };
  trend: (CashTotals & { key: string })[];
  categories: { category: CashCategory; amount: number; count: number }[];
  vehicles: VehicleCashRow[];
  shared: CashTotals | null;
  rentals: { id: number; code: string; status: RentalStatus; customerName: string; start: number; end: number; total: number; paid: number; due: number }[];
  ledger: LedgerRow[];
  allocation: { sharedExpense: number; fleet: number };
  vehicleOptions: { id: number; plate: string; make: string; model: string; archived: boolean }[];
}

export type RecurringRow = RecurringCost & { plate: string | null };
