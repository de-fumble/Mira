/** 42000 → "42 s", 95000 → "1 min 35 s". */
export const formatSeconds = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
};
