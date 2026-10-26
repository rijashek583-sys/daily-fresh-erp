export type Region = string;
export type Division = 'primary' | 'bakery';
export type FilterDivision = Division | 'all';

export const DIVISION_LABELS: Record<Division, string> = {
  primary: 'Primary Foods',
  bakery: 'Bakery Foods'
};

export interface User {
  uid: string;
  name: string;
  displayName?: string;
  email: string;
  role: 'admin' | 'staff' | 'delivery_staff';
  status: 'active' | 'inactive';
  createdAt: string;
}

export interface ClientOpeningBalance {
  amount: number;
  asOfDate: string;
  notes?: string;
  division?: Division;
  updatedAt?: string;
  updatedBy?: string;
}

export interface ClientTotals {
  totalOrders: number;
  totalRevenue: number;
  totalPaid: number;
  outstanding: number;
  openingBalance?: number;
  credit?: number;
  rawBalance?: number;
}

export interface Client {
  id: string;
  name: string;
  region: Region;
  regionName?: string;
  email?: string;
  phone?: string;
  city?: string;
  address?: string;
  status: 'active' | 'inactive';
  totalOrders: number;
  totalRevenue: number;
  totalPaid?: number;
  outstanding: number;
  credit?: number;
  availableCredit?: number;
  generalCredit?: number;
  primaryCredit?: number;
  bakeryCredit?: number;
  rawBalance?: number;
  openingBalance?: ClientOpeningBalance | null;
  openingBalanceAmount?: number;
  primaryTotals?: ClientTotals;
  bakeryTotals?: ClientTotals;
  joinedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string;
  deletedBy?: string;
}

export interface Product {
  id: string;
  name: string;
  description?: string;
  unit?: string;
  status: 'active' | 'inactive';
  displayOrder: number;
  division?: Division;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string;
  deletedBy?: string;
}

export interface OrderItem {
  productId: string;
  productName: string;
  qty: number;
  unitPrice: number;
  total: number;
}

export type OrderType = 'client' | 'direct';

export interface Order {
  id: string;
  orderType?: OrderType; // 'client' | 'direct', defaults to 'client'
  clientId: string;
  clientName: string;
  region?: string;
  deliveryDate: string;
  items: OrderItem[];
  subtotal: number;
  tax: number;
  total: number;
  creditApplied?: number;
  primaryCreditApplied?: number;
  bakeryCreditApplied?: number;
  netDue?: number;
  paidAmount?: number;
  paymentStatus?: 'paid' | 'partial' | 'pending';
  division?: FilterDivision; // 'all' is valid for cross-division orders
  createdAt: string;
  updatedBy?: string;
  updatedAt: string;
  notes?: string;
  staffId?: string;
  staffName?: string;
  deletedAt?: string;
  deletedBy?: string;
}

export interface TrashDocument {
  originalCollection: string;
  originalDocumentId: string;
  originalData: any;
  deletedAt: string;
  deletedBy: string;
}

export type PaymentMethod = 'upi' | 'cash' | 'bank_transfer' | 'card';

export interface Payment {
  id: string;
  orderType?: OrderType; // 'client' | 'direct'
  /** Links this payment to the specific order/invoice it was recorded against. */
  invoiceId?: string;
  otherInvoiceId?: string;
  clientId: string;
  clientName: string;
  region?: string;
  staffId?: string;
  staffName?: string;
  recordedBy?: string;
  amount: number;
  appliedAmount?: number;
  appliedToPrevious?: number;
  appliedToSameDivisionPrevious?: number;
  appliedToOtherDivisionPrevious?: number;
  appliedToOtherBill?: number;
  excessCredit?: number;
  generalCredit?: number;
  isAdvance?: boolean;
  method: PaymentMethod;
  reference?: string;
  notes?: string;
  idempotencyKey?: string;
  isCorrected?: boolean;
  originalAmount?: number;
  correctionReason?: string;
  correctionHistory?: PaymentCorrectionRecord[];
  paidAt?: string;
  paymentDate?: string;
  division: Division; // required — payments must be specifically primary or bakery
  createdAt: string;
  updatedBy?: string;
  billDate?: string;
  deletedAt?: string;
  deletedBy?: string;
}

export interface PaymentCorrectionRecord {
  correctedAt: string;
  correctedBy: string;
  adminId: string;
  adminName: string;
  originalAmount: number;
  newAmount: number;
  reason: string;
  paymentId?: string;
  invoiceId?: string;
  ledgerEntryIds?: string[];
}

export interface LedgerTransaction {
  id: string;
  isCorrected?: boolean;
  originalAmount?: number;
  type: 'payment' | 'invoice' | 'opening_balance';
  paymentId?: string;
  clientId: string;
  clientName?: string;
  region?: string;
  staffId?: string;
  staffName?: string;
  recordedBy?: string;
  invoiceId?: string;
  amount: number;
  appliedAmount?: number;
  appliedToPrevious?: number;
  appliedToSameDivisionPrevious?: number;
  appliedToOtherDivisionPrevious?: number;
  excessCredit?: number;
  generalCredit?: number;
  creditApplied?: number;
  isAdvance?: boolean;
  paymentDate?: string;
  paymentMethod?: string;
  description?: string;
  division: Division; // required — ledger entries are always division-specific
  createdAt: string;
  billDate?: string;
}

export const monthlyRevenueData: any[] = [];
export const deletedRegions: any[] = [];

export type {
  CustomerCreditBalance,
  CustomerCreditBalanceReviewBasis,
  CustomerCreditBalanceState,
} from './customerCreditBalance.types';

