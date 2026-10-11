'use client';

import React from 'react';

export function ToggleSwitch({
  checked,
  onChange,
  disabled,
  label,
  testId,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  testId?: string;
}) {
  return (
    <label className={`toggle-switch ${disabled ? 'is-disabled' : ''}`}>
      <input
        type="checkbox"
        role="switch"
        className="toggle-switch-input"
        data-testid={testId}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="toggle-switch-track" aria-hidden="true">
        <span className="toggle-switch-thumb" />
      </span>
      {label ? <span className="toggle-switch-label">{label}</span> : null}
    </label>
  );
}
