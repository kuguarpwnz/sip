import { createSignal, For, onMount, Show, untrack } from "solid-js";
import * as api from "./api";
import { hhmm } from "./format";
import { Icon } from "./Icon";
import { Field, Sheet } from "./Sheet";
import { closeLayer, deleteLogWithUndo, run, showToast, snap } from "./store";

export default function LogEditor(p: { logId: number }) {
  const log = untrack(() => snap()?.todayLogs.find((l) => l.id === p.logId));
  onMount(() => log || closeLayer());

  return (
    <Show when={log}>
      {(l) => {
        const [ml, setMl] = createSignal(String(l().ml));
        const [typeId, setTypeId] = createSignal(l().typeId);
        const [time, setTime] = createSignal(hhmm(l().atMs));
        const types = () => snap()!.types.filter((t) => !t.archived || t.id === l().typeId);
        
        const save = async () => {
          const amount = Math.round(Number(ml()));
          if (!ml() || !Number.isFinite(amount)) return showToast("Enter the amount in ml");
          let atMs = l().atMs;
          if (time() && time() !== hhmm(atMs)) {
            const [h, m] = time().split(":").map(Number);
            const d = new Date(atMs);
            d.setHours(h, m, 0, 0);
            atMs = d.getTime();
          }
          if (await run(() => api.updateLog({ id: l().id, atMs, ml: amount, typeId: typeId() }))) closeLayer();
        };

        return (
          <Sheet title="Edit drink">
            <div class="row2">
              <Field label="Amount (ml)">
                <input type="number" inputmode="numeric" min="1" value={ml()} onInput={(e) => setMl(e.currentTarget.value)} />
              </Field>
              <Field label="Time">
                <input type="time" value={time()} onInput={(e) => setTime(e.currentTarget.value)} />
              </Field>
            </div>
            <div class="chips wrap" role="radiogroup" aria-label="Drink type">
              <For each={types()}>
                {(t) => (
                  <button
                    role="radio"
                    aria-checked={t.id === typeId()}
                    classList={{ on: t.id === typeId() }}
                    onClick={() => setTypeId(t.id)}
                  >
                    <Icon name={t.icon} />
                    {t.label}
                  </button>
                )}
              </For>
            </div>
            <div class="actions">
              <button class="btn danger" onClick={() => void deleteLogWithUndo(l())}>
                Delete
              </button>
              <button class="btn primary" onClick={save}>
                Save
              </button>
            </div>
          </Sheet>
        );
      }}
    </Show>
  );
}
