import { createSignal, For, untrack } from "solid-js";
import * as api from "./api";
import { Icon } from "./Icon";
import { ICON_KEYS, type IconKey } from "./icons.gen";
import { Field, Sheet } from "./Sheet";
import { closeLayer, run, showToast, snap } from "./store";

export default function ItemSheet(p: { kind: "volume" | "type"; id: number | null }) {
  const isVolume = p.kind === "volume";
  const current = untrack(() => {
    const s = snap()!;
    return p.id === null ? undefined : isVolume ? s.volumes.find((v) => v.id === p.id) : s.types.find((t) => t.id === p.id);
  });
  const [ml, setMl] = createSignal(String(current && "ml" in current ? current.ml : 250));
  const [label, setLabel] = createSignal(current?.label ?? "");
  const [waterPct, setWaterPct] = createSignal(String(current && "waterPct" in current ? current.waterPct : 100));
  const [icon, setIcon] = createSignal<IconKey>(current?.icon ?? (isVolume ? "glass" : "droplet"));

  const save = async () => {
    const id = p.id ?? undefined;
    const text = label().trim();
    let command: () => Promise<api.Snapshot>;
    if (isVolume) {
      const amount = Math.round(Number(ml()));
      if (!ml() || !Number.isFinite(amount)) return showToast("Enter the amount in ml");
      command = () => api.saveVolume({ id, ml: amount, label: text, icon: icon() });
    } else {
      const pct = Number(waterPct());
      if (!waterPct() || !Number.isInteger(pct) || pct < 0 || pct > 100) return showToast("Water content must be 0 to 100%");
      command = () => api.saveType({ id, label: text, icon: icon(), waterPct: pct });
    }
    if (await run(command)) closeLayer();
  };

  return (
    <Sheet title={`${p.id === null ? "Add" : "Edit"} ${p.kind === "volume" ? "volume" : "drink type"}`}>
      {isVolume && (
        <Field label="Amount (ml)">
          <input type="number" inputmode="numeric" min="10" max="3000" value={ml()} onInput={(e) => setMl(e.currentTarget.value)} />
        </Field>
      )}
      <Field label={isVolume ? "Label (optional)" : "Label"}>
        <input type="text" maxlength="24" value={label()} onInput={(e) => setLabel(e.currentTarget.value)} />
      </Field>
      {!isVolume && (
        <>
          <Field label="Water content (%)">
            <input type="number" inputmode="numeric" min="0" max="100" value={waterPct()} onInput={(e) => setWaterPct(e.currentTarget.value)} />
          </Field>
          <small class="hint">Applies to drinks you log from now on.</small>
        </>
      )}
      <div class="icon-grid" role="radiogroup" aria-label="Icon">
        <For each={ICON_KEYS}>
          {(key) => (
            <button role="radio" aria-checked={key === icon()} aria-label={key} classList={{ on: key === icon() }} onClick={() => setIcon(key)}>
              <Icon name={key} />
            </button>
          )}
        </For>
      </div>
      <div class="actions">
        <button class="btn primary" onClick={save}>
          Save
        </button>
      </div>
    </Sheet>
  );
}
