/**
 * 準備フェーズのドラッグ配置 & コマ選択（インスペクタ表示）。
 */

import { PLAYER_ROWS, SIZE } from "../core/board.js";
import { worldOf } from "../render/scene.js";

const DRAG_THRESHOLD = 6; // px。これ未満の移動はクリック扱い

export const DEPLOY_TILES = PLAYER_ROWS.flatMap((r) =>
  Array.from({ length: SIZE }, (_, c) => ({ c, r })),
);

export class PlacementController {
  /**
   * @param {object} stage createStage() の戻り値
   * @param {{onSelect:(view|null)=>void, onPlace:(view, tile)=>void, canPlace:()=>boolean}} handlers
   */
  constructor(stage, { onSelect, onPlace, canPlace }) {
    this.stage = stage;
    this.onSelect = onSelect;
    this.onPlace = onPlace;
    this.canPlace = canPlace;
    this.active = false;

    this.drag = null;
    this.hovered = null;

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
      this.stage.clearHighlights();
      this._setHover(null);
    } else {
      this.showDeployZone();
    }
  }

  showDeployZone() {
    if (!this.active) return;
    this.stage.highlight(DEPLOY_TILES, 0x5ad2ff, 0.22);
  }

  _setHover(view) {
    if (this.hovered === view) return;
    this.hovered?.setHovered(false);
    this.hovered = view;
    view?.setHovered(true);
    const el = this.stage.renderer.domElement;
    el.style.cursor = view && this.active && view.unit.team === "player" ? "grab" : "";
  }

  _down(e) {
    if (e.button !== 0) return;
    const view = this.stage.pickUnit(e.clientX, e.clientY);
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
      this._setHover(this.active ? this.stage.pickUnit(e.clientX, e.clientY) : null);
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
        this.onPlace(view, tile);
      } else {
        view.snapTo(origin);
      }
      this.showDeployZone();
      if (!start?.moved) this.onSelect(view);
      return;
    }

    if (!start || start.moved) return;

    // クリック（ドラッグしていない）→ 選択
    const view = this.stage.pickUnit(e.clientX, e.clientY);
    this.onSelect(view);
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

export function isDeployTile(tile) {
  return PLAYER_ROWS.includes(tile.r);
}
