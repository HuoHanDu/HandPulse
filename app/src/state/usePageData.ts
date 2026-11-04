import { useEffect, useState } from 'react';

/**
 * 极简数据 hook：按 key 缓存 Promise 结果，页面与 inspector 共用同一份数据。
 * M1 的 mock 是同步派生，一次加载即可；M2 换成 invoke 后仍然复用。
 */
const cache = new Map<string, unknown>();

export function usePageData<T>(key: string | null, loader: () => Promise<T>): T | null {
  const [data, setData] = useState<T | null>(() => {
    if (!key) return null;
    return (cache.get(key) as T | undefined) ?? null;
  });

  useEffect(() => {
    if (!key) return;
    const cached = cache.get(key) as T | undefined;
    if (cached !== undefined) {
      setData(cached);
      return;
    }
    let alive = true;
    loader().then((value) => {
      cache.set(key, value);
      if (alive) setData(value);
    });
    return () => { alive = false; };
    // loader 由调用方按 key 决定，key 变化即重新加载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return data;
}
