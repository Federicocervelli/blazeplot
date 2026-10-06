/** Size of a measured text run, in CSS pixels. */
export interface TextExtent {
  readonly width: number;
  readonly height: number;
}

/** Entries kept per document before the memo is dropped and rebuilt (bounds memory on unbounded label streams). */
const MAX_MEMO_ENTRIES = 2048;
/** Size used for a dimension the 2D context cannot report (or when the document has no 2D canvas). */
const FALLBACK_PX = 12;

interface DocumentMeasurer {
  readonly context: CanvasRenderingContext2D | null;
  /** `font` + NUL + `text` -> extent. */
  readonly memo: Map<string, TextExtent>;
}

const measurers = new WeakMap<Document, DocumentMeasurer>();

function measurerFor(doc: Document): DocumentMeasurer {
  let measurer = measurers.get(doc);
  if (!measurer) {
    const created: DocumentMeasurer = { context: doc.createElement("canvas").getContext("2d"), memo: new Map() };
    measurer = created;
    measurers.set(doc, created);
    // A web font that finishes loading changes glyph metrics, so remembered extents are stale.
    doc.fonts?.addEventListener?.("loadingdone", () => created.memo.clear());
  }
  return measurer;
}

/** `value` rounded up to whole pixels (at least 1), or the fallback when the context did not report it. */
function wholePx(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.ceil(value)) : FALLBACK_PX;
}

/**
 * Measure a text run (rounded up to whole CSS pixels, at least 1) as a browser would lay it out in
 * `font`, with one shared 2D context and a memo per document. Axis tick labels are drawn from a
 * small, highly repetitive vocabulary ("0", "10", "20", ...), so after the first frame nearly every
 * lookup is a map hit instead of a `measureText` call plus a font switch. Width comes from the
 * advance width and height from the actual glyph bounds, matching what the label's box needs.
 */
export function measureText(doc: Document, font: string, text: string): TextExtent {
  const { context, memo } = measurerFor(doc);
  if (!context) return { width: FALLBACK_PX, height: FALLBACK_PX };
  const key = `${font}\0${text}`;
  let extent = memo.get(key);
  if (!extent) {
    if (memo.size >= MAX_MEMO_ENTRIES) memo.clear();
    context.font = font;
    const metrics = context.measureText(text);
    extent = { width: wholePx(metrics.width), height: wholePx(metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) };
    memo.set(key, extent);
  }
  return extent;
}
