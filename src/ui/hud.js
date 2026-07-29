/**
 * DOM 側の UI（ヘッダー・ログ・インスペクタ・各種オーバーレイ）。
 *
 * オーバーレイは Promise を返すので、ゲーム進行側は
 * `const picks = await hud.showRosterSelect()` のように書ける。
 */

import { STAT_MAX, UNIT_TYPES, UNIT_IDS, buildStats } from "../core/units.js";
import { Phase } from "../core/game.js";

const $ = (id) => document.getElementById(id);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

const PHASE_LABEL = {
  [Phase.SELECT]: "編成フェーズ",
  [Phase.PREP]: "準備フェーズ",
  [Phase.BATTLE]: "バトル中",
  [Phase.RESULT]: "リザルト",
  [Phase.GAMEOVER]: "ゲームオーバー",
};

export class Hud {
  constructor({ onStart, onSpeedToggle, onHelp }) {
    this.el = {
      round: $("statRound"),
      life: $("statLife"),
      streak: $("statStreak"),
      phaseBadge: $("phaseBadge"),
      phaseText: $("phaseText"),
      actionbar: $("actionbar"),
      actionHint: $("actionHint"),
      btnStart: $("btnStart"),
      btnSpeed: $("btnSpeed"),
      btnHelp: $("btnHelp"),
      logPanel: $("logPanel"),
      logList: $("logList"),
      overlay: $("overlay"),
      overlayPanel: $("overlayPanel"),
      inspector: $("inspector"),
      inspGlyph: $("inspGlyph"),
      inspName: $("inspName"),
      inspStars: $("inspStars"),
      inspStats: $("inspStats"),
      inspSkillName: $("inspSkillName"),
      inspSkillText: $("inspSkillText"),
      inspMove: $("inspMove"),
    };

    this.el.btnStart.addEventListener("click", () => onStart());
    this.el.btnSpeed.addEventListener("click", () => onSpeedToggle());
    this.el.btnHelp.addEventListener("click", () => onHelp());

    this._announceEl = document.createElement("div");
    Object.assign(this._announceEl.style, {
      position: "fixed",
      left: "50%",
      top: "34%",
      transform: "translate(-50%, -50%)",
      fontSize: "clamp(30px, 6vw, 62px)",
      fontWeight: "900",
      letterSpacing: "0.06em",
      pointerEvents: "none",
      opacity: "0",
      textShadow: "0 6px 30px rgba(0,0,0,0.75)",
      zIndex: "15",
      whiteSpace: "nowrap",
    });
    document.body.appendChild(this._announceEl);
  }

  // ------------------------------------------------------------ ヘッダー等

  setStats({ round, life, streak }) {
    this.el.round.textContent = round;
    this.el.life.textContent = "♥".repeat(Math.max(0, life)) || "0";
    this.el.streak.textContent = streak;
  }

  setPhase(phase) {
    this.el.phaseText.textContent = PHASE_LABEL[phase] ?? phase;
    this.el.phaseBadge.dataset.phase = phase;
    this.el.logPanel.dataset.visible = phase === Phase.BATTLE ? "true" : "false";
  }

  setActionBar({ visible, hint, label = "バトル開始", disabled = false }) {
    this.el.actionbar.dataset.hidden = visible ? "false" : "true";
    if (hint !== undefined) this.el.actionHint.innerHTML = hint;
    this.el.btnStart.textContent = label;
    this.el.btnStart.disabled = disabled;
  }

  setSpeedLabel(mult) {
    this.el.btnSpeed.textContent = `▶ ${mult.toFixed(1)}x`;
  }

  // ------------------------------------------------------------------ ログ

  log(html) {
    const li = document.createElement("li");
    li.innerHTML = html;
    this.el.logList.appendChild(li);
    while (this.el.logList.children.length > 40) {
      this.el.logList.removeChild(this.el.logList.firstChild);
    }
    this.el.logList.scrollTop = this.el.logList.scrollHeight;
  }

  clearLog() {
    this.el.logList.replaceChildren();
  }

  announce(text, tone = "info") {
    const el = this._announceEl;
    const color =
      tone === "danger" ? "#ff7a7a" : tone === "good" ? "#7ef2a8" : "#ffffff";
    el.textContent = text;
    el.style.color = color;
    el.animate(
      [
        { opacity: 0, transform: "translate(-50%,-50%) scale(1.35)" },
        { opacity: 1, transform: "translate(-50%,-50%) scale(1)", offset: 0.22 },
        { opacity: 1, transform: "translate(-50%,-50%) scale(1)", offset: 0.7 },
        { opacity: 0, transform: "translate(-50%,-58%) scale(0.96)" },
      ],
      { duration: 1400, easing: "cubic-bezier(.2,.9,.3,1)" },
    );
  }

  // -------------------------------------------------------------- インスペクタ

  /** @param {object|null} unit battle.js のユニット実体 */
  showInspector(unit) {
    if (!unit) {
      this.el.inspector.hidden = true;
      return;
    }
    const d = unit.def;
    this.el.inspector.hidden = false;
    this.el.inspGlyph.textContent = unit.team === "player" ? d.glyph : d.glyphDark;
    this.el.inspName.textContent = d.name;
    this.el.inspName.style.color = unit.team === "player" ? "#5ad2ff" : "#ff6b6b";
    this.el.inspStars.textContent = "★".repeat(unit.star);

    const rows = [
      ["HP", `${Math.ceil(unit.hp)} / ${unit.maxHp}`],
      ["攻撃力", Math.round(unit.baseAtk * (1 + unit.atkMulPerm))],
      ["攻撃速度", `${unit.attackSpeed.toFixed(2)} 回/秒`],
      ["射程", `${unit.range} マス`],
      ["防御", unit.armor + unit.armorBonus],
      ["魔法防御", unit.resist],
      ["マナ", `${Math.floor(unit.mana)} / ${unit.manaMax}`],
    ];
    if (unit.shield > 0) rows.push(["シールド", Math.round(unit.shield)]);

    this.el.inspStats.replaceChildren();
    for (const [k, v] of rows) {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v;
      this.el.inspStats.append(dt, dd);
    }

    this.el.inspSkillName.textContent = `${d.skill.name}（${unit.manaMax}マナ）`;
    this.el.inspSkillText.textContent = d.skill.text;
    this.el.inspMove.textContent = `移動: ${d.moveText}${d.auraText ? " / " + d.auraText : ""}`;
  }

  // ---------------------------------------------------------- オーバーレイ

  _openOverlay(html) {
    this.el.overlayPanel.innerHTML = html;
    this.el.overlay.hidden = false;
    return this.el.overlayPanel;
  }

  closeOverlay() {
    this.el.overlay.hidden = true;
    this.el.overlayPanel.replaceChildren();
  }

  /** タイトル画面 */
  showTitle(best) {
    return new Promise((resolve) => {
      const p = this._openOverlay(`
        <h1 class="title">AUTO CHESS ARENA</h1>
        <p class="subtitle">3 vs 3 ・ チェス盤オートバトル</p>
        <p>
          チェスのコマを3体えらんで盤に並べ、あとは見守るだけ。
          コマは<b>本物のチェスと同じ動き方</b>で敵に迫り、マナが満ちるとスキルを放ちます。
        </p>
        <h3>ルール</h3>
        <ol class="helplist">
          <li><b>編成</b> — 6種類のコマから3体を選ぶ</li>
          <li><b>準備</b> — 手前3列の好きなマスにドラッグで配置</li>
          <li><b>バトル</b> — 自動で戦闘。全滅させれば勝ち</li>
          <li><b>成長</b> — 勝つたびに1体を★アップ、負けるとライフが1減る</li>
        </ol>
        <div class="overlay__actions">
          <span class="overlay__note">${best > 0 ? `自己ベスト: ラウンド ${best} 突破` : "初挑戦"}</span>
          <button class="btn btn--primary" data-act="start">ゲームスタート</button>
        </div>
      `);
      p.querySelector('[data-act="start"]').addEventListener("click", () => {
        this.closeOverlay();
        resolve();
      });
    });
  }

  /** 遊びかた（いつでも閉じられる） */
  showHelp() {
    const p = this._openOverlay(`
      <h2>遊びかた</h2>
      <h3>操作</h3>
      <ul class="helplist">
        <li><b>ドラッグ</b> — 準備フェーズ中、自分のコマを手前3列に配置。味方どうしは入れ替えになります</li>
        <li><b>クリック</b> — コマの詳細（ステータス・スキル）を表示</li>
        <li><b>右ドラッグ / ホイール</b> — カメラの回転とズーム</li>
        <li><kbd>Space</kbd> — バトル開始 / 速度切替</li>
      </ul>
      <h3>戦闘のしくみ</h3>
      <ul class="helplist">
        <li>各コマは<b>いちばん近い敵</b>を狙い、チェスの動き方で近づきます</li>
        <li>射程内に入ると自動で攻撃。攻撃と被弾で<b>マナ</b>が溜まります</li>
        <li>マナが満タンになると<b>スキル</b>を発動（足元のリングが金色に光ります）</li>
        <li>物理ダメージは防御、魔法ダメージは魔法防御で軽減されます</li>
        <li>40秒経過で<b>サドンデス</b>。全員がじわじわ削られます</li>
      </ul>
      <div class="overlay__actions">
        <button class="btn btn--primary" data-act="close">閉じる</button>
      </div>
    `);
    p.querySelector('[data-act="close"]').addEventListener("click", () => this.closeOverlay());
  }

  /**
   * 編成選択。
   * @param {string[]} initial すでに選んでいるコマ
   * @returns {Promise<string[]>}
   */
  showRosterSelect(initial = []) {
    return new Promise((resolve) => {
      const p = this._openOverlay(`
        <h2>編成を組む</h2>
        <p style="margin-top:4px">出撃させる3体を選ぼう。前衛・後衛・支援のバランスが勝敗を分ける。</p>
        <div class="roster" id="rosterGrid"></div>
        <div class="overlay__actions">
          <span class="overlay__note" id="rosterNote"></span>
          <button class="btn" data-act="clear">選び直す</button>
          <button class="btn btn--primary" data-act="ok" disabled>この編成で出撃</button>
        </div>
      `);

      const grid = p.querySelector("#rosterGrid");
      const note = p.querySelector("#rosterNote");
      const ok = p.querySelector('[data-act="ok"]');
      const selected = [...initial];

      for (const id of UNIT_IDS) {
        grid.appendChild(this._unitCard(id));
      }

      const refresh = () => {
        for (const card of grid.children) {
          const id = card.dataset.id;
          const i = selected.indexOf(id);
          card.dataset.selected = i >= 0 ? "true" : "false";
          card.dataset.disabled = i < 0 && selected.length >= 3 ? "true" : "false";
          let badge = card.querySelector(".card__order");
          if (i >= 0) {
            if (!badge) {
              badge = document.createElement("span");
              badge.className = "card__order";
              card.appendChild(badge);
            }
            badge.textContent = i + 1;
          } else badge?.remove();
        }
        note.textContent = `${selected.length} / 3 体を選択中`;
        ok.disabled = selected.length !== 3;
      };

      grid.addEventListener("click", (e) => {
        const card = e.target.closest(".card");
        if (!card) return;
        const id = card.dataset.id;
        const i = selected.indexOf(id);
        if (i >= 0) selected.splice(i, 1);
        else if (selected.length < 3) selected.push(id);
        refresh();
      });

      p.querySelector('[data-act="clear"]').addEventListener("click", () => {
        selected.length = 0;
        refresh();
      });
      ok.addEventListener("click", () => {
        this.closeOverlay();
        resolve([...selected]);
      });

      refresh();
    });
  }

  _unitCard(typeId, { star = 1, badge = "" } = {}) {
    const t = UNIT_TYPES[typeId];
    const s = buildStats(typeId, { star });
    const card = document.createElement("button");
    card.type = "button";
    card.className = "card";
    card.dataset.id = typeId;
    card.innerHTML = `
      <div class="card__glyph">${t.glyph}</div>
      <div class="card__name">${t.name}${star > 1 ? ` <span style="color:#f5c451">${"★".repeat(star)}</span>` : ""}</div>
      <div class="card__role">${t.role}</div>
      <div class="card__bars">
        ${bar("HP", clamp01(s.maxHp / (STAT_MAX.hp * star)), "hp")}
        ${bar("ATK", clamp01(s.atk / (STAT_MAX.atk * star)), "atk")}
        ${bar("RNG", clamp01(t.range / STAT_MAX.range), "rng")}
      </div>
      <div class="card__skill"><b>${t.skill.name}</b>${t.skill.text}</div>
      ${badge}
    `;
    return card;
  }

  /**
   * ラウンド結果 + 報酬（★アップ / 編成変更）。
   * @returns {Promise<{action:'continue'|'reroster'}>}
   */
  showRoundResult({ win, round, squad, enemyName, mvp, life }) {
    return new Promise((resolve) => {
      const upgradable = squad.filter((s) => s.star < 3);
      const p = this._openOverlay(`
        <div class="result-tag ${win ? "result-tag--win" : "result-tag--lose"}">
          ${win ? "VICTORY" : "DEFEAT"}
        </div>
        <h2>ラウンド ${round} ${win ? "突破" : "敗北"}</h2>
        <p style="margin-top:2px">
          ${win
            ? `<b>${enemyName}</b> を退けた。${mvp ? `MVP は <b style="color:#5ad2ff">${mvp.name}</b>（${mvp.damage} ダメージ）。` : ""}`
            : `<b>${enemyName}</b> に敗れた。残りライフ <b style="color:#ff6b6b">${"♥".repeat(life)}</b>`}
        </p>
        <h3>${win ? "報酬 — 1体を★アップ" : "編成を立て直そう"}</h3>
        <div class="roster" id="rewardGrid"></div>
        <div class="overlay__actions">
          <span class="overlay__note" id="rewardNote">${
            win
              ? upgradable.length
                ? "★が上がるとステータスが1.7倍になる"
                : "全員が★3。これ以上は上げられない"
              : "同じ編成で再挑戦するか、組み直すか選ぼう"
          }</span>
          <button class="btn" data-act="reroster">編成を組み直す</button>
          <button class="btn btn--primary" data-act="next" ${win && upgradable.length ? "disabled" : ""}>
            ${win ? "次のラウンドへ" : "再挑戦"}
          </button>
        </div>
      `);

      const grid = p.querySelector("#rewardGrid");
      const next = p.querySelector('[data-act="next"]');
      let chosen = null;

      squad.forEach((s, i) => {
        const card = this._unitCard(s.typeId, { star: s.star });
        card.dataset.index = String(i);
        if (win && s.star >= 3) card.dataset.disabled = "true";
        grid.appendChild(card);
      });

      if (win && upgradable.length) {
        grid.addEventListener("click", (e) => {
          const card = e.target.closest(".card");
          if (!card || card.dataset.disabled === "true") return;
          chosen = Number(card.dataset.index);
          for (const c of grid.children) c.dataset.selected = c === card ? "true" : "false";
          next.disabled = false;
        });
      } else {
        for (const c of grid.children) c.style.pointerEvents = "none";
      }

      next.addEventListener("click", () => {
        this.closeOverlay();
        resolve({ action: "continue", upgradeIndex: chosen });
      });
      p.querySelector('[data-act="reroster"]').addEventListener("click", () => {
        this.closeOverlay();
        resolve({ action: "reroster", upgradeIndex: chosen });
      });
    });
  }

  showGameOver({ round, best }) {
    return new Promise((resolve) => {
      const p = this._openOverlay(`
        <div class="result-tag result-tag--lose">GAME OVER</div>
        <h2>ラウンド ${round} で力尽きた</h2>
        <p>突破ラウンド数: <b>${round - 1}</b> ／ 自己ベスト: <b style="color:#f5c451">${best}</b></p>
        <p>編成と配置を変えれば結果は変わる。もう一度挑もう。</p>
        <div class="overlay__actions">
          <button class="btn btn--gold" data-act="retry">最初から挑戦する</button>
        </div>
      `);
      p.querySelector('[data-act="retry"]').addEventListener("click", () => {
        this.closeOverlay();
        resolve();
      });
    });
  }
}

function bar(label, ratio, kind) {
  return `<div class="bar"><span>${label}</span>
    <span class="bar__track"><span class="bar__fill bar__fill--${kind}" style="width:${(ratio * 100).toFixed(0)}%"></span></span>
  </div>`;
}
