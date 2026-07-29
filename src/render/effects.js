/**
 * 戦闘演出（弾・ダメージ数値・衝撃波・光の十字）をまとめて管理する。
 * すべて生成 → 寿命が来たら自動で破棄される。
 */

import * as THREE from "three";
import { worldOf } from "./scene.js";

const textCache = new Map();

/** ダメージ数値などの文字スプライト用テクスチャ */
function textTexture(text, color, { bold = true, size = 44 } = {}) {
  const cacheKey = `${text}|${color}|${size}`;
  if (textCache.has(cacheKey)) return textCache.get(cacheKey);

  const cv = document.createElement("canvas");
  cv.width = 256;
  cv.height = 128;
  const ctx = cv.getContext("2d");
  ctx.font = `${bold ? "800 " : ""}${size}px "Hiragino Kaku Gothic ProN", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.strokeText(text, 128, 64);
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 64);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (textCache.size > 220) {
    // 使い捨てが増えすぎないように古いものを捨てる
    const oldest = textCache.keys().next().value;
    textCache.get(oldest)?.dispose?.();
    textCache.delete(oldest);
  }
  textCache.set(cacheKey, tex);
  return tex;
}

/** 中心が明るい丸のテクスチャ（弾・グロー用） */
let glowTex = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const ctx = cv.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.75)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(cv);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

export class Effects {
  constructor(layer) {
    this.layer = layer;
    this.items = [];
    this.timers = [];

    this.ringGeo = new THREE.RingGeometry(0.42, 0.5, 48);
    this.sphereGeo = new THREE.SphereGeometry(0.075, 12, 10);
  }

  /** dt 秒後にコールバックを実行（ゲーム速度に追従させたいのでここで管理する） */
  after(delay, fn) {
    if (delay <= 0) {
      fn();
      return;
    }
    this.timers.push({ t: delay, fn });
  }

  // ---------------------------------------------------------------- 生成

  /** 遠距離攻撃・魔法の弾 */
  projectile(from, to, color, { duration = 0.18, onArrive } = {}) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
    const core = new THREE.Mesh(this.sphereGeo, mat);

    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(),
        color,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    glow.scale.setScalar(0.6);
    core.add(glow);
    core.position.copy(from);
    this.layer.add(core);

    const arc = Math.max(0.25, from.distanceTo(to) * 0.14);
    this.items.push({
      obj: core,
      t: 0,
      life: duration,
      kind: "projectile",
      from: from.clone(),
      to: to.clone(),
      arc,
      onArrive,
    });
  }

  /** 浮かび上がるダメージ数値 */
  floatingText(pos, text, color, { scale = 0.62, rise = 1.0, life = 0.85 } = {}) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: textTexture(text, color),
        transparent: true,
        depthTest: false,
      }),
    );
    sprite.scale.set(scale * 2, scale, 1);
    sprite.position.copy(pos);
    sprite.position.x += (Math.random() - 0.5) * 0.22;
    sprite.position.z += (Math.random() - 0.5) * 0.22;
    sprite.renderOrder = 20;
    this.layer.add(sprite);

    this.items.push({ obj: sprite, t: 0, life, kind: "text", rise, baseScale: scale });
  }

  /** 地面に広がる衝撃波リング */
  impact(tile, color, radius = 1.2) {
    const p = worldOf(tile, 0.03);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(this.ringGeo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(p);
    ring.scale.setScalar(0.25);
    ring.renderOrder = 4;
    this.layer.add(ring);
    this.items.push({ obj: ring, t: 0, life: 0.5, kind: "ring", radius });

    // 中心の閃光
    const flashSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(),
        color,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    flashSprite.position.copy(p).setY(0.45);
    flashSprite.scale.setScalar(radius * 1.4);
    this.layer.add(flashSprite);
    this.items.push({ obj: flashSprite, t: 0, life: 0.32, kind: "flash" });
  }

  /** ビショップの聖光十字（斜め4方向へ伸びる光の帯） */
  beamCross(centerTile, color) {
    const p = worldOf(centerTile, 0.04);
    const group = new THREE.Group();
    group.position.copy(p);

    const geo = new THREE.PlaneGeometry(0.42, 11);
    for (const rot of [Math.PI / 4, -Math.PI / 4]) {
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const beam = new THREE.Mesh(geo, mat);
      beam.rotation.x = -Math.PI / 2;
      beam.rotation.z = rot;
      group.add(beam);
    }
    group.renderOrder = 4;
    this.layer.add(group);
    this.items.push({ obj: group, t: 0, life: 0.55, kind: "beam" });
    this.impact(centerTile, color, 1.4);
  }

  /** 天から降りる光柱（スキル詠唱の合図） */
  castPillar(pos, color) {
    const geo = new THREE.CylinderGeometry(0.34, 0.5, 3.2, 20, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const cyl = new THREE.Mesh(geo, mat);
    cyl.position.copy(pos).setY(1.6);
    this.layer.add(cyl);
    this.items.push({ obj: cyl, t: 0, life: 0.5, kind: "pillar" });
  }

  // ---------------------------------------------------------------- 更新

  update(dt) {
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const timer = this.timers[i];
      timer.t -= dt;
      if (timer.t <= 0) {
        this.timers.splice(i, 1);
        timer.fn();
      }
    }

    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      const k = Math.min(1, it.t / it.life);

      switch (it.kind) {
        case "projectile": {
          it.obj.position.lerpVectors(it.from, it.to, k);
          it.obj.position.y += Math.sin(k * Math.PI) * it.arc;
          break;
        }
        case "text": {
          it.obj.position.y += it.rise * dt;
          const pop = k < 0.18 ? 1 + (0.18 - k) * 2.2 : 1;
          it.obj.scale.set(it.baseScale * 2 * pop, it.baseScale * pop, 1);
          it.obj.material.opacity = k > 0.55 ? 1 - (k - 0.55) / 0.45 : 1;
          break;
        }
        case "ring": {
          it.obj.scale.setScalar(0.25 + k * it.radius);
          it.obj.material.opacity = 0.9 * (1 - k);
          break;
        }
        case "flash": {
          it.obj.material.opacity = 1 - k;
          it.obj.scale.multiplyScalar(1 + dt * 1.6);
          break;
        }
        case "beam": {
          const s = 0.3 + k * 1.1;
          it.obj.scale.set(s, 1, 1);
          for (const c of it.obj.children) c.material.opacity = 0.85 * (1 - k);
          break;
        }
        case "pillar": {
          it.obj.material.opacity = 0.55 * (1 - k);
          it.obj.scale.set(1 + k * 0.4, 1, 1 + k * 0.4);
          break;
        }
        default:
          break;
      }

      if (k >= 1) {
        if (it.kind === "projectile") it.onArrive?.();
        this._dispose(it.obj);
        this.items.splice(i, 1);
      }
    }
  }

  _dispose(obj) {
    this.layer.remove(obj);
    obj.traverse?.((o) => {
      if (o.isMesh || o.isSprite) {
        if (o.geometry && o.geometry !== this.ringGeo && o.geometry !== this.sphereGeo) {
          o.geometry.dispose();
        }
        o.material?.dispose?.();
      }
    });
  }

  /** ラウンドをまたぐ時の後始末 */
  clear() {
    for (const it of this.items) this._dispose(it.obj);
    this.items.length = 0;
    this.timers.length = 0;
  }
}
