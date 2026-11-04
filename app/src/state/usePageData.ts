import { useEffect, useState } from 'react';

export interface PageDataResult<T> {
  data: T | null;
  error: Error | null;
}

/**
 * 极简数据 hook：按 key 缓存 Promise 结果，页面与 inspector 共用同一份数据。
 * - 失败时返回 error，页面保留上一次成功数据（不会白屏）；
 * - clear/restore、会话重置后调用 clearPageDataCache() 让下一次访问重新加载。
 */
const cache = new Map<string, unknown>();

export function usePageData<T>(key: string | null, loader: () => Promise<T>): PageDataResult<T> {
  const [result, setResult] = useState<PageDataResult<T>>(() => ({
    data: key ? ((cache.get(key) as T | undefined) ?? null) : null,
    error: null
  }));

  useEffect(() => {
    if (!key) return;
    const cached = cache.get(key) as T | undefined;
    if (cached !== undefined) {
      setResult({ data: cached, error: null });
      return;
    }
    let alive = true;
    loader()
      .then((value) => {
        cache.set(key, value);
        if (alive) setResult({ data: value, error: null });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setResult(prev => ({
          data: prev.data,
          error: err instanceof Error ? err : new Error(String(err))
        }));
      });
    return () => { alive = false; };
    // loader 由调用方按 key 决定，key 变化即重新加载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return result;
}

/** 清空数据缓存；prefix 为空时清空全部。clear/restore、reset_session 后调用。 */
export function clearPageDataCache(prefix?: string): void {
  if (!prefix) {
    cache.clear();
    return;
  }
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}
