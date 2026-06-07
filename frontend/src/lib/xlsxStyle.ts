// Thin typed wrapper around xlsx-js-style (no official @types package)
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import XLSXStyle from "xlsx-js-style";

export type CellStyle = {
  fill?: { patternType?: string; fgColor?: { rgb: string } };
  font?: { bold?: boolean; sz?: number; color?: { rgb: string }; italic?: boolean };
  alignment?: { horizontal?: "left" | "center" | "right"; vertical?: "top" | "center" | "bottom"; wrapText?: boolean };
  border?: {
    top?: { style: string; color: { rgb: string } };
    bottom?: { style: string; color: { rgb: string } };
    left?: { style: string; color: { rgb: string } };
    right?: { style: string; color: { rgb: string } };
  };
};

export type StyledCell = { v: string | number; t: "s" | "n"; s?: CellStyle };

export type MergeRange = { s: { r: number; c: number }; e: { r: number; c: number } };

export type WsCol = { wch: number };
export type WsRow = { hpt: number };

export interface StyledWorksheet {
  [addr: string]: StyledCell | { "!ref": string } | MergeRange[] | WsCol[] | WsRow[] | unknown;
  "!ref"?: string;
  "!merges"?: MergeRange[];
  "!cols"?: WsCol[];
  "!rows"?: WsRow[];
}

export interface StyledWorkbook {
  SheetNames: string[];
  Sheets: Record<string, StyledWorksheet>;
}

/** Create an empty workbook */
export function newWorkbook(): StyledWorkbook {
  return XLSXStyle.utils.book_new() as StyledWorkbook;
}

/** Append a worksheet to a workbook */
export function appendSheet(wb: StyledWorkbook, ws: StyledWorksheet, name: string): void {
  XLSXStyle.utils.book_append_sheet(wb, ws, name);
}

/** Write workbook and trigger browser download */
export function downloadWorkbook(wb: StyledWorkbook, filename: string): void {
  XLSXStyle.writeFile(wb, filename);
}

/** Encode a cell address from 0-based row/col */
export function addr(row: number, col: number): string {
  return XLSXStyle.utils.encode_cell({ r: row, c: col }) as string;
}

/** Create a styled string cell */
export function sc(value: string | number, style?: CellStyle): StyledCell {
  return { v: value, t: typeof value === "number" ? "n" : "s", s: style };
}

/** Merge cells helper — (row, col) to (row2, col2) all 0-based */
export function merge(r1: number, c1: number, r2: number, c2: number): MergeRange {
  return { s: { r: r1, c: c1 }, e: { r: r2, c: c2 } };
}
