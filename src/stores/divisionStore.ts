import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { type FilterDivision } from '../types';

interface DivisionState {
  activeDivision: FilterDivision;
  setDivision: (division: FilterDivision) => void;
}

export const useDivisionStore = create<DivisionState>()(
  persist(
    (set) => ({
      activeDivision: 'all',
      setDivision: (division) => set({ activeDivision: division }),
    }),
    {
      name: 'daily-fresh-division',
    }
  )
);
