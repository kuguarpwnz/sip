const THIN = " ";
const pad = (n: number) => (n < 10 ? "0" : "") + n;

export const fmtMl = (ml: number) => String(ml).replace(/\B(?=(\d{3})+(?!\d))/g, THIN);

export const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const ago = (ms: number, now: number) => {
  const min = Math.max(0, Math.floor((now - ms) / 60000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h} h ${min % 60} min ago` : `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
};

export const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

export const whenLabel = (ms: number, now: number) => {
  if (sameDay(ms, now)) return hhmm(ms);
  if (sameDay(ms, now + 86400000)) return `tomorrow ${hhmm(ms)}`;
  const d = new Date(ms);
  return `${d.getDate()}.${d.getMonth() + 1}. ${hhmm(ms)}`;
};
