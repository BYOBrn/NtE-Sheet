/**
 * Not the End — Actor Sheet (DocumentSheetV2, Foundry v13)
 */

const { ApplicationV2, DocumentSheetV2, HandlebarsApplicationMixin } = foundry.applications.api;
const MODULE = "not-the-end";

// Alveare 3-4-5-4-3 = 19 esagoni ('a' abilità, 'q' qualità, 'arc' archetipo)
const HIVE_ROWS = [
  ["a", "q", "a"],
  ["a", "q", "q", "a"],
  ["a", "q", "arc", "q", "a"],
  ["a", "q", "q", "a"],
  ["a", "q", "a"],
];

const HIVE_LABELS = { a: "NTE.Sheet.Abilita", q: "NTE.Sheet.Qualita", arc: "NTE.Sheet.Archetipo" };

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
    // hive_{riga}_{colonna}_testo / _checked: letti on demand, default vuoto
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

  /** @type {NTETokenBagApp|null} */
  #tokenBag = null;

  get title() { return this.document?.name ?? "Not the End"; }

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
          label:   game.i18n.localize(HIVE_LABELS[type]),
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

    // Nome actor
    el.querySelector(".nte-name")?.addEventListener("change", async ev => {
      await this.document.update({ name: ev.currentTarget.value });
    });

    // Avatar — file picker v13
    el.querySelector(".nte-avatar")?.addEventListener("click", () => {
      const FP = foundry.applications.apps.FilePicker.implementation;
      new FP({
        type:     "image",
        current:  this.document.img,
        callback: async path => { await this.document.update({ img: path }); },
      }).browse();
    });

    // Campi text/textarea con data-flag (notazione puntata)
    el.querySelectorAll("input[data-flag]:not([type=checkbox]), textarea[data-flag]").forEach(f => {
      f.addEventListener("change", ev => this._setFlag(ev.currentTarget.dataset.flag, ev.currentTarget.value));
    });

    // Checkbox con data-flag
    el.querySelectorAll("input[type=checkbox][data-flag]").forEach(f => {
      f.addEventListener("change", ev => this._setFlag(ev.currentTarget.dataset.flag, ev.currentTarget.checked));
    });

    // Esagoni: testo
    el.querySelectorAll(".nte-hex-text[data-ri][data-ci]").forEach(f => {
      f.addEventListener("change", ev => {
        const { ri, ci } = ev.currentTarget.dataset;
        return this.document.setFlag(MODULE, `hive_${ri}_${ci}_testo`, ev.currentTarget.value);
      });
    });

    // Esagoni: pallino (toggle)
    el.querySelectorAll(".nte-dot[data-ri][data-ci]").forEach(dot => {
      dot.addEventListener("click", ev => {
        const { ri, ci } = ev.currentTarget.dataset;
        const key = `hive_${ri}_${ci}_checked`;
        const current = !!this.document.getFlag(MODULE, key);
        return this.document.setFlag(MODULE, key, !current);
      });
    });
  }

  async _setFlag(key, value) {
    const parts = key.split(".");
    if (parts.length === 1) {
      return this.document.setFlag(MODULE, key, value);
    }
    const arr = foundry.utils.deepClone(this._f()[parts[0]] ?? []);
    const idx = Number(parts[1]);
    if (parts.length === 2) {
      arr[idx] = value;
    } else if (parts.length === 3) {
      arr[idx] = { ...(arr[idx] ?? {}), [parts[2]]: value };
    } else return;
    return this.document.setFlag(MODULE, parts[0], arr);
  }

  static #openTokenBag(event, target) {
    this.#tokenBag ??= new NTETokenBagApp(this.document);
    this.#tokenBag.render({ force: true });
  }
}

// ====================================================================
// TOKEN BAG
// ====================================================================

export class NTETokenBagApp extends ApplicationV2 {

  static DEFAULT_OPTIONS = {
    classes:  ["nte-token-bag-window"],
    window:   { title: "NTE.Sheet.TokenBag", resizable: false },
    position: { width: 360, height: "auto" },
  };

  _lastDraw = null;

  constructor(actor, options = {}) {
    super({ id: `nte-token-bag-${actor.id}`, ...options });
    this._actor = actor;
  }

  get title() { return `${game.i18n.localize("NTE.Sheet.TokenBag")} — ${this._actor.name}`; }

  _tokens() {
    const t = this._actor.flags?.[MODULE]?.tokens ?? {};
    return { speranza: t.speranza ?? 0, dolore: t.dolore ?? 0, paura: t.paura ?? 0 };
  }

  _label(t) {
    const keys = { speranza: "NTE.Tokens.Speranza", dolore: "NTE.Tokens.Dolore", paura: "NTE.Tokens.Paura" };
    return keys[t] ? game.i18n.localize(keys[t]) : t;
  }

  async _renderHTML(context, options) {
    const tk = this._tokens();
    const total = tk.speranza + tk.dolore + tk.paura;
    const last = this._lastDraw;
    return `<div class="nte-tokenbag">
      <div class="nte-tb-counts">
        ${["speranza", "dolore", "paura"].map(tipo => `
        <div class="nte-tb-count ${tipo}">
          <span class="nte-tb-label">✦ ${this._label(tipo)}</span>
          <div class="nte-tb-controls">
            <button type="button" class="nte-tb-btn" data-action="remove" data-type="${tipo}">−</button>
            <span class="nte-tb-num">${tk[tipo]}</span>
            <button type="button" class="nte-tb-btn" data-action="add" data-type="${tipo}">+</button>
          </div>
        </div>`).join("")}
      </div>
      <div class="nte-tb-total">${game.i18n.localize("NTE.Tokens.Total")}: <strong>${total}</strong></div>
      <div class="nte-tb-draw-area">
        <button type="button" class="nte-tb-draw-btn" data-action="draw" ${total === 0 ? "disabled" : ""}>🎲 ${game.i18n.localize("NTE.Tokens.Draw")}</button>
        <div class="nte-tb-result ${last ?? ""}">${last ? game.i18n.format("NTE.Tokens.Drawn", { token: this._label(last) }) : ""}</div>
      </div>
    </div>`;
  }

  /** ApplicationV2 non ha un _replaceHTML di default: lo inseriamo noi. */
  _replaceHTML(result, content, options) {
    content.innerHTML = result;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelectorAll(".nte-tb-btn").forEach(b => b.addEventListener("click", this._onAdjust.bind(this)));
    this.element.querySelector(".nte-tb-draw-btn")?.addEventListener("click", this._onDraw.bind(this));
  }

  async _onAdjust(ev) {
    const { type, action } = ev.currentTarget.dataset;
    const tk = this._tokens();
    tk[type] = action === "add" ? tk[type] + 1 : Math.max(0, tk[type] - 1);
    await this._actor.setFlag(MODULE, "tokens", tk);
    this.render();
  }

  async _onDraw() {
    const tk = this._tokens();
    const bag = this._buildBag(tk);
    if (!bag.length) return;
    const drawn = bag[0];
    tk[drawn] = Math.max(0, tk[drawn] - 1);
    await this._actor.setFlag(MODULE, "tokens", tk);
    this._lastDraw = drawn;

    const name = Handlebars.Utils.escapeExpression(this._actor.name);
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this._actor }),
      content: `<div class="nte-chat-draw"><b>${game.i18n.format("NTE.Tokens.ChatDraws", { name })}</b><br><span class="nte-chat-token ${drawn}">✦ ${this._label(drawn)}</span></div>`,
    });
    this.render();
  }

  _buildBag(tk) {
    const bag = [
      ...Array(tk.speranza).fill("speranza"),
      ...Array(tk.dolore).fill("dolore"),
      ...Array(tk.paura).fill("paura"),
    ];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    return bag;
  }
}
