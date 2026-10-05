attribute vec4 aRect;
attribute vec4 aColor;
attribute vec2 aCorner;

uniform vec2 uCanvasSize;

varying vec4 vColor;

// One instanced quad per rectangle. aRect is x, y, width, height in device pixels from the top-left corner.
void main() {
  vec2 pixel = aRect.xy + aCorner * aRect.zw;
  vec2 clipSpace = vec2(pixel.x / uCanvasSize.x * 2.0 - 1.0, 1.0 - pixel.y / uCanvasSize.y * 2.0);
  vColor = aColor;
  gl_Position = vec4(clipSpace, 0.0, 1.0);
}
