// Kiểu dữ liệu API trả về. Bảng gốc lấy từ lược đồ DB (chỉ import type).

import type {
  AccessoryCatalogItem,
  Charge,
  Collateral,
  ContractTemplate,
  Customer,
  DocumentRow,
  Handover,
  HandoverAccessory,
  Payment,
  Rental,
  RentalSegment,
  TrafficFine,
  Vehicle,
  VehicleAccessory,
  VehicleBlock,
} from '@api/db/schema';
import type { MoneySummary } from '@shared/money';
import type { Quote } from '@shared/pricing';
import type { AccessoryCategory, Role } from '@shared/constants';

export type { AccessoryCatalogItem, HandoverAccessory, VehicleAccessory, Charge, Collateral, ContractTemplate, Customer, DocumentRow, Handover, Payment, Rental, RentalSegment, TrafficFine, Vehicle, VehicleBlock, MoneySummary, Quote };

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
  fineHoldAmount: number;
  fineHoldDays: number;
  minDriverAge: number;
  checklist: string[];
  deliveryFeeDefault: number;
}

export interface SettingsData {
  business: BusinessSettings;
  rules: RulesSettings;
  banks: { bin: string; code: string; name: string }[];
}
