import { For, Show } from "solid-js";
import { fmtMl } from "./format";
import { CHEVRON_RIGHT } from "./glyphs";
import { Glyph, Icon } from "./Icon";
import { Sheet } from "./Sheet";
import { closeAllLayers, drink, openLayer, selectedTypeId, selectedVolumeId, setPick, snap } from "./store";

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
      <Glyph path={CHEVRON_RIGHT} />
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
          if (await drink()) closeAllLayers();
        }}
      >
        + DRINK {volume() ? `${fmtMl(volume()!.ml)} ml` : ""}
      </button>
    </Sheet>
  );
};
