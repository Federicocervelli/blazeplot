/**
 * Release a WebGL context now instead of waiting for garbage collection. Browsers cap live contexts
 * per page (about 16) and evict the oldest when the cap is hit, so a context that is merely
 * unreferenced can cause a live chart elsewhere on the page to lose its own.
 *
 * Only call this for a context the caller owns exclusively, after its GPU resources are deleted.
 */
export function releaseWebGLContext(gl: WebGL2RenderingContext | null | undefined): void {
  try {
    // Calling loseContext() on an already-lost context is itself an INVALID_OPERATION and blocks restore.
    if (gl && !gl.isContextLost()) gl.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    // Already lost or unsupported: nothing left to release.
  }
}
