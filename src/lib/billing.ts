import { type PaymentMethod, type Payment } from '../types';
import { useDataStore } from '../stores/dataStore';
import { format } from 'date-fns';

/**
 * Calculates a client's old balance strictly BEFORE the provided deliveryDate.
 * Old Balance = (Sum of all orders delivered BEFORE deliveryDate) - (Sum of all payments applied BEFORE deliveryDate)
 */
export function calculateOldBalance(clientId: string, deliveryDate: string): number {
  const { orders, payments } = useDataStore.getState();
  const previousOrders = orders.filter(o => o.clientId === clientId && o.deliveryDate < deliveryDate);
  // A payment is considered "before" this delivery date if its billDate (or createdAt) is strictly before
  const previousPayments = payments.filter(p => p.clientId === clientId && (p.billDate || p.createdAt) < deliveryDate && !p.deletedAt);

  const totalBilled = previousOrders.reduce((sum, o) => sum + o.total, 0);
  const totalPaid = previousPayments.filter(p => p.status === 'completed').reduce((sum, p) => sum + p.amount, 0);

  return totalBilled - totalPaid;
}

export function calculatePaymentsOnDate(clientId: string, date: string): number {
  const { payments } = useDataStore.getState();
  const dayPayments = payments.filter(p => p.clientId === clientId && p.billDate === date && p.status === 'completed' && !p.deletedAt);
  return dayPayments.reduce((sum, p) => sum + p.amount, 0);
}

export function getBillPaymentStatus(clientId: string, date: string): 'paid' | 'partial' | 'unpaid' {
  const { orders } = useDataStore.getState();
  const dayOrders = orders.filter(o => o.clientId === clientId && o.deliveryDate === date);
  const subtotal = dayOrders.reduce((sum, o) => sum + o.total, 0);
  const oldBalance = calculateOldBalance(clientId, date);
  const grandTotal = subtotal + oldBalance;
  const paidAmount = calculatePaymentsOnDate(clientId, date);

  if (paidAmount >= grandTotal && grandTotal > 0) return 'paid';
  if (paidAmount > 0) return 'partial';
  if (grandTotal <= 0 && paidAmount === 0) return 'paid';
  return 'unpaid';
}

export function getClientOutstanding(clientId: string): number {
  const { orders, payments } = useDataStore.getState();
  const clientOrders = orders.filter(o => o.clientId === clientId);
  const clientPayments = payments.filter(p => p.clientId === clientId && p.status === 'completed' && !p.deletedAt);

  const totalBilled = clientOrders.reduce((sum, o) => sum + o.total, 0);
  const totalPaid = clientPayments.reduce((sum, p) => sum + p.amount, 0);

  return totalBilled - totalPaid;
}

import { recordPaymentAtomic } from '../services/db';

export async function recordPayment(paymentData: any) {
  // Directly call the atomic function
  await recordPaymentAtomic(paymentData);
}

export function getPaymentUpdateInfo(clientId: string, billDate: string) {
  const { payments } = useDataStore.getState();
  const payment = payments.find(p => p.clientId === clientId && p.billDate === billDate && p.status === 'completed' && !p.deletedAt);
  if (payment && payment.updatedBy) {
    return `Updated by ${payment.updatedBy} on ${format(new Date(payment.createdAt), 'MMM d')}`;
  }
  return null;
}
