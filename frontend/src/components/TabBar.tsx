'use client';

import React from 'react';

export interface TabItem<T extends string> {
  id: T;
  label: string;
}

export function TabBar<T extends string>({
  tabs,
  active,
  onChange,
  testIdPrefix,
}: {
  tabs: Array<TabItem<T>>;
  active: T;
  onChange: (id: T) => void;
  testIdPrefix: string;
}) {
  return (
    <div className="tab-bar" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          className={`tab ${active === tab.id ? 'tab-active' : ''}`}
          data-testid={`${testIdPrefix}-tab-${tab.id}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
