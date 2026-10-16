type Point = { x: number; y: number };
type Stroke = { color: string; width: number; points: Point[] };

const SIZE = 512; // logical drawing size; also the snapshot size

export class DrawingCanvas {
  readonly el: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private strokes: Stroke[] = [];
  private current: Stroke | null = null;
  private version = 0;
  private enabled = false;

  color = '#111111';
  width = 6;

  constructor(el: HTMLCanvasElement) {
    this.el = el;
    el.width = SIZE;
    el.height = SIZE;
    this.ctx = el.getContext('2d')!;
    this.redraw();

    el.addEventListener('pointerdown', (e) => this.onDown(e));
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerup', () => this.onUp());
    el.addEventListener('pointercancel', () => this.onUp());
  }

  /** Increments on every visible change, so callers can skip unchanged snapshots. */
  get changeVersion() {
    return this.version;
  }

  get isEmpty() {
    return this.strokes.length === 0;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) this.onUp();
    this.el.classList.toggle('disabled', !on);
  }

  clear() {
    this.strokes = [];
    this.current = null;
    this.bump();
  }

  undo() {
    this.strokes.pop();
    this.bump();
  }

  /** JPEG data URL on a white background (transparent pixels read as black to some models). */
  snapshot(): string {
    return this.el.toDataURL('image/jpeg', 0.85);
  }

  private toPoint(e: PointerEvent): Point {
    const r = this.el.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * SIZE,
      y: ((e.clientY - r.top) / r.height) * SIZE,
    };
  }

  private onDown(e: PointerEvent) {
    if (!this.enabled) return;
    e.preventDefault();
    this.el.setPointerCapture(e.pointerId);
    this.current = { color: this.color, width: this.width, points: [this.toPoint(e)] };
    this.strokes.push(this.current);
    this.bump();
  }

  private onMove(e: PointerEvent) {
    if (!this.current) return;
    e.preventDefault();
    this.current.points.push(this.toPoint(e));
    this.bump();
  }

  private onUp() {
    this.current = null;
  }

  private bump() {
    this.version++;
    this.redraw();
  }

  private redraw() {
    const { ctx } = this;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of this.strokes) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.beginPath();
      const [first, ...rest] = s.points;
      ctx.moveTo(first.x, first.y);
      if (rest.length === 0) ctx.lineTo(first.x + 0.1, first.y);
      for (const p of rest) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
  }
}
