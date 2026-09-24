import { Color, Mesh, MeshStandardMaterial, TorusGeometry, Vector3 } from 'three';
import { fmtTime } from '../core/math';
import { Rng } from '../core/rng';
import type { FreeFlightOptions } from '../core/types';
import { AIRCRAFT } from '../data/aircraft';
import { patchAtmosphere } from '../render/atmosphere';
import { ScoreBox, type HudObjective, type ModeResult, type ModeRules, type Session } from './session';

/**
 * Free Flight (spec §5.1): any map and jet, no enemies. Optional ring course (timed) and slow target drones.
 * Crashing simply respawns the player.
 */
const RING_RADIUS = 45;
const _prev = new Vector3();
const _n = new Vector3();
const _d = new Vector3();

export class RingCourse {
  readonly rings: { center: Vector3; normal: Vector3; mesh: Mesh }[] = [];
  next = 0;
  startTime = -1;
  finishTime = -1;
  private readonly material: MeshStandardMaterial;
  private readonly dimMaterial: MeshStandardMaterial;
  private readonly geometry = new TorusGeometry(RING_RADIUS, 2.2, 10, 64);

  constructor(s: Session, start: Vector3, heading: number, count: number, seed: number) {
    this.material = patchAtmosphere(
      new MeshStandardMaterial({ color: 0x1a0d05, emissive: new Color(2.4, 0.9, 0.25), roughness: 0.6 }),
      'ring-hot',
    );
    this.dimMaterial = patchAtmosphere(
      new MeshStandardMaterial({ color: 0x14100c, emissive: new Color(0.35, 0.18, 0.08), roughness: 0.7 }),
      'ring-dim',
    );
    const r = new Rng(seed);
    const pos = start.clone();
    let hdg = heading;
    const w = s.world;
    for (let i = 0; i < count; i++) {
      hdg += r.range(-0.55, 0.55);
      const step = r.range(1600, 2300);
      pos.x += Math.sin(hdg) * step;
      pos.z -= Math.cos(hdg) * step;
      // Keep the course inside the combat area.
      const lim = w.boundary * 0.75;
      if (Math.abs(pos.x) > lim || Math.abs(pos.z) > lim) {
        hdg = Math.atan2(-pos.x, pos.z) + r.range(-0.3, 0.3);
        pos.x = Math.max(-lim, Math.min(lim, pos.x));
        pos.z = Math.max(-lim, Math.min(lim, pos.z));
      }
      const ground = w.surfaceAt(pos.x, pos.z);
      pos.y = Math.max(ground + r.range(260, 520), Math.min(pos.y + r.range(-250, 250), ground + 1400));
      const normal = new Vector3(Math.sin(hdg), 0, -Math.cos(hdg));
      const mesh = new Mesh(this.geometry, i === 0 ? this.material : this.dimMaterial);
      mesh.position.copy(pos);
      mesh.lookAt(pos.clone().add(normal));
      s.scene.add(mesh);
      this.rings.push({ center: pos.clone(), normal, mesh });
    }
  }

  /** Checks whether the player's last movement passed through the next ring. */
  update(s: Session): void {
    const p = s.player;
    if (!p?.alive || this.next >= this.rings.length) return;
    const ring = this.rings[this.next]!;
    _prev.copy(p.body.position).addScaledVector(p.body.velocity, -1 / 60);
    const a = _d.subVectors(_prev, ring.center).dot(ring.normal);
    const b = _n.subVectors(p.body.position, ring.center).dot(ring.normal);
    if (a < 0 && b >= 0) {
      const t = a / (a - b);
      _d.copy(_prev).lerp(p.body.position, t);
      if (_d.distanceTo(ring.center) <= RING_RADIUS) {
        if (this.startTime < 0) this.startTime = s.time;
        ring.mesh.visible = false;
        this.next++;
        s.services.audio.play('checkpoint');
        const nextRing = this.rings[this.next];
        if (nextRing) nextRing.mesh.material = this.material;
        else {
          this.finishTime = s.time;
          s.showMessage('COURSE COMPLETE', fmtTime(this.finishTime - this.startTime), 3.5);
          s.services.audio.play('medal');
        }
      }
    }
  }

  dispose(): void {
    for (const r of this.rings) r.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.dimMaterial.dispose();
  }
}

export class FreeFlightRules implements ModeRules {
  readonly title = 'FREE FLIGHT';
  readonly subtitle: string;
  private course: RingCourse | null = null;
  private drones = 0;
  private dronesDown = 0;
  private readonly options: FreeFlightOptions;
  private spawnIndex = 0;

  constructor(options: FreeFlightOptions, mapName: string) {
    this.options = options;
    this.subtitle = mapName;
  }

  start(s: Session): void {
    this.spawnPlayer(s, this.options.start === 'runway');
    const p = s.player;
    if (this.options.rings) {
      this.course = new RingCourse(s, p.body.position.clone(), p.body.heading, 12, 7);
    }
    if (this.options.drones) {
      const spawns = s.world.airSpawns.red;
      for (let i = 0; i < 3; i++) {
        const sp = spawns[i % spawns.length]!;
        const pos = sp.position.clone();
        pos.y = Math.max(pos.y, s.world.surfaceAt(pos.x, pos.z) + 900);
        s.spawn({
          def: AIRCRAFT.kestrel,
          team: 'red',
          label: `DRONE ${i + 1}`,
          rule: 'guns',
          position: pos,
          heading: sp.heading,
          speed: 170,
          drone: true,
          livery: 2,
        });
        this.drones++;
      }
    }
  }

  private spawnPlayer(s: Session, runway: boolean): void {
    const w = s.world;
    const rw = w.runways[0];
    if (runway && rw) {
      const back = rw.length * 0.42;
      const pos = new Vector3(
        rw.center.x - Math.sin(rw.heading) * back,
        rw.center.y,
        rw.center.z + Math.cos(rw.heading) * back,
      );
      s.spawn({
        def: AIRCRAFT[this.options.aircraft],
        team: 'blue',
        label: 'VIPER 1',
        isPlayer: true,
        rule: 'standard',
        position: pos,
        heading: rw.heading,
        speed: 0,
        onGround: true,
      });
      return;
    }
    const spawns = w.airSpawns.blue;
    const sp = spawns[this.spawnIndex++ % spawns.length]!;
    const pos = sp.position.clone();
    pos.y = Math.max(pos.y * 0.6, w.surfaceAt(pos.x, pos.z) + 700);
    s.spawn({
      def: AIRCRAFT[this.options.aircraft],
      team: 'blue',
      label: 'VIPER 1',
      isPlayer: true,
      rule: 'standard',
      position: pos,
      heading: sp.heading,
      speed: 210,
    });
  }

  frame(s: Session): void {
    this.course?.update(s);
  }

  onKill(s: Session, e: { victim: { team: string } }): void {
    if (e.victim.team === 'red') {
      this.dronesDown++;
      if (this.dronesDown === this.drones) s.showMessage('ALL DRONES DOWN', '', 3);
    }
  }

  onPlayerDown(s: Session): boolean {
    const old = s.player;
    this.spawnPlayer(s, false);
    s.despawn(old);
    return true;
  }

  objectives(): readonly HudObjective[] {
    const out: HudObjective[] = [];
    if (this.course) {
      const done = this.course.next >= this.course.rings.length;
      out.push({ text: `Ring course  ${this.course.next}/${this.course.rings.length}`, done, failed: false });
    }
    if (this.drones > 0)
      out.push({
        text: `Target drones  ${this.dronesDown}/${this.drones}`,
        done: this.dronesDown >= this.drones,
        failed: false,
      });
    return out;
  }

  private readonly scoreBox = new ScoreBox();
  private courseLabel = '';
  private courseLabelNext = -1;

  score(s: Session): { left: string; right: string; timer: string } | null {
    const c = this.course;
    if (!c || c.startTime < 0) return null;
    if (c.next !== this.courseLabelNext) {
      this.courseLabelNext = c.next;
      this.courseLabel = `${c.next}/${c.rings.length}`;
    }
    const end = c.finishTime >= 0 ? c.finishTime : s.time;
    return this.scoreBox.set('COURSE', this.courseLabel, end - c.startTime);
  }

  result(): ModeResult | null {
    return null;
  }

  checkpoints(): readonly Vector3[] {
    const c = this.course;
    if (!c || c.next >= c.rings.length) return [];
    return [c.rings[c.next]!.center];
  }

  dispose(): void {
    this.course?.dispose();
  }
}
