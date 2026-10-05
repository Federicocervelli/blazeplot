import { releaseWebGLContext } from "./releaseWebGLContext.js";

/** Error thrown when a WebGL2 backend cannot be created. */
export class WebGL2UnavailableError extends Error {
  /** Create an unavailable-WebGL2 error. */
  constructor(message = "BlazePlot requires WebGL2, but this browser/context does not support it.") {
    super(message);
    this.name = "WebGL2UnavailableError";
  }
}

/**
 * Return whether the current environment can create a WebGL2 context. The probe canvas comes from
 * `doc` (default: the global `document`); pass an iframe or popup document to probe that window.
 */
export function isWebGL2Available(doc: Document | undefined = globalThis.document): boolean {
  if (!doc) return false;
  const gl = doc.createElement("canvas").getContext("webgl2");
  // The probe context counts against the browser's live-context cap until GC unless it is released.
  releaseWebGLContext(gl);
  return gl !== null;
}
