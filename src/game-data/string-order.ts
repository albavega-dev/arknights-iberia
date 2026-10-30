/** Orders strings by UTF-16 code unit, the order of a plain sort(), whatever the system language. */
export function compareCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}
