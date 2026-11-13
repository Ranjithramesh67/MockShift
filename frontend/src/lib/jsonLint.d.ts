export function jsonLintDiagnostics(text: string): Array<{
  from: number;
  to: number;
  severity: 'error';
  message: string;
}>;

export function jsonLint(view: { state: { doc: { toString(): string } } }): Array<{
  from: number;
  to: number;
  severity: 'error';
  message: string;
}>;

export function getErrorPosition(error: unknown, text: string): number;
