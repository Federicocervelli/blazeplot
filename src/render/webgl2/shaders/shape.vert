attribute vec4 aRect;
attribute vec2 aShape;
attribute vec4 aFill;
attribute vec4 aBorder;
attribute vec2 aCorner;

uniform vec2 uCanvasSize;

varying vec2 vLocal;
varying vec2 vHalf;
varying vec2 vShape;
varying vec4 vFill;
varying vec4 vBorder;

// One instanced quad per shape, grown by a pixel on every side so the antialiased edge fits.
// aRect is x, y, width, height and aShape is the corner radius and border width, in device
// pixels from the top-left corner. vLocal is the fragment's offset from the shape's center.
void main() {
  vec2 halfSize = aRect.zw * 0.5;
  vec2 local = (aCorner * 2.0 - 1.0) * (halfSize + 1.0);
  vec2 pixel = aRect.xy + halfSize + local;
  vLocal = local;
  vHalf = halfSize;
  vShape = vec2(clamp(aShape.x, 0.0, min(halfSize.x, halfSize.y)), clamp(aShape.y, 0.0, min(halfSize.x, halfSize.y)));
  vFill = aFill;
  vBorder = aBorder;
  gl_Position = vec4(pixel.x / uCanvasSize.x * 2.0 - 1.0, 1.0 - pixel.y / uCanvasSize.y * 2.0, 0.0, 1.0);
}
