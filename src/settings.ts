import { PRESETS, AISettings, loadAISettings, saveAISettings, complete } from "./ai";
import type { Store } from "./storage";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Modal for AI provider settings. Resolves when closed. */
export function openAISettings(store: Store, toast: (m: string) => void): Promise<void> {
  return new Promise((resolve) => {
    const cur = loadAISettings();
    const wrap = document.createElement("div");
    wrap.className = "modal";
    wrap.innerHTML = `
      <form class="modal-box" autocomplete="off">
        <h2>AI Assist</h2>
        <p class="muted">Use your own AI provider. Your key is stored only on this computer, and the map text is sent only when you run an AI command.</p>
        <label>Provider
          <select name="preset">${PRESETS.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select>
        </label>
        <p class="muted hint" data-hint></p>
        <label>API URL <input name="baseUrl" spellcheck="false"></label>
        <label>Model <input name="model" spellcheck="false" placeholder="model name"></label>
        <label>API key <input name="apiKey" type="password" spellcheck="false" placeholder="not needed for local models"></label>
        <label>Answer language <input name="language" spellcheck="false" placeholder="same as the map"></label>
        <p class="status" data-status></p>
        <div class="row">
          <button type="button" data-act="remove" class="link-btn">Turn off AI</button>
          <span style="flex:1"></span>
          <button type="button" data-act="test">Test</button>
          <button type="button" data-act="cancel">Cancel</button>
          <button type="submit" class="primary">Save</button>
        </div>
      </form>`;
    document.body.append(wrap);
    const form = wrap.querySelector("form")!;
    const f = (n: string) => form.elements.namedItem(n) as HTMLInputElement & HTMLSelectElement;
    const status = wrap.querySelector<HTMLElement>("[data-status]")!;
    const hint = wrap.querySelector<HTMLElement>("[data-hint]")!;
    const fill = (presetId: string, keepValues: boolean) => {
      const p = PRESETS.find((x) => x.id === presetId) ?? PRESETS[0];
      f("preset").value = p.id;
      hint.textContent = p.hint;
      if (!keepValues) {
        f("baseUrl").value = p.baseUrl;
        f("model").value = p.model;
      }
    };
    if (cur) {
      fill(cur.preset, true);
      f("baseUrl").value = cur.baseUrl;
      f("model").value = cur.model;
      f("apiKey").value = cur.apiKey;
      f("language").value = cur.language;
    } else fill("anthropic", false);
    f("preset").addEventListener("change", () => fill(f("preset").value, false));

    const read = (): AISettings => {
      const p = PRESETS.find((x) => x.id === f("preset").value) ?? PRESETS[0];
      return { preset: p.id, kind: p.kind, baseUrl: f("baseUrl").value.trim(), model: f("model").value.trim(), apiKey: f("apiKey").value.trim(), language: f("language").value.trim() };
    };
    const check = (s: AISettings) => {
      const p = PRESETS.find((x) => x.id === s.preset)!;
      if (!/^https?:\/\//.test(s.baseUrl)) return "Enter the API URL (starts with http:// or https://).";
      if (!s.model) return "Enter a model name.";
      if (p.needsKey && !s.apiKey) return "This provider needs an API key.";
      return "";
    };
    const close = () => {
      wrap.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else e.stopPropagation(); // keep map shortcuts out of the form
    };
    document.addEventListener("keydown", onKey, true);
    wrap.addEventListener("mousedown", (e) => e.target === wrap && close());
    wrap.querySelector('[data-act="cancel"]')!.addEventListener("click", close);
    wrap.querySelector('[data-act="remove"]')!.addEventListener("click", () => {
      saveAISettings(null);
      toast("AI Assist turned off");
      close();
    });
    wrap.querySelector('[data-act="test"]')!.addEventListener("click", async () => {
      const s = read();
      const problem = check(s);
      if (problem) return void (status.textContent = problem);
      status.textContent = "Testing…";
      status.className = "status";
      try {
        const out = await complete(store, s, "Reply with exactly: OK", "Say OK.");
        status.textContent = `Works. The model replied: “${out.trim().slice(0, 60)}”`;
        status.className = "status ok";
      } catch (err) {
        status.textContent = "Failed: " + String((err as Error).message ?? err);
        status.className = "status bad";
      }
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const s = read();
      const problem = check(s);
      if (problem) {
        status.textContent = problem;
        status.className = "status bad";
        return;
      }
      saveAISettings(s);
      toast("AI settings saved");
      close();
    });
    setTimeout(() => f("preset").focus(), 0);
  });
}
