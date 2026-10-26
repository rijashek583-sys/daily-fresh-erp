import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as functionsMod from 'firebase/functions';
import {
  callRecordPayment,
  callCorrectPayment,
  type RecordPaymentServerPayload,
  type CorrectPaymentServerPayload,
} from './paymentsService';

const mockCallableFn = vi.fn();

vi.mock('firebase/functions', () => {
  return {
    getFunctions: vi.fn(() => ({})),
    httpsCallable: vi.fn(() => mockCallableFn),
  };
});

vi.mock('../lib/firebase', () => ({
  app: {},
  db: {},
}));

describe('paymentsService (Cloud Functions Client Bridge)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls recordPayment callable Cloud Function with correct parameters', async () => {
    mockCallableFn.mockResolvedValueOnce({
      data: {
        success: true,
        paymentId: 'pay_idem_001',
        duplicate: false,
        primaryAllocated: 100,
        bakeryAllocated: 50,
        excessCredit: 0,
        financialRevision: 2,
      },
    });

    const payload: RecordPaymentServerPayload = {
      clientId: 'client_1',
      amount: 150,
      paymentDate: '2026-03-10',
      billDate: '2026-03-10',
      method: 'cash',
      idempotencyKey: 'pay_idem_001',
    };

    const res = await callRecordPayment(payload);

    expect(functionsMod.httpsCallable).toHaveBeenCalledWith(expect.anything(), 'recordPayment');
    expect(mockCallableFn).toHaveBeenCalledWith(payload);
    expect(res.success).toBe(true);
    expect(res.paymentId).toBe('pay_idem_001');
    expect(res.primaryAllocated).toBe(100);
    expect(res.bakeryAllocated).toBe(50);
  });

  it('calls correctPayment callable Cloud Function with correction payload', async () => {
    mockCallableFn.mockResolvedValueOnce({
      data: {
        success: true,
        paymentId: 'pay_001',
        originalAmount: 200,
        newAmount: 100,
        financialRevision: 3,
      },
    });

    const payload: CorrectPaymentServerPayload = {
      paymentId: 'pay_001',
      newAmount: 100,
      correctionReason: 'Typo in payment amount entered by staff.',
    };

    const res = await callCorrectPayment(payload);

    expect(functionsMod.httpsCallable).toHaveBeenCalledWith(expect.anything(), 'correctPayment');
    expect(mockCallableFn).toHaveBeenCalledWith(payload);
    expect(res.success).toBe(true);
    expect(res.originalAmount).toBe(200);
    expect(res.newAmount).toBe(100);
    expect(res.financialRevision).toBe(3);
  });
});
