import { onCleanup, onMount, Show, createSignal } from "solid-js";
import * as api from "./api";
import { sameDay } from "./format";
import LogEditor from "./LogEditor";
import Main from "./Main";
import { PickerSheet } from "./PickerList";
import { Settings } from "./settings-lazy";
import {
  dismissToast,
  layerOf,
  layers,
  refresh,
  refreshReminderInfo,
  setNow,
  setSnap,
  showToast,
  snap,
  toast,
} from "./store";

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export default function App() {
  const [failed, setFailed] = createSignal(false);
  let drawn = false;

  const start = async () => {
    try {
      setSnap(await api.snapshot());
      setFailed(false);
    } catch (e) {
      setFailed(true);
      return showToast(e instanceof Error ? e.message : String(e));
    }
    await nextFrame();
    await nextFrame();
    await api.fullyDrawn().catch(() => {});
    drawn = true;
    void refreshReminderInfo();
    api.onChanged(setSnap).catch((e) => showToast(String(e)));
  };

  onMount(() => {
    void start();

    const tick = () => {
      setNow(Date.now());
      const s = snap();
      if (s && !sameDay(s.dayStartMs, Date.now())) void refresh();
    };
    const timer = setInterval(tick, 60_000);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      setNow(Date.now());
      void refresh();
      if (drawn) void refreshReminderInfo();
    };
    document.addEventListener("visibilitychange", onVisible);
    onCleanup(() => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    });
  });

  return (
    <>
      <Show
        when={snap()}
        fallback={
          <Show when={failed()}>
            <div class="failed">
              <p>Couldn't load your drinks.</p>
              <button class="btn primary" onClick={() => void start()}>
                Retry
              </button>
            </div>
          </Show>
        }
      >
        <Main />
      </Show>

      <Show when={layerOf("settings")}>
        {(l) => <Settings focus={l().focus} />}
      </Show>
      <Show when={layerOf("picker")}>
        <PickerSheet />
      </Show>
      <Show when={layerOf("logEditor")}>{(l) => <LogEditor logId={l().logId} />}</Show>

      <Show when={toast()} keyed>
        {(t) => (
          <div class="toast" classList={{ lifted: layers().length === 0 }} role="status">
            <span>{t.text}</span>
            <Show when={t.undo}>
              <button
                onClick={() => {
                  dismissToast();
                  t.undo!();
                }}
              >
                Undo
              </button>
            </Show>
          </div>
        )}
      </Show>
    </>
  );
}
