/**
 * 1ユニットぶんの見た目。3Dモデル・足元リング・HP/マナバーと、その演出を持つ。
 */

import * as THREE from "three";
import { createPieceModel, PIECE_HEIGHT } from "./pieces.js";
import { worldOf, COLORS } from "./scene.js";

const BAR_W = 160;
const BAR_H = 52;

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function teamMaterials(team) {
  if (team === "player") {
    return {
      body: new THREE.MeshStandardMaterial({
        color: 0xf2eee4,
        roughness: 0.34,
        metalness: 0.22,
        emissive: new THREE.Color(0x0d2436),
        emissiveIntensity: 1,
      }),
      accent: new THREE.MeshStandardMaterial({
        color: 0x7fdcff,
        roughness: 0.2,
        metalness: 0.65,
        emissive: new THREE.Color(0x1c5f80),
      }),
    };
  }
  return {
    body: new THREE.MeshStandardMaterial({
      color: 0x272b3c,
      roughness: 0.38,
      metalness: 0.42,
      emissive: new THREE.Color(0x2a0d12),
      emissiveIntensity: 1,
    }),
    accent: new THREE.MeshStandardMaterial({
      color: 0xff9a9a,
      roughness: 0.22,
      metalness: 0.6,
      emissive: new THREE.Color(0x6b1e1e),
    }),
  };
}

export class UnitView {
  /**
   * @param {object} unit battle.js のユニット実体
   * @param {THREE.Group} layer
   */
  constructor(unit, layer) {
    this.unit = unit;
    this.layer = layer;
    this.dead = false;
    this.removed = false;

    this.group = new THREE.Group();
    this.group.userData.unitRoot = this;
    /** 盤上の論理位置（演出オフセットを足す前の座標） */
    this.basePos = worldOf(unit.tile);
    this.group.position.copy(this.basePos);

    this.materials = teamMaterials(unit.team);
    this.model = createPieceModel(unit.typeId, this.materials);
    // 相手陣を向かせる
    this.model.rotation.y = unit.team === "player" ? 0 : Math.PI;
    this.group.add(this.model);

    this.teamColor = new THREE.Color(
      unit.team === "player" ? COLORS.player : COLORS.enemy,
    );

    // 足元リング
    const ringMat = new THREE.MeshBasicMaterial({
      color: this.teamColor,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.31, 0.42, 40), ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.02;
    this.ring.renderOrder = 3;
    this.group.add(this.ring);

    // ステータスバー
    this._initBar();

    layer.add(this.group);

    // アニメーション状態
    this.anim = { move: null, lunge: null, flash: 0, death: null, spawn: 0 };
    this.baseY = 0;
    /** ドラッグ中の持ち上げ量 */
    this.lift = 0;
    this._lastBarKey = "";
    this.selected = false;
    this.hovered = false;

    // 登場演出
    this.group.scale.setScalar(0.01);
    this.anim.spawn = 0.001;
  }

  // ------------------------------------------------------------------ バー

  _initBar() {
    const cv = document.createElement("canvas");
    cv.width = BAR_W;
    cv.height = BAR_H;
    this.barCanvas = cv;
    this.barCtx = cv.getContext("2d");

    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    this.barTexture = tex;

    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
    );
    sprite.scale.set(0.96, 0.312, 1);
    sprite.position.y = (PIECE_HEIGHT[this.unit.typeId] ?? 1) + 0.34;
    sprite.renderOrder = 10;
    this.barSprite = sprite;
    this.group.add(sprite);

    this.drawBar();
  }

  drawBar() {
    const u = this.unit;
    const hpR = Math.max(0, u.hp / u.maxHp);
    const shR = Math.min(1, u.shield / u.maxHp);
    const mpR = u.manaMax > 0 ? Math.min(1, u.mana / u.manaMax) : 0;

    // 変化がなければ描き直さない
    const k = `${hpR.toFixed(3)}|${shR.toFixed(3)}|${mpR.toFixed(3)}|${u.star}`;
    if (k === this._lastBarKey) return;
    this._lastBarKey = k;

    const ctx = this.barCtx;
    ctx.clearRect(0, 0, BAR_W, BAR_H);

    const ally = u.team === "player";
    const pad = 6;
    const w = BAR_W - pad * 2;

    // ★
    ctx.font = "bold 13px system-ui, sans-serif";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#f5c451";
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = 3;
    ctx.fillText("★".repeat(u.star), pad, 0);
    ctx.shadowBlur = 0;

    // HP バー
    const hpY = 17;
    const hpH = 13;
    roundRect(ctx, pad - 1, hpY - 1, w + 2, hpH + 2, 4);
    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.fill();

    roundRect(ctx, pad, hpY, w * hpR, hpH, 3);
    const grd = ctx.createLinearGradient(0, hpY, 0, hpY + hpH);
    if (ally) {
      grd.addColorStop(0, "#7ef2a8");
      grd.addColorStop(1, "#22c55e");
    } else {
      grd.addColorStop(0, "#ff9f9f");
      grd.addColorStop(1, "#e0393f");
    }
    ctx.fillStyle = grd;
    ctx.fill();

    // シールド（HPバーの上に白帯で重ねる）
    if (shR > 0.001) {
      roundRect(ctx, pad + w * hpR, hpY, Math.min(w * shR, w - w * hpR), hpH, 3);
      ctx.fillStyle = "rgba(226,240,255,0.92)";
      ctx.fill();
    }

    // マナバー
    const mpY = hpY + hpH + 3;
    const mpH = 6;
    roundRect(ctx, pad - 1, mpY - 1, w + 2, mpH + 2, 3);
    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.fill();
    roundRect(ctx, pad, mpY, w * mpR, mpH, 2);
    ctx.fillStyle = mpR >= 1 ? "#ffe27a" : "#4aa8ff";
    ctx.fill();

    this.barTexture.needsUpdate = true;
  }

  // ------------------------------------------------------------------ 演出

  /** 盤上の移動 */
  moveTo(from, to, { arc = 0.18, duration = 0.28 } = {}) {
    const a = worldOf(from);
    const b = worldOf(to);
    this.anim.move = { a, b, t: 0, duration, arc };
    this.faceTowards(b.clone().sub(a));
  }

  /** 補間なしで即座にマスへ置く（配置フェーズ用） */
  snapTo(tile) {
    this.anim.move = null;
    this.baseY = 0;
    this.basePos.copy(worldOf(tile));
    this.group.position.copy(this.basePos);
  }

  /** 指定方向を向く（+Z 基準） */
  faceTowards(dir) {
    if (dir.lengthSq() < 1e-5) return;
    this.targetYaw = Math.atan2(dir.x, dir.z);
  }

  faceTile(tile) {
    const d = worldOf(tile).sub(this.group.position);
    d.y = 0;
    this.faceTowards(d);
  }

  /** 攻撃の踏み込み */
  lunge(towardTile) {
    const dir = worldOf(towardTile).sub(this.group.position);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) return;
    dir.normalize();
    this.faceTowards(dir);
    this.anim.lunge = { dir, t: 0, duration: 0.26 };
  }

  /** 被弾フラッシュ */
  flash(strength = 1) {
    this.anim.flash = Math.max(this.anim.flash, 0.24 * strength);
  }

  /** スキル発動などの発光パルス */
  pulse(color = 0xffd76a) {
    this.pulseColor = new THREE.Color(color);
    this.anim.flash = 0.5;
  }

  setSelected(on) {
    this.selected = on;
  }

  setHovered(on) {
    this.hovered = on;
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.anim.death = { t: 0, duration: 1.0, tilt: (Math.random() - 0.5) * 0.6 };
    this.barSprite.visible = false;
  }

  dispose() {
    this.layer.remove(this.group);
    this.group.traverse((o) => {
      if (o.isMesh || o.isSprite) {
        // コマ種で共有しているジオメトリは残す
        if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
        o.material?.dispose?.();
      }
    });
    this.barTexture.dispose();
    this.removed = true;
  }

  // ------------------------------------------------------------------ 更新

  update(dt, elapsed) {
    const a = this.anim;

    // 登場
    if (a.spawn !== null && a.spawn < 1 && !this.dead) {
      a.spawn = Math.min(1, a.spawn + dt / 0.35);
      const s = easeOutCubic(a.spawn);
      this.group.scale.setScalar(s * (1 + 0.12 * (1 - s)));
      if (a.spawn >= 1) {
        a.spawn = null;
        this.group.scale.setScalar(1);
      }
    }

    // 死亡
    if (a.death) {
      a.death.t += dt;
      const t = Math.min(1, a.death.t / a.death.duration);
      this.model.rotation.z = a.death.tilt + easeOutCubic(t) * (Math.PI / 2) * (a.death.tilt >= 0 ? 1 : -1);
      this.group.position.y = -0.12 * t;
      const fade = 1 - easeOutCubic(Math.max(0, (t - 0.45) / 0.55));
      this.ring.material.opacity = 0.55 * fade;
      this.model.traverse((o) => {
        if (o.isMesh) {
          o.material.transparent = true;
          o.material.opacity = fade;
        }
      });
      if (t >= 1 && !this.removed) this.dispose();
      return;
    }

    // 移動（論理位置 basePos を更新する）
    if (a.move) {
      a.move.t += dt;
      const t = Math.min(1, a.move.t / a.move.duration);
      this.basePos.lerpVectors(a.move.a, a.move.b, easeInOutQuad(t));
      this.baseY = Math.sin(t * Math.PI) * a.move.arc;
      if (t >= 1) {
        a.move = null;
        this.baseY = 0;
      }
    }

    // 踏み込み（論理位置からのオフセットとして毎フレーム計算し直す）
    let lungeOffset = 0;
    if (a.lunge) {
      a.lunge.t += dt;
      const t = Math.min(1, a.lunge.t / a.lunge.duration);
      // 前半で素早く出て、後半でゆっくり戻る
      lungeOffset =
        t < 0.35 ? easeOutCubic(t / 0.35) * 0.26 : (1 - (t - 0.35) / 0.65) * 0.26;
      if (t >= 1) a.lunge = null;
    }

    const pos = this.group.position.copy(this.basePos);
    pos.y += this.baseY + this.lift + Math.sin(elapsed * 1.6 + this.unit.uid) * 0.012;
    if (a.lunge) {
      pos.x += a.lunge.dir.x * lungeOffset;
      pos.z += a.lunge.dir.z * lungeOffset;
    }

    // 向き
    if (this.targetYaw !== undefined) {
      const cur = this.model.rotation.y;
      let diff = this.targetYaw - cur;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.model.rotation.y = cur + diff * Math.min(1, dt * 9);
    }

    // フラッシュ
    const flashColor = this.pulseColor ?? new THREE.Color(0xffffff);
    if (a.flash > 0) {
      a.flash = Math.max(0, a.flash - dt);
      const k = a.flash / 0.24;
      this.materials.body.emissive.copy(flashColor).multiplyScalar(Math.min(1, k) * 0.85);
      if (a.flash === 0) {
        this.pulseColor = null;
        this.materials.body.emissive.setHex(
          this.unit.team === "player" ? 0x0d2436 : 0x2a0d12,
        );
      }
    }

    // リング（選択・ホバー・マナ満タンで強調）
    const manaFull = this.unit.mana >= this.unit.manaMax;
    let ringOpacity = 0.45;
    if (manaFull) ringOpacity = 0.55 + Math.sin(elapsed * 8) * 0.35;
    if (this.hovered) ringOpacity = Math.max(ringOpacity, 0.8);
    if (this.selected) ringOpacity = 0.7 + Math.sin(elapsed * 6) * 0.3;
    this.ring.material.opacity = ringOpacity;
    this.ring.material.color.copy(manaFull ? new THREE.Color(0xffe27a) : this.teamColor);
    const ringScale = this.selected ? 1.12 + Math.sin(elapsed * 6) * 0.05 : 1;
    this.ring.scale.setScalar(ringScale);

    this.drawBar();
  }

  /** 現在のワールド座標（エフェクトの発射位置に使う） */
  worldPos(height = 0.5) {
    return new THREE.Vector3(
      this.group.position.x,
      this.group.position.y + height,
      this.group.position.z,
    );
  }

  get muzzleHeight() {
    return (PIECE_HEIGHT[this.unit.typeId] ?? 1) * 0.72;
  }
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, h / 2, Math.max(0, w) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
