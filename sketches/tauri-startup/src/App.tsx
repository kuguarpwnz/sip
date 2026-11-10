import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import type { Snapshot } from "./model";

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const fmtTime = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
const fmtMl = (ml: number) => ml.toLocaleString("sv-SE");

export default function App() {
  const [snap, setSnap] = createSignal<Snapshot>();
  const [typeId, setTypeId] = createSignal(0);
  const [volumeId, setVolumeId] = createSignal(0);

  const total = createMemo(() => snap()?.todayLogs.reduce((sum, l) => sum + l.ml, 0) ?? 0);
  const goal = () => snap()?.settings.dailyGoalMl ?? 1;
  const percent = () => Math.round((total() / goal()) * 100);
  const volume = () => snap()?.volumes.find((v) => v.id === volumeId());
  const typeLabel = (id: number) => snap()?.types.find((t) => t.id === id)?.label ?? "";

  onMount(async () => {
    console.log(`sip:mounted t=${Math.round(performance.now())}ms`);
    const s = await invoke<Snapshot>("plugin:sip-store|snapshot");
    console.log(`sip:snapshot t=${Math.round(performance.now())}ms`);
    setTypeId(s.settings.lastTypeId ?? s.types[0].id);
    setVolumeId(s.settings.lastVolumeId ?? s.volumes[0].id);
    setSnap(s);
    await nextFrame();
    await nextFrame();
    console.log(`sip:painted t=${Math.round(performance.now())}ms`);
    await invoke("plugin:sip-store|fully_drawn");
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
          <button class="drink">+ DRINK {volume()?.ml} ml</button>
        </main>
      )}
    </Show>
  );
}
