import React, { useMemo } from 'react';
import { type FilterDivision } from '../../types';
import { cn, getProductDivision } from '../../lib/utils';
import { useDataStore } from '../../stores/dataStore';
import { ChevronDown } from 'lucide-react';

interface DivisionTabsProps {
  activeTab: FilterDivision;
  onChange: (tab: FilterDivision) => void;
  className?: string;
}

const DIVISION_LABELS: Record<string, string> = {
  all: 'All',
  primary: 'Primary Foods',
  bakery: 'Bakery Foods',
};

function useCategoryOptions() {
  const { products } = useDataStore();
  return useMemo<{ id: FilterDivision; label: string }[]>(() => {
    const divSet = new Set<string>();
    products
      .filter(p => !p.deletedAt)
      .forEach(p => divSet.add(getProductDivision(p)));

    const opts: { id: FilterDivision; label: string }[] = [
      { id: 'all', label: 'All' },
    ];

    // Stable order: primary, bakery, then any future divisions alphabetically
    const ordered = [
      'primary',
      'bakery',
      ...Array.from(divSet).filter(d => d !== 'primary' && d !== 'bakery').sort(),
    ];

    ordered
      .filter(d => divSet.has(d))
      .forEach(d => {
        opts.push({
          id: d as FilterDivision,
          label: DIVISION_LABELS[d] ?? d.charAt(0).toUpperCase() + d.slice(1),
        });
      });

    return opts;
  }, [products]);
}

export function DivisionDropdownMobile({ activeTab, onChange, className }: DivisionTabsProps) {
  const options = useCategoryOptions();
  return (
    <div className={cn("w-full flex flex-col gap-1.5", className)}>
      <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest pl-1">
        Category
      </label>
      <div className="relative w-full">
        <select
          value={activeTab}
          onChange={e => onChange(e.target.value as FilterDivision)}
          className="
            w-full appearance-none pl-4 pr-10 py-3
            bg-white dark:bg-gray-900
            border border-gray-200 dark:border-gray-700
            rounded-2xl
            text-sm font-bold text-[var(--color-text-main)]
            outline-none
            focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20
            transition-all duration-200
            cursor-pointer
            shadow-sm
          "
        >
          {options.map((tab) => (
            <option key={tab.id} value={tab.id}>
              {tab.label}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
      </div>
    </div>
  );
}

export function DivisionTabsDesktop({ activeTab, onChange, className }: DivisionTabsProps) {
  const options = useCategoryOptions();
  return (
    <div className={cn("flex space-x-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg w-fit", className)}>
      {options.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            "px-4 py-2 text-sm font-medium rounded-md transition-colors duration-200",
            activeTab === tab.id
              ? "bg-white dark:bg-gray-900 text-[var(--color-primary)] shadow-sm"
              : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-200/50 dark:hover:bg-gray-700/50"
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function DivisionTabs(props: DivisionTabsProps) {
  return <DivisionTabsDesktop {...props} />;
}
