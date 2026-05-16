import type { Camera2D } from "./Camera2D.js";
import type { PanIntent, ViewportPolicy, ZoomIntent } from "./types.js";

export class InputController {
  private _enabled: boolean = true;
  private activePointerId: number | null = null;
  private lastX: number = 0;
  private lastY: number = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: Camera2D,
    private readonly policy?: ViewportPolicy,
  ) {
    this.bindEvents();
  }

  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(value: boolean) {
    this._enabled = value;
  }

  private bindEvents(): void {
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (!this._enabled || this.activePointerId !== null) return;
    this.activePointerId = e.pointerId;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.canvas.setPointerCapture(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this._enabled || e.pointerId !== this.activePointerId) return;
    const rect = this.canvas.getBoundingClientRect();
    const dx = rect.width > 0 ? (this.lastX - e.clientX) / rect.width : 0;
    const dy = rect.height > 0 ? (e.clientY - this.lastY) / rect.height : 0;
    const intent = this.applyPanPolicy({ dx, dy });
    if (intent) this.camera.pan(intent);
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointerId) return;
    this.activePointerId = null;
    if (this.canvas.hasPointerCapture(e.pointerId)) {
      this.canvas.releasePointerCapture(e.pointerId);
    }
  };

  private onWheel = (e: WheelEvent): void => {
    if (!this._enabled) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const rect = this.canvas.getBoundingClientRect();
    const cx = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5;
    const cy = rect.height > 0 ? 1 - (e.clientY - rect.top) / rect.height : 0.5;
    const intent = this.applyZoomPolicy({ factor, cx, cy, axis: "xy" });
    if (intent) this.camera.zoom(intent);
  };

  private applyPanPolicy(intent: PanIntent): PanIntent | null {
    if (!this.policy?.beforePan) return intent;
    return this.policy.beforePan(this.camera, intent);
  }

  private applyZoomPolicy(intent: ZoomIntent): ZoomIntent | null {
    if (!this.policy?.beforeZoom) return intent;
    return this.policy.beforeZoom(this.camera, intent);
  }

  dispose(): void {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
  }
}
