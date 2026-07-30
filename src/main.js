/**
 * エントリポイント。
 * ゲーム進行（Game）・戦闘（BattleEngine）・描画（Stage/UnitView/Effects）・UI（Hud）を繋ぐ。
 */

import * as THREE from "three";
import { createStage, worldOf, COLORS } from "./render/scene.js";
import { UnitView } from "./render/unitView.js";
import { Effects } from "./render/effects.js";
import { BattleEngine, createUnit } from "./core/battle.js";
import { Game, Phase } from "./core/game.js";
import { DamageType, UNIT_TYPES } from "./core/units.js";
import { PlacementController, isDeployTile } from "./input/placement.js";
import { Hud } from "./ui/hud.js";

const SPEEDS = [1, 1.5, 2, 3];

const DAMAGE_COLOR = {
  [DamageType.PHYSICAL]: "#ffd08a",
  [DamageType.MAGIC]: "#d9a8ff",
  [DamageType.TRUE]: "#ffffff",
};
const PROJECTILE_COLOR = {
  [DamageType.PHYSICAL]: 0xffd08a,
  [DamageType.MAGIC]: 0xc79bff,
  [DamageType.TRUE]: 0xffffff,
};

const stage = createStage(document.getElementById("stage"));
const effects = new Effects(stage.fxLayer);
const game = new Game();

/** @type {Map<number, UnitView>} */
const views = new Map();
/** @type {BattleEngine|null} */
let engine = null;
let wave = null;
let phase = Phase.SELECT;
let speedIndex = 0;
let elapsed = 0;
let selectedUid = null;
let inspectorTimer = 0;
let busy = false; // オーバーレイ表示中などの入力ロック

// ------------------------------------------------------------------ UI 初期化

const hud = new Hud({
  onStart: () => beginBattle(),
  onSpeedToggle: () => cycleSpeed(),
  onHelp: () => hud.showHelp(),
});

const placement = new PlacementController(stage, {
  canPlace: () => phase === Phase.PREP,
  onSelect: (view) => selectUnit(view),
  onPlace: (view, tile) => placeUnit(view, tile),
});

window.addEventListener("keydown", (e) => {
  if (e.code !== "Space") return;
  e.preventDefault();
  if (busy) return;
  if (phase === Phase.PREP) beginBattle();
  else if (phase === Phase.BATTLE) cycleSpeed();
});

function cycleSpeed() {
  speedIndex = (speedIndex + 1) % SPEEDS.length;
  hud.setSpeedLabel(SPEEDS[speedIndex]);
}

function selectUnit(view) {
  selectedUid = view?.unit.uid ?? null;
  for (const v of views.values()) v.setSelected(v.unit.uid === selectedUid);
  hud.showInspector(view?.unit ?? null);
}

// ------------------------------------------------------------- ラウンド構築

function clearBoard() {
  for (const v of views.values()) v.dispose();
  views.clear();
  effects.clear();
  selectedUid = null;
  hud.showInspector(null);
}

/** 編成と敵ウェーブから、盤上のユニットとその見た目を作る */
function setupRound() {
  clearBoard();
  wave = game.buildEnemyWave();

  const playerUnits = game.squad.map((s) =>
    createUnit({ typeId: s.typeId, team: "player", tile: s.tile, star: s.star }),
  );
  const enemyUnits = wave.units.map((u) =>
    createUnit({
      typeId: u.typeId,
      team: "enemy",
      tile: u.tile,
      star: u.star,
      power: wave.power,
    }),
  );

  engine = new BattleEngine({
    units: [...playerUnits, ...enemyUnits],
    onEvent: handleEvent,
  });

  for (const u of engine.units) {
    const view = new UnitView(u, stage.unitLayer);
    views.set(u.uid, view);
  }

  // 味方のビューと編成データを対応づけておく（配置の保存に使う）
  playerUnits.forEach((u, i) => {
    views.get(u.uid).squadEntry = game.squad[i];
  });
}

function enterPrep() {
  phase = Phase.PREP;
  game.phase = Phase.PREP;
  setupRound();
  hud.setPhase(phase);
  hud.setStats(game);
  hud.clearLog();
  hud.setActionBar({
    visible: true,
    label: "バトル開始",
    hint: `次の相手は <b style="color:#ff6b6b">${wave.name}</b>（★${wave.star}）— コマをドラッグして手前3列に配置しよう`,
  });
  placement.setActive(true);
  hud.announce(`ラウンド ${game.round}`, "info");
}

/** ドラッグで配置。味方が居るマスなら入れ替える */
function placeUnit(view, tile) {
  if (!isDeployTile(tile)) {
    view.snapTo(view.unit.tile);
    return;
  }
  const occupant = [...views.values()].find(
    (v) => v !== view && v.unit.alive && v.unit.tile.c === tile.c && v.unit.tile.r === tile.r,
  );

  if (occupant) {
    if (occupant.unit.team !== "player") {
      view.snapTo(view.unit.tile);
      return;
    }
    const from = { ...view.unit.tile };
    occupant.unit.tile = from;
    occupant.snapTo(from);
    if (occupant.squadEntry) occupant.squadEntry.tile = { ...from };
  }

  view.unit.tile = { c: tile.c, r: tile.r };
  view.snapTo(tile);
  if (view.squadEntry) view.squadEntry.tile = { c: tile.c, r: tile.r };
}

function beginBattle() {
  if (phase !== Phase.PREP || busy) return;
  phase = Phase.BATTLE;
  game.phase = Phase.BATTLE;
  placement.setActive(false);
  stage.clearHighlights();
  hud.setPhase(phase);
  hud.setActionBar({ visible: false });
  hud.log(`<em>ラウンド ${game.round}</em> — 対 <b class="enemy">${wave.name}</b>`);
  hud.announce("BATTLE!", "danger");

  for (const v of views.values()) {
    const enemies = engine.units.filter((u) => u.alive && u.team !== v.unit.team);
    if (enemies.length) v.faceTile(enemies[0].tile);
  }
}

// ------------------------------------------------------------- 戦闘イベント

function viewOf(unit) {
  return views.get(unit.uid) ?? null;
}

function headPos(unit, extra = 0.25) {
  const v = viewOf(unit);
  if (v) return v.worldPos(v.muzzleHeight + extra);
  return worldOf(unit.tile, 1);
}

function handleEvent(type, p) {
  switch (type) {
    case "move": {
      const v = viewOf(p.unit);
      if (!v) break;
      // 跳躍系の移動パターンは大きく弧を描く
      const isLeap = p.unit.def.move.kind === "jump";
      v.moveTo(p.from, p.to, {
        arc: isLeap ? 0.55 : 0.16,
        duration: Math.min(0.34, p.unit.moveInterval * 0.6),
      });
      break;
    }

    case "leap": {
      const v = viewOf(p.unit);
      v?.moveTo(p.from, p.to, {
        arc: p.high ? 1.8 : 1.1,
        duration: p.high ? 0.46 : 0.34,
      });
      break;
    }

    case "attack": {
      const v = viewOf(p.unit);
      if (!v) break;
      v.faceTile(p.target.tile);
      if (p.ranged) {
        effects.projectile(
          v.worldPos(v.muzzleHeight),
          headPos(p.target, 0),
          PROJECTILE_COLOR[p.damageType],
          { duration: 0.16 },
        );
        v.lunge(p.target.tile);
      } else {
        v.lunge(p.target.tile);
      }
      break;
    }

    case "damage": {
      const { unit, amount, type, delay } = p;
      effects.after(delay ?? 0, () => {
        const v = viewOf(unit);
        v?.flash(type === DamageType.MAGIC ? 1.2 : 1);
        effects.floatingText(headPos(unit, 0.34), String(amount), DAMAGE_COLOR[type] ?? "#fff", {
          scale: amount > 200 ? 0.78 : 0.6,
        });
      });
      break;
    }

    case "heal": {
      effects.floatingText(headPos(p.unit, 0.34), `+${p.amount}`, "#7ef2a8", { scale: 0.55 });
      break;
    }

    case "shield": {
      effects.floatingText(headPos(p.unit, 0.34), `+${p.amount}`, "#dbeafe", { scale: 0.55 });
      break;
    }

    case "death": {
      const v = viewOf(p.unit);
      if (v) {
        v.die();
        effects.impact(p.unit.tile, p.unit.team === "player" ? COLORS.player : COLORS.enemy, 0.9);
        if (v.unit.uid === selectedUid) {
          selectedUid = null;
          hud.showInspector(null);
        }
      }
      break;
    }

    case "skill": {
      const v = viewOf(p.unit);
      if (v) {
        v.pulse(0xffe27a);
        effects.castPillar(v.worldPos(0), 0xffe27a);
        effects.floatingText(headPos(p.unit, 0.6), p.name, "#ffe27a", {
          scale: 0.5,
          rise: 0.6,
          life: 1.1,
        });
      }
      break;
    }

    case "impact":
      effects.impact(p.tile, p.color, p.radius);
      break;

    case "beamCross":
      effects.beamCross(p.center, p.color);
      break;

    case "buffPulse": {
      const v = viewOf(p.unit);
      v?.pulse(p.color);
      break;
    }

    // 召喚でユニットが増えた
    case "spawn": {
      const view = new UnitView(p.unit, stage.unitLayer);
      views.set(p.unit.uid, view);
      effects.impact(p.unit.tile, 0xb98aff, 1.4);
      hud.log(`${p.owner.team === "player" ? '<b class="ally">' : '<b class="enemy">'}${p.owner.def.name}</b> が <em>${p.unit.def.name}</em> を召喚`);
      break;
    }

    // 行動不能
    case "stun": {
      const v = viewOf(p.unit);
      if (v) {
        v.pulse(0xb08aff);
        effects.floatingText(headPos(p.unit, 0.5), "スタン", "#c9a8ff", {
          scale: 0.44,
          rise: 0.5,
          life: 0.9,
        });
      }
      break;
    }

    // 弓兵の追加の矢
    case "arrow": {
      const v = viewOf(p.unit);
      if (!v) break;
      const from = v.worldPos(v.muzzleHeight);
      const to = headPos(p.target, 0);
      effects.after(p.delay ?? 0, () => effects.projectile(from, to, 0xffe6a8, { duration: 0.14 }));
      break;
    }

    // 狙撃手の一撃（射線を引く）
    case "snipe": {
      const v = viewOf(p.unit);
      if (!v) break;
      v.faceTile(p.target.tile);
      effects.tracer(v.worldPos(v.muzzleHeight), headPos(p.target, 0), 0xffd08a);
      break;
    }

    // 重装兵の突き（貫通ライン）
    case "thrust": {
      const v = viewOf(p.unit);
      if (!v) break;
      v.lunge(p.target.tile);
      effects.impact(p.target.tile, 0xdfe8ff, 1.6);
      break;
    }

    case "manaFull":
      break;

    case "log":
      hud.log(p.html);
      break;

    case "announce":
      hud.announce(p.text, p.tone);
      break;

    case "end":
      onBattleEnd(p.winner);
      break;

    default:
      break;
  }
}

// ---------------------------------------------------------------- 決着処理

async function onBattleEnd(winner) {
  if (busy) return;
  busy = true;
  phase = Phase.RESULT;
  game.phase = Phase.RESULT;
  hud.setPhase(phase);

  const win = winner === "player";
  hud.announce(win ? "VICTORY" : "DEFEAT", win ? "good" : "danger");
  hud.log(win ? "<em>勝利!</em>" : "<em>敗北…</em>");

  // 決着の演出が見えるように少し待つ
  await wait(1500);

  const mvp = pickMvp();
  const outcome = game.applyResult(winner);
  hud.setStats(game);

  if (outcome === "gameover") {
    await hud.showGameOver({ round: game.round, best: game.best });
    game.reset();
    hud.setStats(game);
    busy = false;
    await startSelectFlow();
    return;
  }

  const res = await hud.showRoundResult({
    win,
    round: win ? game.round - 1 : game.round,
    squad: game.squad,
    enemyName: wave.name,
    mvp,
    life: game.life,
  });

  if (res.upgradeIndex != null && game.squad[res.upgradeIndex]) {
    game.upgrade(game.squad[res.upgradeIndex]);
  }

  busy = false;

  if (res.action === "reroster") {
    await startSelectFlow();
  } else {
    enterPrep();
  }
}

function pickMvp() {
  const allies = engine.units.filter((u) => u.team === "player");
  if (!allies.length) return null;
  const top = allies.reduce((a, b) => (b.damageDealt > a.damageDealt ? b : a));
  if (top.damageDealt <= 0) return null;
  const stars = top.star > 1 ? "★".repeat(top.star) : "";
  return { name: `${top.def.name}${stars}`, damage: Math.round(top.damageDealt) };
}

async function startSelectFlow() {
  phase = Phase.SELECT;
  game.phase = Phase.SELECT;
  hud.setPhase(phase);
  hud.setActionBar({ visible: false });
  placement.setActive(false);

  const prevStars = new Map(game.squad.map((s) => [s.typeId, s.star]));
  const picks = await hud.showRosterSelect(game.squad.map((s) => s.typeId));
  game.setSquad(picks);
  // 続投するコマは★を引き継ぐ
  for (const s of game.squad) s.star = prevStars.get(s.typeId) ?? 1;

  enterPrep();
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ ループ

let last = performance.now();

function frame(now) {
  const realDt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const speed = phase === Phase.BATTLE ? SPEEDS[speedIndex] : 1;
  const dt = realDt * speed;
  elapsed += dt;

  if (phase === Phase.BATTLE && engine && !engine.finished) {
    // 大きな dt でも判定が飛ばないように細かく刻む
    let remaining = dt;
    while (remaining > 0 && !engine.finished) {
      const step = Math.min(remaining, 1 / 60);
      engine.update(step);
      remaining -= step;
    }
  }

  for (const v of [...views.values()]) {
    v.update(dt, elapsed);
    if (v.removed) views.delete(v.unit.uid);
  }
  effects.update(dt);

  // 選択中ユニットのステータスを追従表示
  inspectorTimer -= realDt;
  if (selectedUid != null && inspectorTimer <= 0) {
    inspectorTimer = 0.15;
    const u = engine?.units.find((x) => x.uid === selectedUid);
    if (u) hud.showInspector(u);
  }

  stage.render();
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ 起動

async function boot() {
  hud.setStats(game);
  hud.setPhase(Phase.SELECT);
  hud.setSpeedLabel(SPEEDS[speedIndex]);
  hud.setActionBar({ visible: false });

  // タイトル画面の裏でデモ用のコマを並べておく
  showTitleDiorama();

  requestAnimationFrame(frame);

  await hud.showTitle(game.best);
  clearBoard();
  await startSelectFlow();
}

/** タイトル背景に飾るコマたち */
function showTitleDiorama() {
  const demo = [
    { typeId: "rook", team: "player", tile: { c: 2, r: 2 } },
    { typeId: "knight", team: "player", tile: { c: 3, r: 2 } },
    { typeId: "pawn", team: "player", tile: { c: 4, r: 2 } },
    { typeId: "queen", team: "player", tile: { c: 3, r: 0 } },
    { typeId: "king", team: "player", tile: { c: 4, r: 0 } },
    { typeId: "knight", team: "enemy", tile: { c: 2, r: 5 } },
    { typeId: "pawn", team: "enemy", tile: { c: 3, r: 5 } },
    { typeId: "rook", team: "enemy", tile: { c: 4, r: 5 } },
    { typeId: "bishop", team: "enemy", tile: { c: 3, r: 7 } },
    { typeId: "queen", team: "enemy", tile: { c: 4, r: 7 } },
  ];
  for (const d of demo) {
    const u = createUnit(d);
    const v = new UnitView(u, stage.unitLayer);
    v.barSprite.visible = false;
    views.set(u.uid, v);
  }
}

boot();

// デバッグ用に覗けるようにしておく
Object.assign(window, {
  __game: game,
  __stage: stage,
  __THREE: THREE,
  __units: UNIT_TYPES,
  __views: views,
  __createUnit: createUnit,
  __UnitView: UnitView,
  __clearBoard: clearBoard,
});
