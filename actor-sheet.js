/**
 * Not the End — Actor Sheet (DocumentSheetV2, Foundry v13) + Sacchetto Token
 */

const { ApplicationV2, DocumentSheetV2, HandlebarsApplicationMixin } = foundry.applications.api;
const MODULE = "not-the-end";
const SOCKET = `module.${MODULE}`;

// Alveare 3-4-5-4-3 = 19 esagoni ('a' abilità, 'q' qualità, 'arc' archetipo)
const HIVE_ROWS = [
  ["a", "q", "a"],
  ["a", "q", "q", "a"],
  ["a", "q", "arc", "q", "a"],
  ["a", "q", "q", "a"],
  ["a", "q", "a"],
];
const HIVE_LABELS = { a: "Abilità", q: "Qualità", arc: "Archetipo" };

// Geometria alveare (px) — deve combaciare con .nte-hive / .nte-hex nel CSS
const HIVE_W = 560, HEX_W = 110, STEP_X = 108, STEP_Y = 96, HIVE_TOP = 20;

function defaultFlags() {
  return {
    concetto:   "",
    rischio:    "",
    appunti:    "",
    equip:      "",
    tokens:     { speranza: 0, dolore: 0, paura: 0 },
    sventure:   Array.from({ length: 4 }, () => ({ testo: "", checked: false })),
    confusione: [false],
    adrenalina: [false],
    lezioni:    ["", "", "", ""],
    // hive_{riga}_{colonna}_testo / _checked: letti on demand
  };
}

export class NTEActorSheet extends HandlebarsApplicationMixin(DocumentSheetV2) {

  static DEFAULT_OPTIONS = {
    classes:  ["nte-sheet-window"],
    position: { width: 780, height: 920 },
    window:   { resizable: true },
    actions:  { openTokenBag: NTEActorSheet.#openTokenBag },
  };

  static PARTS = {
    sheet: { template: `modules/${MODULE}/templates/actor-sheet.hbs` },
  };

  #tokenBag = null;

  get title() { return this.document?.name ?? "Scheda"; }

  _f() {
    return foundry.utils.mergeObject(
      defaultFlags(),
      foundry.utils.deepClone(this.document?.flags?.[MODULE] ?? {}),
      { inplace: false }
    );
  }

  _buildHive(flags) {
    const hive = [];
    HIVE_ROWS.forEach((row, ri) => {
      row.forEach((type, ci) => {
        hive.push({
          ri, ci, type,
          left:    Math.round(HIVE_W / 2 - HEX_W / 2 + (ci - (row.length - 1) / 2) * STEP_X),
          top:     HIVE_TOP + ri * STEP_Y,
          label:   HIVE_LABELS[type],
          testo:   flags[`hive_${ri}_${ci}_testo`] ?? "",
          checked: !!flags[`hive_${ri}_${ci}_checked`],
        });
      });
    });
    return hive;
  }

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    const flags = this._f();
    return { ...ctx, actor: this.document, flags, hive: this._buildHive(flags) };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this._activateListeners();
  }

  _activateListeners() {
    const el = this.element;

    el.querySelector(".nte-name")?.addEventListener("change", async ev => {
      await this.document.update({ name: ev.currentTarget.value });
    });

    el.querySelector(".nte-avatar")?.addEventListener("click", () => {
      const FP = foundry.applications.apps.FilePicker.implementation;
      new FP({
        type:     "image",
        current:  this.document.img,
        callback: async path => { await this.document.update({ img: path }); },
      }).browse();
    });

    el.querySelectorAll("input[data-flag]:not([type=checkbox]), textarea[data-flag]").forEach(f => {
      f.addEventListener("change", ev => this._setFlag(ev.currentTarget.dataset.flag, ev.currentTarget.value));
    });

    el.querySelectorAll("input[type=checkbox][data-flag]").forEach(f => {
      f.addEventListener("change", ev => this._setFlag(ev.currentTarget.dataset.flag, ev.currentTarget.checked));
    });

    el.querySelectorAll(".nte-hex-text[data-ri][data-ci]").forEach(f => {
      f.addEventListener("change", ev => {
        const { ri, ci } = ev.currentTarget.dataset;
        return this.document.setFlag(MODULE, `hive_${ri}_${ci}_testo`, ev.currentTarget.value);
      });
    });

    el.querySelectorAll(".nte-dot[data-ri][data-ci]").forEach(dot => {
      dot.addEventListener("click", ev => {
        const { ri, ci } = ev.currentTarget.dataset;
        const key = `hive_${ri}_${ci}_checked`;
        return this.document.setFlag(MODULE, key, !this.document.getFlag(MODULE, key));
      });
    });
  }

  async _setFlag(key, value) {
    const parts = key.split(".");
    if (parts.length === 1) return this.document.setFlag(MODULE, key, value);
    const arr = foundry.utils.deepClone(this._f()[parts[0]] ?? []);
    const idx = Number(parts[1]);
    if (parts.length === 2) arr[idx] = value;
    else if (parts.length === 3) arr[idx] = { ...(arr[idx] ?? {}), [parts[2]]: value };
    else return;
    return this.document.setFlag(MODULE, parts[0], arr);
  }

  static #openTokenBag(event, target) {
    this.#tokenBag ??= new NTETokenBagApp(this.document);
    this.#tokenBag.render({ force: true });
  }
}

// ====================================================================
// SACCHETTO TOKEN
// Si pesca dal sacchetto mescolato; i rimanenti vengono inviati al GM
// via socket: il messaggio di chat lo crea il client del GM.
// ====================================================================

const TOKEN_LABELS = { speranza: "Speranza", dolore: "Dolore", paura: "Paura" };
const TOKEN_TYPES  = Object.keys(TOKEN_LABELS);
const esc = s => Handlebars.Utils.escapeExpression(s);

function remainingText(rem) {
  const total = TOKEN_TYPES.reduce((n, t) => n + rem[t], 0);
  const parts = TOKEN_TYPES.map(t => `${TOKEN_LABELS[t]} ${rem[t]}`).join(", ");
  return `${parts} (totale ${total})`;
}

/** Crea il messaggio per il GM (solo whisper ai GM). Eseguito sul client GM. */
async function postRemainingToGM({ actorName, userName, drawn, remaining }) {
  const estratti = drawn.length ? drawn.map(t => TOKEN_LABELS[t]).join(", ") : "nessuno";
  await ChatMessage.create({
    whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
    speaker: { alias: "Sacchetto" },
    content: `<div class="nte-chat-draw"><b>${esc(actorName)}</b> (${esc(userName)}) ha estratto: ${estratti}.<br>Rimasti: ${remainingText(remaining)}</div>`,
  });
}

export function registerTokenBagSocket() {
  game.socket.on(SOCKET, async data => {
    if (data?.type !== "tokenBagRemaining") return;
    if (game.user !== game.users.activeGM) return;   // risponde un solo GM
    await postRemainingToGM(data);
  });
}

function sendRemainingToGM(data) {
  if (game.user.isGM) return postRemainingToGM(data);
  game.socket.emit(SOCKET, { type: "tokenBagRemaining", ...data });
}

export class NTETokenBagApp extends ApplicationV2 {

  static DEFAULT_OPTIONS = {
    classes:  ["nte-token-bag-window"],
    window:   { resizable: false },
    position: { width: 360, height: "auto" },
  };

  _lastDraw = [];
  _count = 1;

  constructor(actor, options = {}) {
    super({ id: `nte-token-bag-${actor.id}`, ...options });
    this._actor = actor;
  }

  get title() { return `Sacchetto — ${this._actor.name}`; }

  _tokens() {
    const t = this._actor.flags?.[MODULE]?.tokens ?? {};
    return { speranza: t.speranza ?? 0, dolore: t.dolore ?? 0, paura: t.paura ?? 0 };
  }

  async _renderHTML(context, options) {
    const tk = this._tokens();
    const total = tk.speranza + tk.dolore + tk.paura;
    const last = this._lastDraw;
    return `<div class="nte-tokenbag">
      <div class="nte-tb-counts">
        ${TOKEN_TYPES.map(tipo => `
        <div class="nte-tb-count ${tipo}">
          <span class="nte-tb-label">✦ ${TOKEN_LABELS[tipo]}</span>
          <div class="nte-tb-controls">
            <button type="button" class="nte-tb-btn" data-action="remove" data-type="${tipo}">−</button>
            <span class="nte-tb-num">${tk[tipo]}</span>
            <button type="button" class="nte-tb-btn" data-action="add" data-type="${tipo}">+</button>
          </div>
        </div>`).join("")}
      </div>
      <div class="nte-tb-total">
        Totale: <strong>${total}</strong>
        <button type="button" class="nte-tb-random">+ Casuale</button>
      </div>
      <div class="nte-tb-draw-area">
        <div class="nte-tb-draw-row">
          <label>Quanti
            <input type="number" class="nte-tb-qty" min="1" max="${Math.max(total, 1)}" value="${Math.min(this._count, Math.max(total, 1))}" />
          </label>
          <button type="button" class="nte-tb-draw-btn" ${total === 0 ? "disabled" : ""}>🎲 Estrai</button>
        </div>
        <div class="nte-tb-result">
          ${last.map(t => `<span class="nte-tb-drawn ${t}">✦ ${TOKEN_LABELS[t]}</span>`).join(" ")}
        </div>
      </div>
    </div>`;
  }

  /** ApplicationV2 non ha un _replaceHTML di default. */
  _replaceHTML(result, content, options) {
    content.innerHTML = result;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;
    el.querySelectorAll(".nte-tb-btn").forEach(b => b.addEventListener("click", this._onAdjust.bind(this)));
    el.querySelector(".nte-tb-random")?.addEventListener("click", this._onAddRandom.bind(this));
    el.querySelector(".nte-tb-draw-btn")?.addEventListener("click", this._onDraw.bind(this));
    el.querySelector(".nte-tb-qty")?.addEventListener("change", ev => {
      this._count = Math.max(1, Number(ev.currentTarget.value) || 1);
    });
  }

  async _onAdjust(ev) {
    const { type, action } = ev.currentTarget.dataset;
    const tk = this._tokens();
    tk[type] = action === "add" ? tk[type] + 1 : Math.max(0, tk[type] - 1);
    await this._actor.setFlag(MODULE, "tokens", tk);
    this.render();
  }

  async _onAddRandom() {
    const tk = this._tokens();
    tk[TOKEN_TYPES[Math.floor(Math.random() * TOKEN_TYPES.length)]]++;
    await this._actor.setFlag(MODULE, "tokens", tk);
    this.render();
  }

  /** Costruisce il sacchetto mescolato (Fisher-Yates). */
  _buildBag(tk) {
    const bag = TOKEN_TYPES.flatMap(t => Array(tk[t]).fill(t));
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    return bag;
  }

  async _onDraw() {
    const qty = this.element.querySelector(".nte-tb-qty");
    this._count = Math.max(1, Number(qty?.value) || 1);

    const tk = this._tokens();
    const bag = this._buildBag(tk);
    if (!bag.length) {
      ui.notifications.warn("Il sacchetto è vuoto.");
      return;
    }

    const drawn = [];
    for (let i = 0; i < this._count && bag.length; i++) drawn.push(bag.pop());
    for (const t of drawn) tk[t] = Math.max(0, tk[t] - 1);

    await this._actor.setFlag(MODULE, "tokens", tk);
    this._lastDraw = drawn;

    // Chat pubblica: cosa è stato estratto
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this._actor }),
      content: `<div class="nte-chat-draw"><b>${esc(this._actor.name)}</b> estrae:<br>${
        drawn.map(t => `<span class="nte-chat-token ${t}">✦ ${TOKEN_LABELS[t]}</span>`).join(" ")
      }</div>`,
    });

    // Rimanenti: solo al GM, via socket
    sendRemainingToGM({
      actorName: this._actor.name,
      userName:  game.user.name,
      drawn,
      remaining: { ...tk },
    });

    this.render();
  }
}
