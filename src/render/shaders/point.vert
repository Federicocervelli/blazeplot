attribute vec2 aPosition;
attribute vec2 aCorner;

uniform vec2 uScale;
uniform vec2 uOffset;
uniform vec2 uCanvasSize;
uniform float uPointSize;

void main() {
  vec2 centerClip = aPosition * uScale + uOffset;
  vec2 pointSizeClip = vec2(2.0 / uCanvasSize.x, 2.0 / uCanvasSize.y) * uPointSize * 0.5;
  vec2 clipSpace = centerClip + aCorner * pointSizeClip;
  gl_Position = vec4(clipSpace, 0.0, 1.0);
}
