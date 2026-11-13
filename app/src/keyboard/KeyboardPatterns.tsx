import type { KeyStat, PatternStats } from '../ipc/types';
import type { LiveOverlay } from '../state/useLiveOverlay';
import { displayKey } from '../keyboard/layout';

const GAP_LABELS = ['0–40', '40–80', '80–120', '120–200', '200–350', '350–500', '500+'];
const PAIR_SEP = '\u0000';

function mouseLabel(token: number): string {
  return token === 104 ? '左键'
    : token === 105 ? '右键'
      : token === 106 ? '中键'
        : token === 107 ? '侧键1'
          : token === 108 ? '侧键2'
            : `#${token}`;
}

function pairLabel(pair: number, labels: Map<number, string>): string {
  const a = (pair >>> 16) & 0xffff;
  const b = pair & 0xffff;
  const label = (token: number) => {
    const raw = labels.get(token);
    return raw ? displayKey(raw) : mouseLabel(token);
  };
  return `${label(a)}${PAIR_SEP}${label(b)}`;
}

interface MergedPair {
  a: string;
  b: string;
  count: number;
  fast: number;
}

export function KeyboardPatterns({
  patterns,
  overlay,
  keyStats
}: {
  patterns: PatternStats | null;
  overlay: LiveOverlay;
  keyStats: KeyStat[];
}) {
  const labels = new Map<number, string>();
  keyStats.forEach(s => labels.set(s.keyId, s.label));

  const merged = new Map<string, MergedPair>();
  const add = (a: string, b: string, count: number, fast: number) => {
    if (!count) return;
    const key = `${a}${PAIR_SEP}${b}`;
    const cur = merged.get(key) || { a, b, count: 0, fast: 0 };
    cur.count += count;
    cur.fast += fast;
    merged.set(key, cur);
  };

  for (const p of patterns?.pairs ?? []) {
    add(displayKey(p.a), displayKey(p.b), p.count, p.fastCount);
  }

  const liveFast = new Map<number, number>();
  overlay.pairGap.forEach((delta, rawKey) => {
    const pair = Math.floor(rawKey / 8);
    const bin = rawKey % 8;
    if (bin <= 2) liveFast.set(pair, (liveFast.get(pair) || 0) + delta);
  });
  overlay.pairs.forEach((delta, pair) => {
    const label = pairLabel(pair, labels);
    const [a, b] = label.split(PAIR_SEP);
    add(a, b, delta, liveFast.get(pair) || 0);
  });

  const pairs = Array.from(merged.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const baseAd = patterns ? { fast: patterns.adFast, total: patterns.adTotal } : { fast: 0, total: 0 };
  let liveAdFast = 0;
  let liveAdTotal = 0;
  overlay.pairs.forEach((delta, pair) => {
    const label = pairLabel(pair, labels);
    if (label === `A${PAIR_SEP}D` || label === `D${PAIR_SEP}A`) {
      liveAdTotal += delta;
      liveAdFast += liveFast.get(pair) || 0;
    }
  });
  const adFast = baseAd.fast + liveAdFast;
  const adTotal = baseAd.total + liveAdTotal;
  const adRate = adTotal > 0 ? Math.round((adFast / adTotal) * 100) : 0;

  const gapHist = [...(patterns?.gapHist ?? [0, 0, 0, 0, 0, 0, 0])];
  overlay.pairGap.forEach((delta, rawKey) => {
    const bin = rawKey % 8;
    if (bin < gapHist.length) gapHist[bin] += delta;
  });
  const gapMax = Math.max(1, ...gapHist);

  return (
    <div className="kb-pattern">
      <div className="kb-pattern-block kb-pattern-alt">
        <div className="kb-pattern-kicker">快速交替 A / D</div>
        <div className="kb-pattern-big mono">
          {adFast.toLocaleString('en-US')}
          <span>次</span>
        </div>
        <div className="kb-pattern-hint">
          {adTotal > 0
            ? `120ms 内 · 共 ${adTotal.toLocaleString('en-US')} 次 · ${adRate}%`
            : '还没有足够的 A/D 交替数据'}
        </div>
        <div className="kb-pattern-meter"><i style={{ width: `${adRate}%` }} /></div>
      </div>

      <div className="kb-pattern-block kb-pattern-pairs">
        <div className="kb-pattern-kicker">高频组合</div>
        {pairs.length ? pairs.map((p) => (
          <div className="kb-pattern-row" key={`${p.a}:${p.b}`}>
            <span className="kb-pattern-pair">{p.a} + {p.b}</span>
            <span className="kb-pattern-bar">
              <i style={{ width: `${Math.max(4, Math.round((p.count / pairs[0].count) * 100))}%` }} />
            </span>
            <span className="mono">{p.count.toLocaleString('en-US')}</span>
          </div>
        )) : <div className="kb-pattern-empty">暂无组合数据</div>}
      </div>

      <div className="kb-pattern-block kb-pattern-gaps">
        <div className="kb-pattern-kicker">间隔分布</div>
        <div className="kb-pattern-gap-grid">
          {GAP_LABELS.map((label, i) => (
            <div className="kb-pattern-gap-cell" key={label} title={`${label}ms`}>
              <span className="kb-pattern-gap-track">
                <i style={{ height: `${Math.max(4, Math.round(((gapHist[i] ?? 0) / gapMax) * 100))}%` }} />
              </span>
              <span className="kb-pattern-gap-label">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
