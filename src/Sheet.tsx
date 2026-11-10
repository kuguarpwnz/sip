import type { JSX } from "solid-js";
import { closeLayer } from "./store";

export const Sheet = (p: { title: string; children: JSX.Element }) => (
  <div class="scrim" onClick={(e) => e.target === e.currentTarget && closeLayer()}>
    <div class="sheet" role="dialog" aria-label={p.title}>
      <h2>{p.title}</h2>
      {p.children}
    </div>
  </div>
);

export const Field = (p: { label: string; children: JSX.Element }) => (
  <label class="field">
    <span>{p.label}</span>
    {p.children}
  </label>
);
