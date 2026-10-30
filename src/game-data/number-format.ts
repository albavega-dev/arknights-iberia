const spanishNumberFormat = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 });

/** Formats a number for display in Spanish: at most two decimals, so floating-point noise is dropped. */
export function formatNumber(value: number): string {
  return spanishNumberFormat.format(value);
}

/** Formats a number followed by a space and the percent sign, as in "100 %". */
export function formatPercent(value: number): string {
  return `${formatNumber(value)} %`;
}
