const STAR_TYPE_COLORS = [
  { type: 'M', maxLum: 0.90, back: 0xB28174, core: 0xFF4032 },
  { type: 'K', maxLum: 0.98, back: 0xB29886, core: 0xFF7842 },
  { type: 'G', maxLum: 1.08, back: 0xB2A886, core: 0xFFED2A },
  { type: 'F', maxLum: 1.25, back: 0xB1B29D, core: 0xF9FF99 },
  { type: 'A', maxLum: 1.55, back: 0xAAB0B2, core: 0xFFFFFF },
  { type: 'B', maxLum: 2.00, back: 0x8198B2, core: 0x55A2FF },
  { type: 'O', maxLum: Infinity, back: 0x748BB2, core: 0x2E47FF },
];

/**
 * 按光度系数取恒星配色
 * @param {number} luminosity  光度系数
 * @returns {{type: string, back: number, core: number}}
 */
export function getStarColors(luminosity) {
  return STAR_TYPE_COLORS.find(s => luminosity < s.maxLum)
    ?? STAR_TYPE_COLORS[STAR_TYPE_COLORS.length - 1];
}
