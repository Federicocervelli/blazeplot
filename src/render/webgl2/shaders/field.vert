attribute vec2 aCorner;
attribute vec4 aRect;

uniform vec2 uCanvasSize;

varying vec2 vUv;

// A grid of opacities as one texture over a device-pixel rectangle (x, y, width, height) from the top-left corner.
void main() {
  vUv = aCorner;
  vec2 p = aRect.xy + aCorner * aRect.zw;
  gl_Position = vec4(p.x / uCanvasSize.x * 2.0 - 1.0, 1.0 - p.y / uCanvasSize.y * 2.0, 0.0, 1.0);
}
