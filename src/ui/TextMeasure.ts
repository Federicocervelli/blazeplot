/** Size of a measured text run, in CSS pixels. */
export interface TextExtent {
  readonly width: number;
  readonly height: number;
}

/** Entries kept per document before the memo is dropped and rebuilt (bounds memory on unbounded label streams). */
const MAX_MEMO_ENTRIES = 2048;
/** Fallback extent when the document has no 2D canvas (e.g. a headless DOM). */
const FALLBACK_EXTENT: TextExtent = { width: 12, height: 12 };

interface DocumentMeasurer {
  readonly context: CanvasRenderingContext2D | null;
  /** font -> text -> extent. Fonts change rarely, so the outer map is tiny. */
  readonly memo: Map<string, Map<string, TextExtent>>;
  entries: number;
}

const measurers = new WeakMap<Document, DocumentMeasurer>();

function measurerFor(doc: Document): DocumentMeasurer {
  let measurer = measurers.get(doc);
  if (!measurer) {
    const context = doc.createElement("canvas").getContext("2d");
    const created: DocumentMeasurer = { context, memo: new Map(), entries: 0 };
    measurer = created;
    measurers.set(doc, created);
    // A web font that finishes loading changes glyph metrics, so remembered extents are stale.
    doc.fonts?.addEventListener?.("loadingdone", () => {
      created.memo.clear();
      created.entries = 0;
    });
  }
  return measurer;
}

/**
 * Measure a text run (rounded up to whole CSS pixels, at least 1) as a browser would lay it out in
 * `font`, with one shared 2D context and a memo per document. Axis tick labels are drawn from a
 * small, highly repetitive vocabulary ("0", "10", "20", ...), so after the first frame nearly every
 * lookup is a map hit instead of a `measureText` call plus a font switch. Width comes from the
 * advance width and height from the actual glyph bounds, matching what the label's box needs.
 */
export function measureText(doc: Document, font: string, text: string): TextExtent {
  const measurer = measurerFor(doc);
  const { context } = measurer;
  if (!context) return FALLBACK_EXTENT;
  let byText = measurer.memo.get(font);
  const cached = byText?.get(text);
  if (cached) return cached;
  if (measurer.entries >= MAX_MEMO_ENTRIES) {
    measurer.memo.clear();
    measurer.entries = 0;
    byText = undefined;
  }
  if (!byText) {
    byText = new Map();
    measurer.memo.set(font, byText);
  }
  context.font = font;
  const metrics = context.measureText(text);
  // A context that reports no glyph bounds (a minimal canvas implementation) gets the fallback size
  // for that dimension rather than NaN, which would defeat every unchanged-position comparison.
  const width = Math.ceil(metrics.width);
  const height = Math.ceil(metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent);
  const extent: TextExtent = {
    width: Number.isFinite(width) ? Math.max(1, width) : FALLBACK_EXTENT.width,
    height: Number.isFinite(height) ? Math.max(1, height) : FALLBACK_EXTENT.height,
  };
  byText.set(text, extent);
  measurer.entries++;
  return extent;
}
