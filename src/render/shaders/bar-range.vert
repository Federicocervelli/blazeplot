attribute float aX;
attribute float aMinY;
attribute float aMaxY;
attribute vec2 aCorner;

uniform vec2 uScale;
uniform vec2 uOffset;
uniform vec2 uCanvasSize;
uniform float uBarWidth;

float pixelSnappedBarX(float centerClipX) {
  float canvasWidth = max(1.0, uCanvasSize.x);
  float widthPx = abs(uBarWidth * uScale.x) * 0.5 * canvasWidth;
  if (widthPx > 2.0) {
    return centerClipX + aCorner.x * uBarWidth * uScale.x;
  }

  float snappedWidthPx = max(1.0, floor(widthPx + 0.5));
  float centerPx = (centerClipX * 0.5 + 0.5) * canvasWidth;
  float leftPx = floor(centerPx + 0.5 - snappedWidthPx * 0.5);
  float edgePx = leftPx + (aCorner.x < 0.0 ? 0.0 : snappedWidthPx);
  return (edgePx / canvasWidth) * 2.0 - 1.0;
}

void main() {
  float centerClipX = aX * uScale.x + uOffset.x;
  float clipX = pixelSnappedBarX(centerClipX);
  float y = mix(aMinY, aMaxY, aCorner.y);
  float clipY = y * uScale.y + uOffset.y;
  gl_Position = vec4(clipX, clipY, 0.0, 1.0);
}
