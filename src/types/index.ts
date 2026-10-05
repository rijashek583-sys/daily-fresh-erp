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

export interface ClientTotals {
  totalOrders: number;
  totalRevenue: number;
  totalPaid: number;
  outstanding: number;
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

export interface Order {
  id: string;
  clientId: string;
  clientName: string;
  deliveryDate: string;
  items: OrderItem[];
  subtotal: number;
  tax: number;
  total: number;
  division?: FilterDivision; // 'all' is valid for cross-division orders
  createdAt: string;
  updatedBy?: string;
  updatedAt: string;
  notes?: string;
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
  /** Links this payment to the specific order/invoice it was recorded against. */
  invoiceId?: string;
  clientId: string;
  clientName: string;
  region?: string;
  staffId?: string;
  staffName?: string;
  recordedBy?: string;
  amount: number;
  method: PaymentMethod;
  reference?: string;
  notes?: string;
  paidAt?: string;
  paymentDate?: string;
  division: Division; // required — payments must be specifically primary or bakery
  createdAt: string;
  updatedBy?: string;
  billDate?: string;
  deletedAt?: string;
  deletedBy?: string;
}


export interface LedgerTransaction {
  id: string;
  type: 'payment' | 'invoice';
  paymentId?: string;
  clientId: string;
  clientName?: string;
  region?: string;
  staffId?: string;
  staffName?: string;
  recordedBy?: string;
  invoiceId?: string;
  amount: number;
  paymentDate?: string;
  paymentMethod?: string;
  description?: string;
  division: Division; // required — ledger entries are always division-specific
  createdAt: string;
  billDate?: string;
}

export const monthlyRevenueData: any[] = [];
export const deletedRegions: any[] = [];

