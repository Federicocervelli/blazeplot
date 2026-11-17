// highp: distances along a long segment or across a large shape need more than mediump's ~11 bits.
precision highp float;

varying vec2 vLocal;
varying vec2 vHalf;
varying vec2 vShape;
varying vec4 vFill;
varying vec4 vBorder;

// Signed distance to a rounded rectangle: negative inside. Coverage of the outer edge and of
// the border's inner edge is one pixel wide, so shapes stay smooth at any size and zoom.
void main() {
  float radius = vShape.x;
  vec2 q = abs(vLocal) - vHalf + radius;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
  float coverage = clamp(0.5 - d, 0.0, 1.0);
  if (coverage <= 0.0) discard;
  float inner = vShape.y > 0.0 ? clamp(0.5 - (d + vShape.y), 0.0, 1.0) : 1.0;
  // The drawing buffer is premultiplied (see WebGL2Backend), so mix premultiplied colors.
  vec4 fill = vec4(vFill.rgb * vFill.a, vFill.a);
  vec4 border = vec4(vBorder.rgb * vBorder.a, vBorder.a);
  gl_FragColor = mix(border, fill, inner) * coverage;
}
