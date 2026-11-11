import { onMount, Show, untrack } from "solid-js";
import { fmtMl, hhmm } from "./format";
import { Sheet } from "./Sheet";
import { closeLayer, deleteLogWithUndo, replaceTopLayer, snap } from "./store";

export default function LogMenu(p: { logId: number }) {
  const log = untrack(() => snap()?.todayLogs.find((l) => l.id === p.logId));
  onMount(() => log || closeLayer());

  return (
    <Show when={log}>
      {(l) => {
        const label = snap()!.types.find((t) => t.id === l().typeId)?.label ?? "";
        return (
          <Sheet title={`${hhmm(l().atMs)} ${label} ${fmtMl(l().ml)} ml`}>
            <div class="menu">
              <button class="btn" onClick={() => replaceTopLayer({ kind: "logEditor", logId: l().id })}>
                Edit
              </button>
              <button class="btn danger" onClick={() => void deleteLogWithUndo(l())}>
                Delete
              </button>
            </div>
          </Sheet>
        );
      }}
    </Show>
  );
}
