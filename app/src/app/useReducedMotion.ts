import { useEffect, useState } from 'react';

/** 跟随系统「减少动态效果」设置；运行中切换也会生效。 */
export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(() => (
    typeof window !== 'undefined'
    && !!window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ));

  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduce(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return reduce;
}
