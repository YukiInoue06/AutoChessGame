/**
 * DOM 側の UI（ヘッダー・ログ・インスペクタ・各種オーバーレイ）。
 *
 * オーバーレイは Promise を返すので、ゲーム進行側は
 * `const picks = await hud.showRosterSelect()` のように書ける。
 */

import {
  STAT_MAX,
  UNIT_TYPES,
  CHESS_IDS,
  JOB_IDS,
  buildStats,
  cssColorOf,
} from "../core/units.js";
import {
  Phase,
  MAX_LEVEL,
  REROLL_COST,
  XP_BUY_COST,
  XP_BUY_AMOUNT,
  shopOddsFor,
} from "../core/game.js";

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
  constructor({ onStart, onSpeedToggle, onHelp, onShop }) {
    this.el = {
      round: $("statRound"),
      life: $("statLife"),
      streak: $("statStreak"),
      gold: $("statGold"),
      level: $("statLevel"),
      xp: $("statXp"),
      toast: $("toast"),
      btnShop: $("btnShop"),
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
    this.el.btnShop.addEventListener("click", () => onShop());

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

  setStats(game) {
    this.el.round.textContent = game.round;
    this.el.life.textContent = "♥".repeat(Math.max(0, game.life)) || "0";
    this.el.streak.textContent = game.streak;
    this.el.gold.textContent = game.gold;
    this.el.level.textContent = game.level;
    const need = game.xpToNext;
    this.el.xp.style.width = need ? `${Math.min(100, (game.xp / need) * 100)}%` : "100%";
    this.el.xp.dataset.max = need ? "false" : "true";
  }

  /** 短いメッセージを一瞬だけ出す（コスト上限に引っかかった時など） */
  toast(text) {
    const el = this.el.toast;
    el.textContent = text;
    el.dataset.show = "true";
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      el.dataset.show = "false";
    }, 2200);
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
    this.el.inspGlyph.style.color = cssColorOf(unit.typeId);
    this.el.inspGlyph.style.boxShadow = `inset 0 0 0 2px ${cssColorOf(unit.typeId)}55`;
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

  /**
   * オーバーレイを開く。
   *
   * パネルの DOM は使い回しているので、前の画面が張ったイベントリスナーが
   * 残っていると次の画面のクリックを拾ってしまう（兵舎の売却処理が
   * リザルト画面で走る、など）。開くたびに AbortController を作り替え、
   * リスナーは必ず this._overlaySignal を渡して登録する。
   */
  _openOverlay(html) {
    this._overlayAbort?.abort();
    this._overlayAbort = new AbortController();
    this._overlaySignal = this._overlayAbort.signal;
    this.el.overlayPanel.innerHTML = html;
    this.el.overlay.hidden = false;
    return this.el.overlayPanel;
  }

  /** オーバーレイ内でイベントを購読する（閉じると自動で外れる） */
  _on(target, type, fn) {
    target.addEventListener(type, fn, { signal: this._overlaySignal });
  }

  closeOverlay() {
    this._overlayAbort?.abort();
    this._overlayAbort = null;
    this.el.overlay.hidden = true;
    this.el.overlayPanel.replaceChildren();
  }

  /** タイトル画面 */
  showTitle(best) {
    return new Promise((resolve) => {
      const p = this._openOverlay(`
        <h1 class="title">AUTO CHESS ARENA</h1>
        <p class="subtitle">チェス盤オートバトル ・ 全20種</p>
        <p>
          ショップでユニットを雇い、盤に並べて、あとは見守るだけ。
          コマは<b>それぞれの動き方</b>で敵に迫り、マナが満ちるとスキルを放ちます。
        </p>
        <h3>ルール</h3>
        <ol class="helplist">
          <li><b>ショップ</b> — 5枠の品揃えから雇う。リロールで引き直せる</li>
          <li><b>レベル</b> — 盤に出せる人数＝レベル。経験値で上がり、高コストも出やすくなる</li>
          <li><b>合成</b> — 同じユニットが3体そろうと自動で★アップ</li>
          <li><b>準備</b> — 手前3列にドラッグで配置。控え列に置いた分は戦わない</li>
          <li><b>バトル</b> — 自動で戦闘。全滅させれば勝ち。負けるとライフが1減る</li>
        </ol>
        <div class="overlay__actions">
          <span class="overlay__note">${best > 0 ? `自己ベスト: ラウンド ${best} 突破` : "初挑戦"}</span>
          <button class="btn btn--primary" data-act="start">ゲームスタート</button>
        </div>
      `);
      this._on(p.querySelector('[data-act="start"]'), "click", () => {
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
        <li><b>控え列へドラッグ</b> — 盤のさらに手前の列が控え。出撃メンバーから外れます</li>
        <li><b>クリック</b> — コマの詳細（ステータス・スキル）を表示</li>
        <li><b>右ドラッグ / ホイール</b> — カメラの回転とズーム</li>
        <li><kbd>Space</kbd> — バトル開始 / 速度切替</li>
      </ul>
      <h3>ショップとレベル</h3>
      <ul class="helplist">
        <li>ショップの<b>5枠</b>はレベルに応じた確率で抽選されます。${REROLL_COST}Gで引き直し、ラウンドごとに無料で更新</li>
        <li><b>盤に出せる人数＝レベル</b>。${XP_BUY_COST}Gで${XP_BUY_AMOUNT}exp買えるほか、ラウンドごとに自動で入ります</li>
        <li>レベルが上がると<b>高コストのユニットが出やすく</b>なります（5コストはレベル7から）</li>
        <li>同じユニットが<b>3体そろうと自動で★アップ</b>。★2が3体そろえば★3になります</li>
        <li>控えに置いたユニットは戦闘に出ませんが、合成の数には入ります</li>
        <li>収入はラウンドごとに基本10G＋勝利4G＋連勝ボーナス（最大5G）</li>
      </ul>
      <h3>戦闘のしくみ</h3>
      <ul class="helplist">
        <li>各コマは<b>いちばん近い敵</b>を狙い、それぞれの移動パターンで近づきます</li>
        <li>射程内に入ると自動で攻撃。攻撃と被弾で<b>マナ</b>が溜まります</li>
        <li>マナが満タンになると<b>スキル</b>を発動（足元のリングが金色に光ります）</li>
        <li>物理ダメージは防御、魔法ダメージは魔法防御で軽減されます</li>
        <li>チェスのコマは本家どおりの動き方、RPGジョブは役割に合わせた動き方をします</li>
        <li>40秒経過で<b>サドンデス</b>。全員がじわじわ削られます</li>
      </ul>
      <div class="overlay__actions">
        <button class="btn btn--primary" data-act="close">閉じる</button>
      </div>
    `);
    this._on(p.querySelector('[data-act="close"]'), "click", () => this.closeOverlay());
  }

  /**
   * ショップ。
   * 5枠の品揃えはレベルに応じた確率で抽選され、リロールで引き直せる。
   * 同じユニットが3体そろうと自動で★アップ（合成）する。
   *
   * @param {object} game
   * @param {{onChange?: () => void, first?: boolean}} opts
   * @returns {Promise<void>} 閉じたら解決する
   */
  showShop(game, { onChange = () => {}, first = false } = {}) {
    return new Promise((resolve) => {
      const p = this._openOverlay(`
        <div class="shop__head">
          <div>
            <h2>ショップ</h2>
            <p class="shop__sub" id="shopSub"></p>
          </div>
          <div class="shop__wallet">
            <span class="shop__gold" id="shopGold">0</span>
            <span class="shop__goldLabel">ゴールド</span>
          </div>
        </div>

        <div class="shop__bar">
          <div class="shop__level">
            <div class="shop__levelHead">
              <span>レベル <b id="shopLevel">3</b></span>
              <span id="shopXp"></span>
            </div>
            <span class="xpbar xpbar--wide"><span class="xpbar__fill" id="shopXpBar"></span></span>
            <div class="shop__odds" id="shopOdds"></div>
          </div>
          <div class="shop__buttons">
            <button class="btn btn--gold" data-act="xp">
              経験値を買う <span class="btn__sub">${XP_BUY_COST}G で ${XP_BUY_AMOUNT}exp</span>
            </button>
            <button class="btn" data-act="reroll">
              リロール <span class="btn__sub">${REROLL_COST}G</span>
            </button>
          </div>
        </div>

        <h3>品揃え — クリックで購入</h3>
        <div class="roster roster--shop" id="shopSlots"></div>

        <h3>所持ユニット</h3>
        <div class="roster roster--owned" id="shopOwned"></div>

        <div class="overlay__actions">
          <span class="overlay__note" id="shopNote"></span>
          <button class="btn btn--primary" data-act="close">
            ${first ? "盤に配置する" : "閉じる"}
          </button>
        </div>
      `);

      const slots = p.querySelector("#shopSlots");
      const owned = p.querySelector("#shopOwned");
      const closeBtn = p.querySelector('[data-act="close"]');

      const render = () => {
        // --- 品揃え ---
        slots.replaceChildren();
        game.shop.forEach((typeId, i) => {
          if (!typeId) {
            const empty = document.createElement("div");
            empty.className = "card card--sold";
            empty.innerHTML = '<span class="card__soldTag">売切</span>';
            slots.appendChild(empty);
            return;
          }
          const card = this._unitCard(typeId, { shop: true });
          card.dataset.slot = String(i);
          card.dataset.disabled =
            game.gold < UNIT_TYPES[typeId].cost || game.isRosterFull ? "true" : "false";
          slots.appendChild(card);
        });

        // --- 所持ユニット ---
        owned.replaceChildren();
        if (!game.roster.length) {
          const empty = document.createElement("p");
          empty.className = "shop__empty";
          empty.textContent = "まだ1体も居ません。上から雇いましょう。";
          owned.appendChild(empty);
        }
        for (const entry of game.roster) {
          const card = this._unitCard(entry.typeId, {
            star: entry.star,
            shop: true,
            place: entry.onBoard ? "出撃" : "控え",
            actions: [
              { act: "sell", label: `売却 ${game.refundOf(entry)}G`, cls: "cardbtn--sell" },
            ],
          });
          card.dataset.entryId = String(entry.id);
          owned.appendChild(card);
        }

        // --- 数値表示 ---
        p.querySelector("#shopGold").textContent = game.gold;
        p.querySelector("#shopLevel").textContent = game.level;
        const need = game.xpToNext;
        p.querySelector("#shopXp").textContent = need
          ? `${game.xp} / ${need} exp`
          : "最大レベル";
        p.querySelector("#shopXpBar").style.width = need
          ? `${Math.min(100, (game.xp / need) * 100)}%`
          : "100%";
        p.querySelector("#shopOdds").innerHTML = shopOddsFor(game.level)
          .map(
            (pct, i) =>
              `<span class="odds ${pct === 0 ? "odds--zero" : ""}">` +
              `<b>${i + 1}</b>コスト ${pct}%</span>`,
          )
          .join("");
        p.querySelector("#shopSub").innerHTML =
          `ラウンド ${game.round} ／ 盤に出せるのは <b>レベルと同じ ${game.maxUnits} 体</b>`;
        p.querySelector("#shopNote").textContent = game.isRosterFull
          ? "所持数がいっぱいです"
          : `所持 ${game.roster.length} 体 — 出撃 ${game.squad.length} / 控え ${game.bench.length}`;
        p.querySelector('[data-act="xp"]').disabled =
          game.level >= MAX_LEVEL || game.gold < XP_BUY_COST;
        p.querySelector('[data-act="reroll"]').disabled = game.gold < REROLL_COST;
        closeBtn.disabled = first && game.squad.length === 0;
        onChange();
      };

      // フォーカス移動でパネルがスクロールするのを防ぐ
      this._on(p, "mousedown", (e) => {
        if (e.target.closest(".card")) e.preventDefault();
      });

      this._on(p, "click", (e) => {
        // 売却
        const btn = e.target.closest(".cardbtn");
        if (btn) {
          const entry = game.byId(Number(btn.closest(".card").dataset.entryId));
          if (entry) {
            this.toast(
              `${UNIT_TYPES[entry.typeId].name} を ${game.refundOf(entry)}G で売却`,
            );
            game.sell(entry);
            render();
          }
          return;
        }

        // 購入
        const card = e.target.closest(".card");
        if (!card || card.dataset.slot === undefined) return;
        if (card.dataset.disabled === "true") return;
        const res = game.buySlot(Number(card.dataset.slot));
        if (res.ok) {
          const name = UNIT_TYPES[res.entry.typeId].name;
          this.toast(
            res.merged ? `${name} が ★${res.merged} に合体!` : `${name} を雇った`,
          );
        } else {
          this.toast(res.reason);
        }
        render();
      });

      this._on(p.querySelector('[data-act="reroll"]'), "click", () => {
        const res = game.reroll();
        if (!res.ok) this.toast(res.reason);
        render();
      });

      this._on(p.querySelector('[data-act="xp"]'), "click", () => {
        const res = game.buyXp();
        if (!res.ok) this.toast(res.reason);
        else if (res.levelUps) this.toast(`レベル ${game.level} に上がった!`);
        render();
      });

      this._on(closeBtn, "click", () => {
        this.closeOverlay();
        resolve();
      });

      render();
    });
  }
  /**
   * ユニットカード。
   * actions を渡すと、クリックできるボタンを内側に持つ静的カードになる
   * （ボタンの入れ子を避けるため、その場合は div で作る）。
   */
  _unitCard(
    typeId,
    { star = 1, badge = "", shop = false, place = null, actions = null } = {},
  ) {
    const t = UNIT_TYPES[typeId];
    const s = buildStats(typeId, { star });
    const card = document.createElement(actions ? "div" : "button");
    if (!actions) card.type = "button";
    card.className = actions ? "card card--static" : "card";
    card.dataset.id = typeId;
    if (shop) {
      badge += `<span class="card__cost" data-tier="${t.cost}">${t.cost}G</span>`;
      if (place) badge += `<span class="card__place">${place}</span>`;
    }
    card.title = `${t.name}（${t.role}）\n移動: ${t.moveText}\n${t.skill.name}: ${t.skill.text}`;
    const hue = cssColorOf(typeId);
    card.style.setProperty("--hue", hue);
    card.innerHTML = `
      <div class="card__glyph" style="color:${hue}">${t.glyph}</div>
      <div class="card__name">${t.name}${star > 1 ? ` <span style="color:#f5c451">${"★".repeat(star)}</span>` : ""}</div>
      <div class="card__role">${t.role}</div>
      <div class="card__bars">
        ${bar("HP", clamp01(s.maxHp / (STAT_MAX.hp * star)), "hp")}
        ${bar("ATK", clamp01(s.atk / (STAT_MAX.atk * star)), "atk")}
        ${bar("RNG", clamp01(t.range / STAT_MAX.range), "rng")}
      </div>
      <div class="card__skill"><b>${t.skill.name}</b>${t.skill.text}</div>
      ${badge}
      ${
        actions
          ? `<div class="card__actions">${actions
              .map(
                (a) =>
                  `<button type="button" class="cardbtn ${a.cls ?? ""}" data-act="${a.act}"` +
                  `${a.disabled ? " disabled" : ""}>${a.label}</button>`,
              )
              .join("")}</div>`
          : ""
      }
    `;
    return card;
  }

  /**
   * ラウンド結果。
   * ★アップはショップでの3体合成に一本化したので、ここでは報酬を配らない。
   *
   * @returns {Promise<{action:'continue'|'shop'}>}
   */
  showRoundResult({ win, round, enemyName, mvp, life, income, gold, level }) {
    return new Promise((resolve) => {
      const p = this._openOverlay(`
        <div class="result-tag ${win ? "result-tag--win" : "result-tag--lose"}">
          ${win ? "VICTORY" : "DEFEAT"}
        </div>
        <h2>ラウンド ${round} ${win ? "突破" : "敗北"}</h2>
        <p style="margin-top:2px">
          ${
            win
              ? `<b>${enemyName}</b> を退けた。${mvp ? `MVP は <b style="color:#5ad2ff">${mvp.name}</b>（${mvp.damage} ダメージ）。` : ""}`
              : `<b>${enemyName}</b> に敗れた。残りライフ <b style="color:#ff6b6b">${"♥".repeat(life)}</b>`
          }
        </p>
        <p class="income">
          収入 <b>+${income.gain}G</b>
          <span class="income__break">
            （基本 ${income.base}${income.win ? ` ／ 勝利 +${income.win}` : ""}${income.streak ? ` ／ 連勝 +${income.streak}` : ""}）
          </span>
          → 所持 <b style="color:#f5c451">${gold}G</b>
        </p>
        <p class="income income--xp">
          経験値 <b>+${income.xp}</b>
          ${income.levelUps ? `→ <b style="color:#7ef2a8">レベル ${level} に上がった!</b>` : `／ 現在レベル ${level}`}
          <span class="income__break">（レベル＝盤に出せる人数）</span>
        </p>
        <p class="result-hint">
          ショップの品揃えは引き直されています。同じユニットを3体そろえると★アップします。
        </p>
        <div class="overlay__actions">
          <button class="btn btn--gold" data-act="shop">ショップへ</button>
          <button class="btn btn--primary" data-act="next">次へ</button>
        </div>
      `);

      const finish = (action) => {
        this.closeOverlay();
        resolve({ action });
      };
      this._on(p.querySelector('[data-act="next"]'), "click", () => finish("continue"));
      this._on(p.querySelector('[data-act="shop"]'), "click", () => finish("shop"));
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
      this._on(p.querySelector('[data-act="retry"]'), "click", () => {
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
