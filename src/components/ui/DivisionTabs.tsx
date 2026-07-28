import React from 'react';
import { type FilterDivision } from '../../types';
import { cn } from '../../lib/utils';

interface DivisionTabsProps {
  activeTab: FilterDivision;
  onChange: (tab: FilterDivision) => void;
  className?: string;
}

export function DivisionTabs({ activeTab, onChange, className }: DivisionTabsProps) {
  const tabs: { id: FilterDivision; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'primary', label: 'Primary Foods' },
    { id: 'bakery', label: 'Bakery Foods' },
  ];

  return (
    <div className={cn("flex space-x-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg w-fit", className)}>
      {tabs.map((tab) => (
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
