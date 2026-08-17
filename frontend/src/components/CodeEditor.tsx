'use client';

import React, { useEffect, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import { javascript } from '@codemirror/lang-javascript';
import { Prec } from '@codemirror/state';
import { keymap } from '@codemirror/view';

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
  /**
   * Called on Ctrl/Cmd+Enter inside the editor. Provided handlers override the
   * editor's default newline binding (CodeMirror binds Mod-Enter to insert a
   * blank line) so the shortcut runs the request instead of editing the text.
   */
  onModEnter?: () => void;
}

export function CodeEditor({
  value,
  onChange,
  language = 'text',
  placeholder,
  height = '240px',
  readOnly = false,
  ariaLabel,
  onModEnter,
}: CodeEditorProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // extensionFor returns a single (non-iterable) Extension object, so it must
  // always be wrapped in an array before spreading into the extensions list.
  const baseExtensions = [extensionFor(language)] as any[];

  const extensions = onModEnter
    ? [
        ...baseExtensions,
        // Highest precedence so this binding wins over the default Mod-Enter
        // (insertBlankLine) shipped with basicSetup.
        Prec.highest(
          keymap.of([
            {
              key: 'Mod-Enter',
              run: () => {
                onModEnter();
                return true;
              },
            },
          ])
        ),
      ]
    : baseExtensions;

  if (!mounted) {
    return <div className="editor-placeholder" style={{ height }} aria-label={ariaLabel} />;
  }

  return (
    <div className="code-editor" data-testid={`editor-${language}`} data-mod-enter={onModEnter ? 'true' : undefined}>
      <CodeMirror
        value={value}
        height={height}
        theme="dark"
        extensions={extensions}
        onChange={(v) => onChange(v)}
        placeholder={placeholder}
        readOnly={readOnly}
        basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true }}
        aria-label={ariaLabel}
      />
    </div>
  );
}
