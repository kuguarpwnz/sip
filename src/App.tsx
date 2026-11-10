import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import * as api from "./api";

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const fmtTime = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
const fmtMl = (ml: number) => ml.toLocaleString("sv-SE");

export default function App() {
  const [snap, setSnap] = createSignal<api.Snapshot>();
  const [typeId, setTypeId] = createSignal(0);
  const [volumeId, setVolumeId] = createSignal(0);

  const total = createMemo(() => snap()?.todayLogs.reduce((sum, l) => sum + l.ml, 0) ?? 0);
  const goal = () => snap()?.settings.dailyGoalMl ?? 1;
  const percent = () => Math.round((total() / goal()) * 100);
  const volume = () => snap()?.volumes.find((v) => v.id === volumeId());
  const typeLabel = (id: number) => snap()?.types.find((t) => t.id === id)?.label ?? "";

  const show = (s: api.Snapshot) => {
    setTypeId(s.settings.lastTypeId ?? s.types[0].id);
    setVolumeId(s.settings.lastVolumeId ?? s.volumes[0].id);
    setSnap(s);
  };

  const drink = async () => {
    show(await api.logDrink(volumeId(), typeId()));
    void api.haptic();
  };

  onMount(async () => {
    show(await api.snapshot());
    await nextFrame();
    await nextFrame();
    await api.fullyDrawn();
    await api.onChanged(show);
  });

  return (
    <Show when={snap()}>
      {(s) => (
        <main>
          <header>
            <h1>Today</h1>
          </header>
          <section class="summary">
            <div class="ring" style={{ "--pct": `${Math.min(percent(), 100)}%` }}>
              <span>{percent()}%</span>
            </div>
            <p class="total">
              {fmtMl(total())} / {fmtMl(goal())} ml
            </p>
          </section>
          <ul class="logs">
            <For each={s().todayLogs}>
              {(l) => (
                <li>
                  <time>{fmtTime(l.atMs)}</time>
                  <span class="what">{typeLabel(l.typeId)}</span>
                  <span class="ml">{l.ml} ml</span>
                </li>
              )}
            </For>
          </ul>
          <section class="chips">
            <For each={s().types.filter((t) => !t.archived)}>
              {(t) => (
                <button classList={{ on: t.id === typeId() }} onClick={() => setTypeId(t.id)}>
                  {t.label}
                </button>
              )}
            </For>
          </section>
          <section class="chips">
            <For each={s().volumes}>
              {(v) => (
                <button classList={{ on: v.id === volumeId() }} onClick={() => setVolumeId(v.id)}>
                  {v.ml}
                </button>
              )}
            </For>
          </section>
          <button class="drink" onClick={drink}>+ DRINK {volume()?.ml} ml</button>
        </main>
      )}
    </Show>
  );
}
