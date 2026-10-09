// Shared UI colours (until the master palette from the outline is final).
export const UI = {
  void: 0x0b0910,
  panel: 0x1b1622,
  panelHi: 0x2a2236,
  border: 0x3a3045,
  borderHi: 0x5b5068,
  ink: 0xf4ead2,
  inkDim: 0x8a7f99,
  spark: 0xffb238,
  rope: 0xd8314b,
  hp: 0xe0455a,
  hpBack: 0x4a1622,
  grit: 0x3fa7f0,
  gritBack: 0x14334a,
  hype: 0xffb238,
  hypeBack: 0x4a3410,
  good: 0x5fd068,
  ghost: 0xf4ead2,
} as const;

export const css = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
