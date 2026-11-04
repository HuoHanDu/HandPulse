import { HP, KEY_LABEL } from '../mock/mock';

export interface KeyDef {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  display: string;
  count: number;
}

export const KEYS: KeyDef[] = HP.keyboard.keys;
export const WIDTH_UNITS = 24;
export const HEIGHT_UNITS = 6;

export function keyIndex(label: string): number {
  return KEYS.findIndex(k => k.label === label);
}

export function labelAt(index: number): string | null {
  const k = KEYS[index];
  return k ? k.label : null;
}

const NUMPAD_LABEL: Record<string, string> = {
  NDiv: '/', NMul: '*', NSub: '−', NAdd: '+', NEnter: '↵', NDot: '.',
  NumLock: 'Num', N0: '0', N1: '1', N2: '2', N3: '3', N4: '4', N5: '5',
  N6: '6', N7: '7', N8: '8', N9: '9'
};

export function displayKey(label: string): string {
  return KEY_LABEL[label] || NUMPAD_LABEL[label] || label;
}

/** 物理位置（行/列），与原型 keyPos 同规则。 */
export function keyPos(label: string): { row: number; col: number } {
  for (let i = 0; i < KEYS.length; i++) {
    if (KEYS[i].label !== label) continue;
    const row = Math.round(KEYS[i].y) + 1;
    let col = 1;
    for (let j = 0; j < KEYS.length; j++) {
      if (Math.round(KEYS[j].y) === Math.round(KEYS[i].y) && KEYS[j].x < KEYS[i].x) col++;
    }
    return { row, col };
  }
  return { row: 0, col: 0 };
}
