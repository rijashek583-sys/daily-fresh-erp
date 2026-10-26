import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateAdminName,
  createAdminName,
  toggleAdminNameStatus,
  updateAdminName,
} from './adminNameService';
import * as firestore from 'firebase/firestore';
import * as functionsMod from 'firebase/functions';

const mockCallableFn = vi.fn();

vi.mock('firebase/functions', () => {
  return {
    getFunctions: vi.fn(() => ({})),
    httpsCallable: vi.fn(() => mockCallableFn),
  };
});

vi.mock('firebase/firestore', () => {
  return {
    collection: vi.fn(),
    doc: vi.fn((_db, _col, id) => ({ id, path: `${_col}/${id}` })),
    getDocs: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    onSnapshot: vi.fn(),
  };
});

vi.mock('../lib/firebase', () => ({
  app: {},
  db: {},
}));

describe('Admin Name Registry Service (Client Service Adapted for Cloud Functions)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validateAdminName', () => {
    it('accepts valid admin display names', () => {
      expect(validateAdminName('Rijash')).toEqual({ valid: true, normalized: 'Rijash' });
      expect(validateAdminName('Farooq EK')).toEqual({ valid: true, normalized: 'Farooq EK' });
      expect(validateAdminName('  Accounts Team  ')).toEqual({ valid: true, normalized: 'Accounts Team' });
    });

    it('rejects empty or whitespace-only names', () => {
      expect(validateAdminName('')).toEqual({ valid: false, normalized: '', error: 'Admin name is required.' });
      expect(validateAdminName('   ')).toEqual({ valid: false, normalized: '', error: 'Admin name is required.' });
    });

    it('rejects names shorter than 2 characters', () => {
      expect(validateAdminName('A')).toEqual({
        valid: false,
        normalized: 'A',
        error: 'Admin name must be at least 2 characters.',
      });
    });

    it('rejects names longer than 50 characters', () => {
      const longName = 'A'.repeat(51);
      expect(validateAdminName(longName)).toEqual({
        valid: false,
        normalized: longName,
        error: 'Admin name cannot exceed 50 characters.',
      });
    });

    it('rejects non-string types safely', () => {
      expect(validateAdminName(null as any)).toEqual({
        valid: false,
        normalized: '',
        error: 'Admin name is required.',
      });
      expect(validateAdminName(undefined as any)).toEqual({
        valid: false,
        normalized: '',
        error: 'Admin name is required.',
      });
    });
  });

  describe('createAdminName', () => {
    it('invokes manageAdminName Cloud Function with normalized name and returns docId', async () => {
      mockCallableFn.mockResolvedValueOnce({
        data: { success: true, adminNameId: 'admin_registered_999' },
      });

      const docId = await createAdminName('  Rijash EK ');
      expect(docId).toBe('admin_registered_999');

      expect(functionsMod.httpsCallable).toHaveBeenCalledWith(expect.anything(), 'manageAdminName');
      expect(mockCallableFn).toHaveBeenCalledWith({
        action: 'register',
        name: 'Rijash EK',
      });
    });

    it('rejects client validation if name is empty without calling Cloud Function', async () => {
      await expect(createAdminName('   ')).rejects.toThrow('Admin name is required.');
      expect(mockCallableFn).not.toHaveBeenCalled();
    });

    it('propagates Cloud Function error message on failure', async () => {
      mockCallableFn.mockRejectedValueOnce(
        new Error('An Admin name with "Rijash" already exists.')
      );

      await expect(createAdminName('Rijash')).rejects.toThrow(
        'An Admin name with "Rijash" already exists.'
      );
    });
  });

  describe('toggleAdminNameStatus', () => {
    it('invokes manageAdminName Cloud Function with toggle_status action', async () => {
      mockCallableFn.mockResolvedValueOnce({
        data: { success: true },
      });

      await toggleAdminNameStatus('admin_123', 'inactive');

      expect(mockCallableFn).toHaveBeenCalledWith({
        action: 'toggle_status',
        adminNameId: 'admin_123',
        newStatus: 'inactive',
      });
    });

    it('throws error if adminNameId is omitted', async () => {
      await expect(toggleAdminNameStatus('', 'active')).rejects.toThrow('Admin Name ID is required.');
      expect(mockCallableFn).not.toHaveBeenCalled();
    });
  });

  describe('updateAdminName', () => {
    it('invokes manageAdminName Cloud Function with rename action and normalized name', async () => {
      mockCallableFn.mockResolvedValueOnce({
        data: { success: true },
      });

      await updateAdminName('admin_123', '  Rijash E.K.  ');

      expect(mockCallableFn).toHaveBeenCalledWith({
        action: 'rename',
        adminNameId: 'admin_123',
        name: 'Rijash E.K.',
      });
    });

    it('rejects client validation if new name is too short', async () => {
      await expect(updateAdminName('admin_123', 'X')).rejects.toThrow('Admin name must be at least 2 characters.');
      expect(mockCallableFn).not.toHaveBeenCalled();
    });
  });
});
