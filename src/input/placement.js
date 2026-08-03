/**
 * 準備フェーズのドラッグ配置 & コマ選択（インスペクタ表示）。
 */

import { BENCH_TILES, PLAYER_ROWS, SIZE, isBenchTile } from "../core/board.js";
import { worldOf } from "../render/scene.js";

const DRAG_THRESHOLD = 6; // px。これ未満の移動はクリック扱い

/** 盤上の配置可能マス（自陣3列） */
export const DEPLOY_TILES = PLAYER_ROWS.flatMap((r) =>
  Array.from({ length: SIZE }, (_, c) => ({ c, r })),
);

export class PlacementController {
  /**
   * @param {object} stage createStage() の戻り値
   * @param {{onSelect:(view|null)=>void, onPlace:(view, tile)=>void, canPlace:()=>boolean}} handlers
   */
  constructor(stage, { onSelect, onPlace, canPlace, onPickedChange = () => {} }) {
    this.stage = stage;
    this.onSelect = onSelect;
    this.onPlace = onPlace;
    this.canPlace = canPlace;
    this.onPickedChange = onPickedChange;
    this.active = false;

    this.drag = null;
    this.hovered = null;
    /**
     * タップで選んだコマ。もう一度どこかを叩くとそこへ移す。
     * ドラッグが苦手な環境（特にスマホ）向けの、もうひとつの配置手段。
     * @type {object|null}
     */
    this.picked = null;

    const el = stage.renderer.domElement;
    el.addEventListener("pointerdown", (e) => this._down(e));
    el.addEventListener("pointermove", (e) => this._move(e));
    el.addEventListener("pointerup", (e) => this._up(e));
    el.addEventListener("pointercancel", () => this._cancel());
    el.addEventListener("pointerleave", () => this._setHover(null));
  }

  setActive(on) {
    this.active = on;
    if (!on) {
      this._cancel();
      this.setPicked(null);
      this.stage.clearHighlights();
      this._setHover(null);
    } else {
      this.showDeployZone();
    }
  }

  /** タップで選んだコマを切り替える。選んでいる間は少し浮かせる */
  setPicked(view) {
    if (this.picked === view) return;
    if (this.picked) this.picked.lift = 0;
    this.picked = view;
    if (view) view.lift = 0.3;
    this.showDeployZone();
    this.onPickedChange(view ?? null);
  }

  showDeployZone() {
    if (!this.active) return;
    this.stage.highlightGroups([
      { tiles: DEPLOY_TILES, color: 0x5ad2ff, opacity: 0.22 },
      { tiles: BENCH_TILES, color: 0xf5c451, opacity: 0.16 },
    ]);
    // 選んでいるコマの足元を強く光らせて、行き先待ちだと分かるようにする
    if (this.picked?.unit.tile) {
      this.stage.highlightOne(this.picked.unit.tile, 0x8affc0, 0.55);
    }
  }

  _setHover(view) {
    if (this.hovered === view) return;
    this.hovered?.setHovered(false);
    this.hovered = view;
    view?.setHovered(true);
    const el = this.stage.renderer.domElement;
    // 相手のコマも詳細を出せるので、掴めなくてもクリックできると分かるように
    el.style.cursor = !view
      ? ""
      : this.active && view.unit.team === "player"
        ? "grab"
        : "pointer";
  }

  _down(e) {
    if (e.button !== 0) return;
    const view = this.stage.pickUnitLoose(e.clientX, e.clientY);
    this.pointerStart = { x: e.clientX, y: e.clientY, view, moved: false };

    if (!this.active || !view || view.unit.team !== "player" || !this.canPlace()) return;

    this.drag = { view, origin: { ...view.unit.tile }, tile: { ...view.unit.tile } };
    view.lift = 0.42;
    this.stage.controls.enabled = false;
    this.stage.renderer.domElement.style.cursor = "grabbing";
    this.stage.renderer.domElement.setPointerCapture?.(e.pointerId);
  }

  _move(e) {
    if (this.pointerStart) {
      const dx = e.clientX - this.pointerStart.x;
      const dy = e.clientY - this.pointerStart.y;
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD) this.pointerStart.moved = true;
    }

    if (!this.drag) {
      this._setHover(this.active ? this.stage.pickUnitLoose(e.clientX, e.clientY) : null);
      return;
    }

    const tile = this.stage.pickTile(e.clientX, e.clientY);
    const valid = tile && isDeployTile(tile);

    // ドラッグ中のコマを持ち上げてカーソルに追従させる
    const target = valid ? tile : this.drag.origin;
    const p = worldOf(target);
    this.drag.view.basePos.set(p.x, 0, p.z);
    this.drag.tile = valid ? tile : null;

    this.showDeployZone();
    if (valid) this.stage.highlightOne(tile, 0x8affc0, 0.5);
  }

  _up(e) {
    const start = this.pointerStart;
    this.pointerStart = null;

    if (this.drag) {
      const { view, origin, tile } = this.drag;
      view.lift = 0;
      this.drag = null;
      this.stage.controls.enabled = true;
      this.stage.renderer.domElement.style.cursor = "grab";

      if (tile && (tile.c !== origin.c || tile.r !== origin.r)) {
        this.setPicked(null);
        this.onPlace(view, tile);
      } else {
        view.snapTo(origin);
      }
      // 掴んで離しただけならタップ扱い。選んだ状態にして行き先を待つ
      if (!start?.moved) {
        this._tap(e, view);
      } else {
        this.showDeployZone();
      }
      return;
    }

    if (!start || start.moved) return;
    this._tap(e, this.stage.pickUnitLoose(e.clientX, e.clientY));
  }

  /**
   * タップ1回ぶんの処理。
   *
   * 何も選んでいなければ「選ぶ」、自分のコマを選んでいる状態なら
   * 叩いたマスへ「動かす」。ドラッグせずに配置できるようにするため。
   */
  _tap(e, view) {
    const movable =
      this.active && this.canPlace() && view?.unit.team === "player" ? view : null;

    // 行き先待ちのコマがある
    if (this.picked && this.picked !== view) {
      const tile = view?.unit.tile ?? this.stage.pickTile(e.clientX, e.clientY);
      if (tile && isDeployTile(tile)) {
        const from = this.picked;
        this.setPicked(null);
        this.onPlace(from, tile);
        this.onSelect(from);
        return;
      }
      // 置けないところを叩いたら選択を解除するだけ
      this.setPicked(null);
      this.onSelect(view ?? null);
      return;
    }

    // 同じコマをもう一度叩いたら選択解除
    if (this.picked && this.picked === view) {
      this.setPicked(null);
      this.onSelect(view);
      return;
    }

    this.setPicked(movable);
    this.onSelect(view ?? null);
  }

  /** 配置が済んだあと、選択の浮きが残らないようにする */
  clearPicked() {
    this.setPicked(null);
  }

  _cancel() {
    if (!this.drag) return;
    this.drag.view.lift = 0;
    this.drag.view.snapTo(this.drag.origin);
    this.drag = null;
    this.stage.controls.enabled = true;
    this.stage.renderer.domElement.style.cursor = "";
  }
}

/** ドラッグで落とせるマス（自陣3列＋控え列） */
export function isDeployTile(tile) {
  return !!tile && (PLAYER_ROWS.includes(tile.r) || isBenchTile(tile));
}
