export type Region = string;

export interface User {
  uid: string;
  name: string;
  displayName?: string;
  email: string;
  role: 'admin' | 'staff' | 'delivery_staff';
  status: 'active' | 'inactive';
  createdAt: string;
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
  items: OrderItem[];
  subtotal: number;
  total: number;
  deliveryDate: string;
  status: 'pending' | 'completed' | 'cancelled';
  paymentStatus: 'unpaid' | 'partial' | 'paid';
  paidAmount: number;
  createdAt: string;
  createdBy: string;
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

export type PaymentStatus = 'completed' | 'pending' | 'failed';
export type PaymentMethod = 'upi' | 'cash' | 'bank_transfer' | 'card';

export interface Payment {
  id: string;
  orderId?: string;
  clientId: string;
  clientName: string;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  reference?: string;
  paidAt?: string;
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
  invoiceId?: string;
  amount: number;
  paymentDate?: string;
  paymentMethod?: string;
  description?: string;
  createdAt: string;
}

export const monthlyRevenueData: any[] = [];
export const deletedRegions: any[] = [];
