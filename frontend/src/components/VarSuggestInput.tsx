'use client';

import React, { useMemo, useState } from 'react';
import { envCompletionsFor, templateTokenBefore } from '@/lib/envCompletions';

interface VarSuggestInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  value: string;
  onValueChange: (value: string) => void;
  envKeys?: string[];
}

export function VarSuggestInput({
  value,
  onValueChange,
  envKeys = [],
  onChange,
  ...rest
}: VarSuggestInputProps) {
  const [open, setOpen] = useState(false);
  const token = templateTokenBefore(value);
  const options = useMemo(
    () => (token ? envCompletionsFor(token, envKeys) : []),
    [token, envKeys]
  );
  const show = open && options.length > 0;

  const apply = (label: string) => {
    const idx = value.lastIndexOf('{{');
    if (idx < 0) return;
    onValueChange(`${value.slice(0, idx)}{{${label}}}`);
    setOpen(false);
  };

  return (
    <div className="var-suggest">
      <input
        {...rest}
        value={value}
        onChange={(e) => {
          onValueChange(e.target.value);
          onChange?.(e);
          setOpen(Boolean(templateTokenBefore(e.target.value)));
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onFocus={() => setOpen(Boolean(templateTokenBefore(value)))}
      />
      {show && (
        <ul className="var-suggest-list" data-testid="env-suggest-list" role="listbox">
          {options.map((opt: { label: string }) => (
            <li key={opt.label}>
              <button
                type="button"
                className="var-suggest-item"
                data-testid="env-suggest-item"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => apply(opt.label)}
              >
                {opt.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
