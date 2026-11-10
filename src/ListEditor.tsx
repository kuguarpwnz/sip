import { batch, createMemo, createSignal, For, Show } from "solid-js";
import { CHECK, GRIP, PENCIL, PLUS, TRASH } from "./glyphs";
import { Glyph, Icon } from "./Icon";

const ROW_H = 56;

interface Item {
  id: number;
  icon: string;
}

interface Props<T extends Item> {
  title: string;
  items: T[];
  primary: (item: T) => string;
  secondary?: (item: T) => string;
  addLabel: string;
  onReorder: (ids: number[]) => Promise<unknown>;
  onEdit: (id: number) => void;
  onDelete: (id: number) => Promise<unknown>;
  onAdd: () => void;
}

interface Drag {
  id: number;
  from: number;
  to: number;
  dy: number;
}

export function ListEditor<T extends Item>(p: Props<T>) {
  const [drag, setDrag] = createSignal<Drag>();
  const [pending, setPending] = createSignal<number[]>();
  const [armed, setArmed] = createSignal<number>();
  const byId = createMemo(() => new Map(p.items.map((i) => [i.id, i])));
  const order = () => pending() ?? p.items.map((i) => i.id);
  let startY = 0;
  let armTimer: ReturnType<typeof setTimeout> | undefined;

  const shift = (id: number, index: number) => {
    const d = drag();
    if (!d) return 0;
    if (id === d.id) return d.dy;
    if (d.from < d.to && index > d.from && index <= d.to) return -ROW_H;
    if (d.to < d.from && index >= d.to && index < d.from) return ROW_H;
    return 0;
  };

  const down = (e: PointerEvent & { currentTarget: HTMLElement }, id: number, from: number) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    startY = e.clientY;
    setDrag({ id, from, to: from, dy: 0 });
  };

  const move = (e: PointerEvent) => {
    const d = drag();
    if (!d) return;
    const last = order().length - 1;
    const dy = Math.min(Math.max(e.clientY - startY, -d.from * ROW_H), (last - d.from) * ROW_H);
    setDrag({ ...d, dy, to: Math.round(d.from + dy / ROW_H) });
  };

  const up = async () => {
    const d = drag();
    if (!d) return;
    if (d.to === d.from) return setDrag(undefined);
    const ids = order().filter((id) => id !== d.id);
    ids.splice(d.to, 0, d.id);
    batch(() => {
      setPending(ids);
      setDrag(undefined);
    });
    await p.onReorder(ids).finally(() => setPending(undefined));
  };

  const remove = (id: number) => {
    clearTimeout(armTimer);
    if (armed() !== id) {
      setArmed(id);
      armTimer = setTimeout(() => setArmed(undefined), 3000);
      return;
    }
    setArmed(undefined);
    void p.onDelete(id);
  };

  return (
    <section class="group">
      <h2>{p.title}</h2>
      <ul class="list" classList={{ dragging: !!drag() }}>
        <For each={order()}>
          {(id, index) => (
            <Show when={byId().get(id)}>
              {(item) => (
                <li
                  classList={{ lifted: drag()?.id === id }}
                  style={{ transform: `translateY(${shift(id, index())}px)` }}
                >
                  <button
                    class="handle"
                    aria-label={`Reorder ${p.primary(item())}`}
                    onPointerDown={(e) => down(e, id, index())}
                    onPointerMove={move}
                    onPointerUp={up}
                    onPointerCancel={() => setDrag(undefined)}
                  >
                    <Glyph path={GRIP} />
                  </button>
                  <button class="main" onClick={() => p.onEdit(id)}>
                    <Icon name={item().icon} />
                    <span class="t">{p.primary(item())}</span>
                    <Show when={p.secondary?.(item())}>
                      <span class="s">{p.secondary!(item())}</span>
                    </Show>
                  </button>
                  <button class="icon-btn" aria-label={`Edit ${p.primary(item())}`} onClick={() => p.onEdit(id)}>
                    <Glyph path={PENCIL} />
                  </button>
                  <button
                    class="icon-btn"
                    classList={{ armed: armed() === id }}
                    aria-label={armed() === id ? "Confirm delete" : `Delete ${p.primary(item())}`}
                    onClick={() => remove(id)}
                  >
                    <Glyph path={armed() === id ? CHECK : TRASH} />
                  </button>
                </li>
              )}
            </Show>
          )}
        </For>
      </ul>
      <button class="btn add" onClick={p.onAdd}>
        <Glyph path={PLUS} />
        {p.addLabel}
      </button>
    </section>
  );
}
