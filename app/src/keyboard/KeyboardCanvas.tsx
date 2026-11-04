import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useApp, type Disp, type Layout } from '../app/store';
import { KEYS, displayKey } from './layout';
import { LEVELS } from '../mock/mock';
import { liveStore } from '../state/liveStore';

export interface KeyboardHandle {
  pulse(label: string): void;
  flash(label: string): void;
}

interface Props {
  active: boolean;
  layout: Layout;
  disp: Disp;
  counts: Map<string, number>;
  maxCount: number;
  sel: string | null;
  paused: boolean;
  empty: boolean;
  reduce: boolean;
}

function levelOf(count: number, max: number): number {
  if (!count || !max) return 0;
  const r = count / max;
  if (r > 0.75) return 5;
  if (r > 0.45) return 4;
  if (r > 0.2) return 3;
  if (r > 0.05) return 2;
  return 1;
}

/**
 * 键盘画布：命令式渲染。
 * - 键位 DOM 只在 layout 变化（104↔87）时重建一次，存 Map<label, HTMLElement>；
 * - 热力/范围/选中变化只改 CSS 变量与 data-lv，不重建；
 * - 实时帧只给命中的键加 .flash，不触发 React 渲染。
 */
export const KeyboardCanvas = forwardRef<KeyboardHandle, Props>(function KeyboardCanvas(props, ref) {
  const { state, dispatch } = useApp();
  const { layout, disp, counts, maxCount, sel, empty } = props;
  const stageRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const elsRef = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [u, setU] = useState(40);
  const propsRef = useRef(props);
  propsRef.current = props;

  useImperativeHandle(ref, () => ({
    pulse(label: string) {
      const el = elsRef.current.get(label);
      if (!el) return;
      el.classList.add('pulse');
      window.setTimeout(() => el.classList.remove('pulse'), 760);
    },
    flash(label: string) {
      const el = elsRef.current.get(label);
      if (!el) return;
      el.classList.add('flash');
      window.setTimeout(() => el.classList.remove('flash'), 200);
    }
  }), []);

  // 104 / 87 切换才重建键位 DOM
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const frag = document.createDocumentFragment();
    const map = new Map<string, HTMLButtonElement>();
    for (const k of KEYS) {
      if (layout === 87 && k.x >= 20) continue;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'key';
      el.dataset.k = k.label;
      el.setAttribute('aria-label', k.label + ' 键');
      el.textContent = displayKey(k.label);
      frag.appendChild(el);
      map.set(k.label, el);
    }
    box.replaceChildren(frag);
    elsRef.current = map;
  }, [layout]);

  // 热力 / 范围 / 选中：只更新既有节点
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const wide = layout === 104 ? 24 : 20;
    box.style.setProperty('--u', u + 'px');
    box.style.width = (wide * u) + 'px';
    box.style.height = (6 * u) + 'px';
    document.documentElement.style.setProperty('--keylabel', (u >= 34 ? 12 : 11) + 'px');
    for (const k of KEYS) {
      if (layout === 87 && k.x >= 20) continue;
      const el = elsRef.current.get(k.label);
      if (!el) continue;
      const isSel = sel === k.label;
      if (isSel) el.classList.add('sel');
      else el.classList.remove('sel');
      el.setAttribute('aria-pressed', String(isSel));
      el.style.left = (k.x * u) + 'px';
      el.style.top = (k.y * u) + 'px';
      el.style.width = (k.w * u - 4) + 'px';
      el.style.height = (k.h * u - 4) + 'px';
      const cnt = empty ? 0 : (counts.get(k.label) || 0);
      const lv = disp === 'real' ? 0 : levelOf(cnt, empty ? 0 : maxCount);
      const L = LEVELS[lv];
      el.style.setProperty('--fill', L.c);
      el.style.setProperty('--ink', L.ink);
      el.style.setProperty('--bd', L.bd);
      el.dataset.lv = String(lv);
    }
  }, [layout, u, disp, counts, maxCount, sel, empty]);

  // 尺寸：u 由 stage 宽度决定（与原型 layoutKeyboard 同公式）
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const avail = stage.clientWidth - 20;
      const next = Math.max(29, Math.min(41, Math.floor(avail / 24)));
      setU(prev => (prev === next ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    return () => ro.disconnect();
  }, []);

  // 实时帧：只给脏键加 .flash（这是核心输入反馈，不受系统「减少动态效果」影响）
  useEffect(() => {
    const stop = liveStore.subscribe(() => {
      const p = propsRef.current;
      if (!p.active || p.paused || p.empty || p.disp === 'heat') return;
      const deltas = liveStore.getDeltas();
      deltas.keys.forEach((delta, keyId) => {
        if (!delta) return;
        const key = KEYS[keyId];
        if (!key) return;
        if (p.layout === 87 && key.x >= 20) return;
        const el = elsRef.current.get(key.label);
        if (!el) return;
        el.classList.add('flash');
        window.setTimeout(() => el.classList.remove('flash'), 200);
      });
    });
    return stop;
  }, []);

  return (
    <div className="kbstage" id="kbstage" ref={stageRef}>
      <div
        className="kbc"
        id="kbc"
        ref={boxRef}
        onClick={(e) => {
          const t = e.target as HTMLElement;
          const key = t.closest('.key') as HTMLElement | null;
          dispatch({ type: 'select', label: key ? key.dataset.k ?? null : null });
        }}
        onMouseOver={(e) => {
          const t = e.target as HTMLElement;
          const key = t.closest('.key') as HTMLElement | null;
          if (key) {
            const label = key.dataset.k ?? null;
            if (label && state.hover !== label) dispatch({ type: 'hover', label });
          }
        }}
        onMouseOut={(e) => {
          const t = e.target as HTMLElement;
          const key = t.closest('.key') as HTMLElement | null;
          if (key) dispatch({ type: 'hover', label: null });
        }}
      />
    </div>
  );
});
