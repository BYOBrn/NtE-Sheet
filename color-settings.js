/**
 * Not the End — Personalizzazione colori
 * Salva i colori nelle game settings e li inietta come CSS vars
 */

const MODULE = "not-the-end";

export const COLOR_SETTINGS = [
  { key: "colorHexA",      name: "Sfondo Abilità",      default: "#ffffff" },
  { key: "colorHexQ",      name: "Sfondo Qualità",      default: "#d4ebd4" },
  { key: "colorHexArc",    name: "Sfondo Archetipo",    default: "#ebd4d4" },
  { key: "colorStrokeA",   name: "Bordo Abilità",   default: "#888888" },
  { key: "colorStrokeQ",   name: "Bordo Qualità",   default: "#559955" },
  { key: "colorStrokeArc", name: "Bordo Archetipo", default: "#aa5555" },
  { key: "colorBg",        name: "Sfondo scheda",        default: "#f4f0eb" },
  { key: "colorBgLight",   name: "Sfondo header/footer",   default: "#e8e2d9" },
  { key: "colorGold",      name: "Colore accento (oro)",      default: "#8a6a00" },
  { key: "colorText",      name: "Testo principale",      default: "#1a1a1a" },
];

// Setting key → variabile CSS
const CSS_VAR_MAP = {
  colorHexA:      "--nte-hex-a",
  colorHexQ:      "--nte-hex-q",
  colorHexArc:    "--nte-hex-arc",
  colorStrokeA:   "--nte-hex-stroke",
  colorStrokeQ:   "--nte-hex-q-stroke",
  colorStrokeArc: "--nte-hex-arc-stroke",
  colorBg:        "--nte-bg",
  colorBgLight:   "--nte-bg-light",
  colorGold:      "--nte-gold",
  colorText:      "--nte-text",
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function setVar(key, value) {
  const cssVar = CSS_VAR_MAP[key];
  if (cssVar) document.documentElement.style.setProperty(cssVar, value);
}

export function registerColorSettings() {
  for (const s of COLOR_SETTINGS) {
    game.settings.register(MODULE, s.key, {
      name:     s.name,
      scope:    "world",
      config:   false,   // la UI la gestiamo noi
      type:     String,
      default:  s.default,
      onChange: () => applyColors(),
    });
  }
}

export function applyColors() {
  for (const s of COLOR_SETTINGS) setVar(s.key, game.settings.get(MODULE, s.key));
}

// ====================================================================
// Dialog personalizzazione colori
// ====================================================================

export class NTEColorDialog extends foundry.applications.api.ApplicationV2 {

  static DEFAULT_OPTIONS = {
    id:       "nte-color-dialog",
    classes:  ["nte-color-dialog"],
    window:   { title: "Colori scheda", resizable: false },
    position: { width: 380, height: "auto" },
  };

  async _renderHTML(context, options) {
    const rows = COLOR_SETTINGS.map(s => {
      const val = game.settings.get(MODULE, s.key);
      return `
      <div class="nte-color-row">
        <label>${s.name}</label>
        <div class="nte-color-inputs">
          <input type="color" data-key="${s.key}" value="${val}" />
          <input type="text"  data-key="${s.key}" data-text value="${val}" maxlength="7" />
        </div>
      </div>`;
    }).join("");

    return `
    <div class="nte-color-settings">
      <div class="nte-color-list">${rows}</div>
      <div class="nte-color-footer">
        <button type="button" id="nte-color-reset">Ripristina default</button>
        <button type="button" id="nte-color-save" class="nte-btn-primary">Salva</button>
      </div>
    </div>`;
  }

  /** ApplicationV2 non ha un _replaceHTML di default: lo inseriamo noi. */
  _replaceHTML(result, content, options) {
    content.innerHTML = result;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;

    // Sync color picker ↔ text input + anteprima live
    el.querySelectorAll("input[type=color]").forEach(picker => {
      const key  = picker.dataset.key;
      const text = el.querySelector(`input[data-key="${key}"][data-text]`);

      picker.addEventListener("input", () => {
        text.value = picker.value;
        setVar(key, picker.value);
      });

      text.addEventListener("input", () => {
        if (!HEX_RE.test(text.value)) return;
        picker.value = text.value;
        setVar(key, text.value);
      });
    });

    // Salva
    el.querySelector("#nte-color-save")?.addEventListener("click", async () => {
      for (const s of COLOR_SETTINGS) {
        const picker = el.querySelector(`input[type=color][data-key="${s.key}"]`);
        if (picker) await game.settings.set(MODULE, s.key, picker.value);
      }
      ui.notifications.info("Colori salvati.");
      this.close();
    });

    // Reset
    el.querySelector("#nte-color-reset")?.addEventListener("click", async () => {
      for (const s of COLOR_SETTINGS) {
        await game.settings.set(MODULE, s.key, s.default);
        const picker = el.querySelector(`input[type=color][data-key="${s.key}"]`);
        const text   = el.querySelector(`input[data-key="${s.key}"][data-text]`);
        if (picker) picker.value = s.default;
        if (text)   text.value   = s.default;
        setVar(s.key, s.default);
      }
      ui.notifications.info("Colori ripristinati.");
    });
  }

  /** Chiudendo senza salvare, annulla l'anteprima live. */
  _onClose(options) {
    super._onClose(options);
    applyColors();
  }
}
