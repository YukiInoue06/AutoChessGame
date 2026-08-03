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
import { isBenchTile } from "./core/board.js";
import { activeTraits } from "./core/traits.js";

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
  onShop: () => openShop(),
  onEnemyInfo: () => hud.showEnemyInfo(wave),
  onBenchToggle: () => toggleBench(),
});

/** 兵舎を開く。買った/売ったぶんは即座に盤へ反映する */
async function openShop({ first = false } = {}) {
  if (busy || (phase !== Phase.PREP && !first)) return;
  busy = true;
  placement.setActive(false);
  await hud.showShop(game, {
    first,
    onChange: () => {
      // 所持ユニットが変わったので盤の見た目を作り直す
      setupPrep();
      hud.setStats(game);
    },
  });
  busy = false;
  if (phase === Phase.PREP) {
    placement.setActive(true);
    refreshPrepUI();
  }
}

const placement = new PlacementController(stage, {
  canPlace: () => phase === Phase.PREP,
  onSelect: (view) => selectUnit(view),
  onPlace: (view, tile) => placeUnit(view, tile),
  onPickedChange: () => refreshPrepUI(),
});

/**
 * 選んでいるコマを 盤 ⇄ 控え で入れ替える。
 * 控え列は縦画面だと細い帯にしかならず狙いにくいので、
 * 確実に押せるボタンからも同じことをできるようにしておく。
 */
function toggleBench() {
  const view = placement.picked;
  const entry = view?.squadEntry;
  if (!entry) return;
  const res = entry.onBoard ? game.unfield(entry) : game.field(entry);
  if (!res.ok) {
    hud.toast(res.reason);
    return;
  }
  view.unit.tile = { ...entry.tile };
  view.snapTo(entry.tile);
  view.setBenched(!entry.onBoard);
  placement.clearPicked();
  refreshPrepUI();
}

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

/**
 * 準備フェーズの見た目を作る。
 * この時点では戦闘は始まっていないので engine は作らず、
 * 所持ユニット（盤＋控え）と敵のプレビューをビューとして並べるだけ。
 */
function setupPrep() {
  clearBoard();
  // ビューを作り直すので、タップで選んでいた参照は捨てる
  placement.clearPicked();
  engine = null;

  for (const entry of game.roster) {
    const u = createUnit({
      typeId: entry.typeId,
      team: "player",
      tile: entry.tile,
      star: entry.star,
    });
    const view = new UnitView(u, stage.unitLayer);
    view.squadEntry = entry;
    view.setBenched(!entry.onBoard);
    views.set(u.uid, view);
  }

  for (const e of wave.units) {
    const u = createUnit({
      typeId: e.typeId,
      team: "enemy",
      tile: e.tile,
      star: e.star,
      power: wave.power,
    });
    views.set(u.uid, new UnitView(u, stage.unitLayer));
  }
}

/**
 * 出撃メンバーで戦闘を組み立てる。
 * 準備フェーズのビューは捨てて作り直すが、位置は同じなので
 * 登場アニメーションを省けば見た目は連続して見える。
 */
function buildBattle() {
  clearBoard();

  const fielded = game.squad;
  const playerUnits = fielded.map((s) =>
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
    traitBonus: game.traitBonus,
  });

  for (const u of engine.units) {
    views.set(u.uid, new UnitView(u, stage.unitLayer, { animateSpawn: false }));
  }
  playerUnits.forEach((u, i) => {
    views.get(u.uid).squadEntry = fielded[i];
  });
}

/**
 * 定跡を1つ選ばせる。
 * ラン開始時と、区切りのラウンド（openings.js の OPENING_ROUNDS）で呼ぶ。
 */
async function pickOpening({ first = false } = {}) {
  const chosen = await hud.showOpeningSelect({
    first,
    choices: game.drawOpeningChoices(),
    taken: game.openings,
    rerollsLeft: game.openingRerolls,
    onReroll: () => game.rerollOpeningChoices(),
  });
  game.addOpening(chosen);
  hud.setOpenings(game.openings);
  hud.setStats(game);
  return chosen;
}

async function enterPrep() {
  phase = Phase.PREP;
  game.phase = Phase.PREP;

  // 区切りのラウンドに来ていたら、盤を組む前に定跡を1つ足す
  let added = null;
  if (game.needsOpening) {
    busy = true;
    added = await pickOpening();
    busy = false;
  }

  wave = game.buildEnemyWave();
  setupPrep();
  hud.setPhase(phase);
  hud.clearLog();
  // ログは clearLog のあとに出す（先に出すと消えてしまう）
  if (added) hud.log(`<em>定跡</em> — <b class="ally">${added.name}</b> を選んだ`);
  refreshPrepUI();
  placement.setActive(true);
  hud.announce(`ラウンド ${game.round}`, "info");
}

/**
 * ドラッグで配置する。
 * 盤 ⇄ 控え列をまたぐと出撃/待機が切り替わり、コスト上限のチェックが入る。
 * 味方が居るマスに落とした場合は入れ替え。
 */
function placeUnit(view, tile) {
  const entry = view.squadEntry;
  if (!isDeployTile(tile) || !entry) {
    view.snapTo(view.unit.tile);
    return;
  }

  const toBench = isBenchTile(tile);
  const occupant = [...views.values()].find(
    (v) =>
      v !== view &&
      v.unit.alive &&
      v.unit.tile.c === tile.c &&
      v.unit.tile.r === tile.r,
  );
  if (occupant && occupant.unit.team !== "player") {
    view.snapTo(view.unit.tile);
    return;
  }
  const other = occupant?.squadEntry ?? null;
  const from = { ...entry.tile };

  if (toBench === !entry.onBoard) {
    // 同じ領域内での移動。相手が居ればマスを交換するだけ
    if (other) {
      other.tile = from;
      occupant.unit.tile = { ...from };
      occupant.snapTo(from);
    }
    entry.tile = { c: tile.c, r: tile.r };
  } else if (toBench) {
    // 盤 → 控え。入れ替え相手が控えに居るならその相手を盤へ
    game.unfield(entry, tile);
    if (other && !other.onBoard) {
      game.field(other, from);
      occupant.unit.tile = { ...from };
      occupant.snapTo(from);
      occupant.setBenched(false);
    }
  } else {
    // 控え → 盤。コストと人数の上限を満たすか確認する
    if (other?.onBoard) game.unfield(other, from); // 先に相手を控えへ退避
    const check = game.canField(entry);
    if (!check.ok) {
      if (other?.onBoard === false && other.tile.r === from.r) game.field(other, tile);
      view.snapTo(view.unit.tile);
      hud.toast(check.reason);
      refreshPrepUI();
      return;
    }
    game.field(entry, tile);
    if (other) {
      occupant.unit.tile = { ...other.tile };
      occupant.snapTo(other.tile);
      occupant.setBenched(!other.onBoard);
    }
  }

  view.unit.tile = { c: tile.c, r: tile.r };
  view.snapTo(tile);
  view.setBenched(!entry.onBoard);
  refreshPrepUI();
}

/** ゴールド・レベル・特性の表示とバトル開始ボタンの状態を更新する */
function refreshPrepUI() {
  hud.setStats(game);
  // 盤に出ているユニットから、いま効いている特性を出す
  hud.setTraits(
    activeTraits(
      game.squad.map((u) => ({ typeId: u.typeId, def: UNIT_TYPES[u.typeId] })),
      game.traitBonus,
    ),
  );
  const fielded = game.squad.length;
  const picked = placement?.picked?.squadEntry ?? null;
  hud.setBenchToggle(
    picked ? { onBoard: picked.onBoard, name: UNIT_TYPES[picked.typeId].name } : null,
  );
  hud.setActionBar({
    visible: phase === Phase.PREP,
    label: "バトル開始",
    disabled: fielded === 0,
    hint:
      `次の相手は <button type="button" class="hintbtn" data-act="enemyInfo">` +
      `${wave?.name ?? "?"}（★${wave?.star ?? 1}）</button> ／ ` +
      `出撃 <b>${fielded}</b>/${game.maxUnits}体（レベル${game.level}）` +
      (fielded === 0 ? ' — <b style="color:#ff6b6b">1体以上を盤に出そう</b>' : ""),
  });
}

function beginBattle() {
  if (phase !== Phase.PREP || busy) return;
  if (game.squad.length === 0) {
    hud.toast("盤に1体以上を出してください");
    return;
  }
  buildBattle();
  phase = Phase.BATTLE;
  game.phase = Phase.BATTLE;
  placement.setActive(false);
  stage.clearHighlights();
  hud.setPhase(phase);
  hud.setActionBar({ visible: false });
  hud.log(`<em>ラウンド ${game.round}</em> — 対 <b class="enemy">${wave.name}</b>`);
  hud.announce("BATTLE!", "danger");
  hud.setTraits(engine.traits.get("player") ?? []);

  for (const a of engine.traits.get("player") ?? []) {
    if (a.tier) {
      hud.log(`<em>${a.trait.name} ${a.count}</em> — ${a.tier.text}`);
    }
  }

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
  const income = game.grantIncome(win);
  hud.setStats(game);

  if (outcome === "gameover") {
    await hud.showGameOver({ round: game.round, best: game.best });
    game.reset();
    hud.setStats(game);
    busy = false;
    await startNewRun();
    return;
  }

  const res = await hud.showRoundResult({
    win,
    round: win ? game.round - 1 : game.round,
    enemyName: wave.name,
    mvp,
    life: game.life,
    income,
    gold: game.gold,
    level: game.level,
  });

  busy = false;
  await enterPrep();
  if (res.action === "shop") await openShop();
}

function pickMvp() {
  const allies = engine.units.filter((u) => u.team === "player");
  if (!allies.length) return null;
  const top = allies.reduce((a, b) => (b.damageDealt > a.damageDealt ? b : a));
  if (top.damageDealt <= 0) return null;
  const stars = top.star > 1 ? "★".repeat(top.star) : "";
  return { name: `${top.def.name}${stars}`, damage: Math.round(top.damageDealt) };
}

/** 新しい挑戦のはじまり。まず兵舎でユニットを雇う */
async function startNewRun() {
  phase = Phase.SELECT;
  game.phase = Phase.SELECT;
  hud.setPhase(phase);
  hud.setActionBar({ visible: false });
  placement.setActive(false);

  // 開幕の定跡を選ぶ。開始値そのものが変わるので、盤を組む前に決める
  await pickOpening({ first: true });

  wave = game.buildEnemyWave();
  setupPrep();
  await openShop({ first: true });
  await enterPrep();
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
  await startNewRun();
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
