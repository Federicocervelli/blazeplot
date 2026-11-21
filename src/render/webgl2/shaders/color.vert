attribute vec2 aPosition;
attribute vec4 aColor;

uniform vec2 uCanvasSize;

varying vec4 vColor;

// Per-vertex colored triangles, in device pixels from the top-left corner.
void main() {
  vColor = aColor;
  gl_Position = vec4(aPosition.x / uCanvasSize.x * 2.0 - 1.0, 1.0 - aPosition.y / uCanvasSize.y * 2.0, 0.0, 1.0);
}
