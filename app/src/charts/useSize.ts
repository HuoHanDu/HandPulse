import { useEffect, useRef, useState } from 'react';

/** 观察容器尺寸，供手写 SVG 图表按实际像素布局。 */
export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize(prev => (prev.w === el.clientWidth && prev.h === el.clientHeight
      ? prev
      : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, ...size };
}
