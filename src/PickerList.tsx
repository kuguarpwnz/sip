import { createSignal, For, Show } from "solid-js";
import { fmtMl } from "./format";
import { Glyph, Icon } from "./Icon";
import { Sheet } from "./Sheet";
import { closeLayer, drink, openLayer, selectedTypeId, selectedVolumeId, setPick, snap } from "./store";

const KEY = "sip.picker";
const CHEVRON = '<path d="M9 6l6 6l-6 6"/>';

const read = () => {
  try {
    return localStorage.getItem(KEY) === "list";
  } catch {
    return false;
  }
};

const [listMode, setListMode] = createSignal(read());

export const pickFromList = listMode;

export const setPickFromList = (on: boolean) => {
  setListMode(on);
  try {
    if (on) localStorage.setItem(KEY, "list");
    else localStorage.removeItem(KEY);
  } catch {}
};

export const PickerButton = () => {
  const type = () => snap()!.types.find((t) => t.id === selectedTypeId());
  const volume = () => snap()!.volumes.find((v) => v.id === selectedVolumeId());
  return (
    <button
      class="picker-btn"
      aria-haspopup="dialog"
      aria-label={`Choose drink: ${type()?.label ?? ""}, ${volume() ? fmtMl(volume()!.ml) : ""} ml`}
      onClick={() => openLayer({ kind: "picker" })}
    >
      <Show when={type()}>
        {(t) => (
          <span>
            <Icon name={t().icon} />
            {t().label}
          </span>
        )}
      </Show>
      <Show when={volume()}>
        {(v) => (
          <span>
            <Icon name={v().icon} />
            {fmtMl(v().ml)} ml
          </span>
        )}
      </Show>
      <Glyph path={CHEVRON} />
    </button>
  );
};

export const PickerSheet = () => {
  const volume = () => snap()!.volumes.find((v) => v.id === selectedVolumeId());
  return (
    <Sheet title="Choose drink">
      <div class="pick-cols">
        <div class="pick-col" role="radiogroup" aria-label="Drink type">
          <For each={snap()!.types.filter((t) => !t.archived)}>
            {(t) => (
              <button
                role="radio"
                aria-checked={t.id === selectedTypeId()}
                classList={{ on: t.id === selectedTypeId() }}
                onClick={() => setPick((p) => ({ ...p, typeId: t.id }))}
              >
                <Icon name={t.icon} />
                {t.label}
              </button>
            )}
          </For>
        </div>
        <div class="pick-col" role="radiogroup" aria-label="Volume">
          <For each={snap()!.volumes}>
            {(v) => (
              <button
                role="radio"
                aria-checked={v.id === selectedVolumeId()}
                classList={{ on: v.id === selectedVolumeId() }}
                onClick={() => setPick((p) => ({ ...p, volumeId: v.id }))}
              >
                <Icon name={v.icon} />
                {fmtMl(v.ml)} ml
              </button>
            )}
          </For>
        </div>
      </div>
      <button
        class="drink"
        onClick={async () => {
          if (await drink()) closeLayer();
        }}
      >
        + DRINK {volume() ? `${fmtMl(volume()!.ml)} ml` : ""}
      </button>
    </Sheet>
  );
};
