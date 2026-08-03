'use client';

import React, { useEffect, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import { javascript } from '@codemirror/lang-javascript';

export type EditorLanguage = 'json' | 'xml' | 'javascript' | 'text';

function extensionFor(language: EditorLanguage) {
  switch (language) {
    case 'json':
      return json();
    case 'xml':
      return xml();
    case 'javascript':
      return javascript();
    default:
      return [];
  }
}

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: EditorLanguage;
  placeholder?: string;
  height?: string;
  readOnly?: boolean;
  ariaLabel?: string;
}

export function CodeEditor({
  value,
  onChange,
  language = 'text',
  placeholder,
  height = '240px',
  readOnly = false,
  ariaLabel,
}: CodeEditorProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className="editor-placeholder" style={{ height }} aria-label={ariaLabel} />;
  }

  return (
    <div className="code-editor" data-testid={`editor-${language}`}>
      <CodeMirror
        value={value}
        height={height}
        theme="dark"
        extensions={[extensionFor(language)]}
        onChange={(v) => onChange(v)}
        placeholder={placeholder}
        readOnly={readOnly}
        basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true }}
        aria-label={ariaLabel}
      />
    </div>
  );
}
