import type { PatternStats } from '../ipc/types';

const GAP_LABELS = ['0–40', '40–80', '80–120', '120–200', '200–350', '350–500', '500+'];

export function KeyboardPatterns({ patterns }: { patterns: PatternStats | null }) {
  const pairs = patterns?.pairs.slice(0, 6) ?? [];
  const gapMax = patterns ? Math.max(1, ...patterns.gapHist) : 1;
  const adRate = patterns && patterns.adTotal > 0
    ? Math.round((patterns.adFast / patterns.adTotal) * 100)
    : 0;

  return (
    <div className="kb-pattern">
      <div className="kb-pattern-block kb-pattern-alt">
        <div className="kb-pattern-kicker">快速交替 A / D</div>
        <div className="kb-pattern-big mono">
          {patterns ? patterns.adFast.toLocaleString('en-US') : '—'}
          <span>次</span>
        </div>
        <div className="kb-pattern-hint">
          {patterns && patterns.adTotal > 0
            ? `120ms 内 · 共 ${patterns.adTotal.toLocaleString('en-US')} 次 · ${adRate}%`
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
                <i style={{ height: `${Math.max(4, Math.round(((patterns?.gapHist[i] ?? 0) / gapMax) * 100))}%` }} />
              </span>
              <span className="kb-pattern-gap-label">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
