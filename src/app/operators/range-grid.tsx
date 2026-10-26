export type RangeGridCell = Readonly<{ row: number; col: number }>;
export type RangeGridEnvelope = Readonly<{ minRow: number; maxRow: number; minCol: number; maxCol: number }>;

/** Smallest box that holds the operator cell (0, 0) and every given cell. */
export function getRangeGridEnvelope(grids: readonly RangeGridCell[]): RangeGridEnvelope {
  return {
    minRow: Math.min(0, ...grids.map((cell) => cell.row)), maxRow: Math.max(0, ...grids.map((cell) => cell.row)),
    minCol: Math.min(0, ...grids.map((cell) => cell.col)), maxCol: Math.max(0, ...grids.map((cell) => cell.col)),
  };
}

type RangeGridProps = {
  /** Cells in the shape of `range_table` (`grids`), relative to the operator at (0, 0). */
  grids: readonly RangeGridCell[];
  /** Heading above the grid; omitted when not set. */
  label?: string;
  /** Box to draw. Pass a shared one to keep several grids the same size; defaults to the box of `grids`. */
  envelope?: RangeGridEnvelope;
};

export function RangeGrid({ grids, label, envelope = getRangeGridEnvelope(grids) }: RangeGridProps) {
  const coordinates = new Set(grids.map((cell) => `${cell.row}:${cell.col}`));
  const cells = [];
  for (let row = envelope.maxRow; row >= envelope.minRow; row -= 1) for (let col = envelope.minCol; col <= envelope.maxCol; col += 1) {
    const isOperator = row === 0 && col === 0;
    const isReachable = coordinates.has(`${row}:${col}`);
    cells.push(<span key={`${row}:${col}`} className={`operator-range-cell${isOperator ? " is-operator" : isReachable ? " is-reachable" : ""}`} aria-label={isOperator ? "Casilla del operador" : isReachable ? "Casilla alcanzable" : "Fuera del alcance"} />);
  }
  return <div className="operator-tactical-range-view">{label ? <div className="operator-tactical-range-heading"><span className="operator-tactical-label">{label}</span></div> : null}<div className="operator-range-grid" style={{ gridTemplateColumns: `repeat(${envelope.maxCol - envelope.minCol + 1}, minmax(0, 1fr))` }}>{cells}</div></div>;
}
