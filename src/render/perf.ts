import type { WebGLRenderer } from 'three';

/**
 * Frame statistics, the F3 performance overlay (spec §10.4) and adaptive resolution (§10.3).
 */
export class FrameStats {
  private readonly frames = new Float32Array(240);
  private readonly cpu = new Float32Array(240);
  private index = 0;
  private filled = 0;
  private readonly sorted = new Float32Array(240);

  push(frameMs: number, cpuMs: number): void {
    this.frames[this.index] = frameMs;
    this.cpu[this.index] = cpuMs;
    this.index = (this.index + 1) % this.frames.length;
    this.filled = Math.min(this.filled + 1, this.frames.length);
  }

  /** Percentile of recent frame times (ms). */
  percentile(p: number, which: 'frame' | 'cpu' = 'frame'): number {
    if (this.filled === 0) return 0;
    const src = which === 'frame' ? this.frames : this.cpu;
    this.sorted.set(src.subarray(0, this.filled));
    const view = this.sorted.subarray(0, this.filled);
    view.sort();
    return view[Math.min(this.filled - 1, Math.floor((p / 100) * this.filled))] ?? 0;
  }

  average(which: 'frame' | 'cpu' = 'frame'): number {
    if (this.filled === 0) return 0;
    const src = which === 'frame' ? this.frames : this.cpu;
    let s = 0;
    for (let i = 0; i < this.filled; i++) s += src[i]!;
    return s / this.filled;
  }

  max(which: 'frame' | 'cpu' = 'frame'): number {
    const src = which === 'frame' ? this.frames : this.cpu;
    let m = 0;
    for (let i = 0; i < this.filled; i++) m = Math.max(m, src[i]!);
    return m;
  }

  reset(): void {
    this.filled = 0;
    this.index = 0;
  }
}

/**
 * Adaptive resolution with hysteresis so quality never visibly pumps (ZD-C13): steps down 10% when the
 * 95th percentile frame time misses vsync for 2 s, steps back up only after 10 s of stable frames,
 * and backs off longer each time it oscillates.
 */
export class AdaptiveResolution {
  scale = 1;
  min = 0.67;
  private slowFor = 0;
  private fastFor = 0;
  private cooldown = 0;
  private blockUp = 0;
  private upBlockTime = 20;

  update(dt: number, p95: number, enabled: boolean): boolean {
    if (!enabled) {
      const changed = this.scale !== 1;
      this.scale = 1;
      return changed;
    }
    this.cooldown -= dt;
    this.blockUp -= dt;
    if (p95 > 20) {
      this.slowFor += dt;
      this.fastFor = 0;
    } else if (p95 < 17.6) {
      this.fastFor += dt;
      this.slowFor = 0;
    } else {
      this.slowFor = 0;
      this.fastFor = 0;
    }
    if (this.cooldown > 0) return false;
    if (this.slowFor > 2 && this.scale > this.min) {
      this.scale = Math.max(this.min, this.scale - 0.1);
      this.cooldown = 3;
      this.slowFor = 0;
      this.blockUp = this.upBlockTime;
      this.upBlockTime = Math.min(120, this.upBlockTime * 1.6);
      return true;
    }
    if (this.fastFor > 10 && this.scale < 1 && this.blockUp <= 0) {
      this.scale = Math.min(1, this.scale + 0.1);
      this.cooldown = 3;
      this.fastFor = 0;
      return true;
    }
    return false;
  }
}

export class PerfOverlay {
  readonly el: HTMLDivElement;
  visible = false;
  private timer = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.style.cssText =
      'position:absolute;left:12px;top:12px;z-index:30;pointer-events:none;display:none;' +
      'font:500 12px/1.45 "JetBrains Mono",ui-monospace,monospace;color:#e9e5d9;' +
      'background:rgba(10,12,13,0.72);padding:8px 10px;border:1px solid #2a3034;border-radius:2px;' +
      'font-variant-numeric:tabular-nums;white-space:pre;';
    parent.appendChild(this.el);
  }

  toggle(force?: boolean): void {
    this.visible = force ?? !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
  }

  update(dt: number, stats: FrameStats, renderer: WebGLRenderer, extra: string): void {
    if (!this.visible) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.25;
    const info = renderer.info;
    const avg = stats.average();
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    this.el.textContent =
      `FPS      ${avg > 0 ? (1000 / avg).toFixed(0) : '0'}\n` +
      `frame    ${avg.toFixed(1)} ms  p95 ${stats.percentile(95).toFixed(1)}  max ${stats.max().toFixed(1)}\n` +
      `cpu      ${stats.average('cpu').toFixed(2)} ms  p95 ${stats.percentile(95, 'cpu').toFixed(2)}\n` +
      `draws    ${info.render.calls}\n` +
      `tris     ${(info.render.triangles / 1000).toFixed(0)}k\n` +
      `geo/tex  ${info.memory.geometries} / ${info.memory.textures}\n` +
      (mem ? `heap     ${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB\n` : '') +
      extra;
  }

  dispose(): void {
    this.el.remove();
  }
}
