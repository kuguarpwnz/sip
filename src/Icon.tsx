import { ICONS, type IconKey } from "./icons.gen";

export const Icon = (p: { name: string }) => (
  <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" innerHTML={ICONS[p.name as IconKey] ?? ICONS.droplet} />
);

export const Glyph = (p: { path: string }) => (
  <svg class="glyph" viewBox="0 0 24 24" aria-hidden="true" innerHTML={p.path} />
);
