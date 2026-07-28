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

export function DivisionTabs({ activeTab, onChange, className }: DivisionTabsProps) {
  const { products } = useDataStore();

  const options = useMemo<{ id: FilterDivision; label: string }[]>(() => {
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

  return (
    <div className={cn("flex items-center", className)}>
      {/* Mobile: Native Dropdown */}
      <div className="relative md:hidden w-full min-w-[140px]">
        <select
          value={activeTab}
          onChange={e => onChange(e.target.value as FilterDivision)}
          className="
            w-full appearance-none pl-3 pr-8 py-1.5
            bg-white dark:bg-gray-900
            border border-gray-200 dark:border-gray-700
            rounded-lg
            text-xs font-semibold text-[var(--color-text-main)]
            outline-none
            focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]/20
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
        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
      </div>

      {/* Desktop: Horizontal Tabs */}
      <div className="hidden md:flex space-x-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg w-fit">
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
    </div>
  );
}
