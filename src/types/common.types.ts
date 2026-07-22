export type Status = 'active' | 'inactive' | 'pending';

export interface Timestamp {
  createdAt: string;
  updatedAt: string;
}

export interface Address {
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface Client extends Timestamp {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: Address;
  status: Status;
  totalOrders: number;
  totalRevenue: number;
}

export interface Product extends Timestamp {
  id: string;
  name: string;
  description: string;
  unit: string;
  category: string;
  status: Status;
  imageUrl?: string;
}

export interface ClientPricing extends Timestamp {
  id: string;
  clientId: string;
  productId: string;
  customPrice: number;
}

export type OrderStatus = 'pending' | 'processing' | 'delivered' | 'cancelled';

export interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface Order extends Timestamp {
  id: string;
  clientId: string;
  clientName: string;
  items: OrderItem[];
  subtotal: number;
  tax: number;
  total: number;
  status: OrderStatus;
  deliveryDate: string;
  notes?: string;
  assignedTo?: string; // delivery staff uid
}

export type PaymentStatus = 'pending' | 'completed' | 'failed' | 'refunded';
export type PaymentMethod = 'cash' | 'bank_transfer' | 'upi' | 'card';

export interface Payment extends Timestamp {
  id: string;
  orderId: string;
  clientId: string;
  clientName: string;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  reference?: string;
  paidAt?: string;
}

export type ProductionStatus = 'planned' | 'in_progress' | 'completed';

export interface ProductionItem {
  productId: string;
  productName: string;
  plannedQty: number;
  actualQty?: number;
  unit: string;
}

export interface ProductionBatch extends Timestamp {
  id: string;
  batchNumber: string;
  date: string;
  items: ProductionItem[];
  status: ProductionStatus;
  notes?: string;
  supervisorId: string;
}

export interface DashboardStats {
  todayOrders: number;
  todayRevenue: number;
  activeClients: number;
  pendingDeliveries: number;
  monthlyRevenue: number;
  monthlyOrders: number;
}
