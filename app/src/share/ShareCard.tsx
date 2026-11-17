import { forwardRef, useMemo } from 'react';
import { KEYS } from '../keyboard/layout';
import type { ShareCardData } from './loadShareCard';
import { formatDuration, formatKm } from './loadShareCard';

const INK = '#f5f7fa';
const MUTED = '#8c96a4';
const FAINT = '#5f6b7a';
const BLUE = '#4c8dff';
const LIME = '#c8f45a';
const MONO = '"Cascadia Mono", "JetBrains Mono", Consolas, monospace';
const SANS = 'Inter, "Microsoft YaHei", "Noto Sans SC", sans-serif';

const W = 1080;
const H = 1440;

interface Props {
  data: ShareCardData;
  includeApps: boolean;
}

function periodText(range: ShareCardData['range']): string {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (range === 'week' ? 6 : range === 'month' ? 29 : 0));
  const fmt = (d: Date) => `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  return range === 'today' ? fmt(end) : `${fmt(start)} — ${fmt(end)}`;
}
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function keyFill(count: number, max: number): string {
  if (!count || !max) return 'rgba(255,255,255,0.055)';
  const r = count / max;
  const alpha = 0.12 + Math.min(1, r) * 0.78;
  return `rgba(76,141,255,${alpha.toFixed(2)})`;
}

function MiniKeyboard({ keys, x, y, width, height }: {
  keys: ShareCardData['keys'];
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const k of keys) m.set(k.label, k.count);
    return m;
  }, [keys]);
  const max = Math.max(1, ...keys.map(k => k.count));
  const sx = width / 24;
  const sy = height / 6;
  return (
    <g transform={`translate(${x},${y})`}>
      {KEYS.map(k => (
        <rect
          key={k.label}
          x={k.x * sx + 0.8}
          y={k.y * sy + 0.8}
          width={Math.max(1, k.w * sx - 1.6)}
          height={Math.max(1, k.h * sy - 1.6)}
          rx={1.4}
          fill={keyFill(counts.get(k.label) || 0, max)}
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={0.5}
        />
      ))}
    </g>
  );
}

function MiniGrid({ cells, x, y, width, height }: {
  cells: ShareCardData['grid'];
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  const map = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cells) m.set(`${c.x},${c.y}`, c.v);
    return m;
  }, [cells]);
  const max = Math.max(1, ...cells.map(c => c.v));
  const cw = width / 32;
  const ch = height / 18;
  return (
    <g transform={`translate(${x},${y})`}>
      {Array.from({ length: 32 * 18 }, (_, i) => {
        const gx = i % 32;
        const gy = Math.floor(i / 32);
        const v = map.get(`${gx},${gy}`) || 0;
        const alpha = v ? 0.12 + Math.min(1, v / max) * 0.8 : 0.035;
        return (
          <rect
            key={i}
            x={gx * cw}
            y={gy * ch}
            width={Math.max(1, cw - 1)}
            height={Math.max(1, ch - 1)}
            rx={1}
            fill={`rgba(76,141,255,${alpha.toFixed(2)})`}
          />
        );
      })}
    </g>
  );
}

function MetricRows({ data, x, y }: { data: ShareCardData; x: number; y: number }) {
  const days = data.range === 'week' ? 7 : data.range === 'month' ? 30 : 1;
  const rows: Array<[string, string]> = [
    ['总操作', data.summary.actions.toLocaleString('en-US')],
    ['平均 / 天', Math.round(data.summary.actions / Math.max(1, days)).toLocaleString('en-US')],
    ['鼠标移动', `${formatKm(data.summary.moveKm)} km`],
    ['总点击', data.summary.clicks.toLocaleString('en-US')]
  ];
  return (
    <g transform={`translate(${x},${y})`}>
      {rows.map(([label, value], i) => (
        <g key={label} transform={`translate(0,${i * 58})`}>
          <text x={0} y={0} fill={MUTED} fontFamily={SANS} fontSize={10} letterSpacing="1.4">{label}</text>
          <text x={0} y={27} fill={INK} fontFamily={MONO} fontSize={20}>{value}</text>
          {i < rows.length - 1 && <line x1={0} y1={42} x2={300} y2={42} stroke="rgba(255,255,255,0.09)" />}
        </g>
      ))}
    </g>
  );
}

export const ShareCard = forwardRef<SVGSVGElement, Props>(function ShareCard({ data, includeApps }, ref) {
  const hasApps = includeApps && data.apps.length > 0;
  const hasPad = data.pad.total > 0;
  const hasDays = data.days.length === 7;
  const topKeys = data.keys.slice(0, 3);
  const topPairs = data.patterns.pairs.slice(0, 2);
  const adRate = data.patterns.adTotal > 0 ? Math.round(data.patterns.adFast / data.patterns.adTotal * 100) : 0;
  const maxKey = Math.max(1, ...data.keys.map(k => k.count));
  const maxPair = Math.max(1, ...topPairs.map(p => p.count));
  const maxApp = Math.max(1, ...data.apps.map(a => a.seconds));
  const maxDay = Math.max(1, ...data.days.map(d => d.actions));
  const heatW = hasApps ? 650 : 952;
  const heatH = hasApps ? 142 : 160;
  const contentY = 505;
  const lowerY = hasApps ? 716 : 712;
  const deviceY = 972;
  const dayY = 1190;

  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      role="img"
      aria-label="HandPulse 使用数据分享卡"
    >
      <defs>
        <radialGradient id="hpGlow" cx="72%" cy="0%" r="75%">
          <stop offset="0%" stopColor="#4c8dff" stopOpacity="0.20" />
          <stop offset="100%" stopColor="#4c8dff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="hpLime" cx="4%" cy="96%" r="45%">
          <stop offset="0%" stopColor="#c8f45a" stopOpacity="0.055" />
          <stop offset="100%" stopColor="#c8f45a" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill="#05070b" />
      <rect width={W} height={H} fill="url(#hpGlow)" />
      <rect width={W} height={H} fill="url(#hpLime)" />

      <g fontFamily={SANS}>
        <text x={64} y={82} fill={INK} fontSize={22} fontWeight={600} letterSpacing="-0.8">手脉</text>
        <text x={128} y={82} fill={MUTED} fontSize={9} letterSpacing="3.4">HANDPULSE</text>
        <text x={1016} y={70} textAnchor="end" fill={MUTED} fontSize={10} letterSpacing="0.8">
          {periodText(data.range)}
        </text>
        <text x={1016} y={88} textAnchor="end" fill={MUTED} fontSize={10} letterSpacing="0.8">
          {data.rangeLabel} · 本机统计
        </text>
        <line x1={64} y1={118} x2={1016} y2={118} stroke="rgba(255,255,255,0.14)" />
      </g>

      <g fontFamily={SANS}>
        <text x={64} y={167} fill={MUTED} fontSize={9} letterSpacing="2.2">按键次数</text>
        <text x={60} y={272} fill={INK} fontFamily={MONO} fontSize={108} fontWeight={500} letterSpacing="-9">
          {data.summary.keys.toLocaleString('en-US')}
        </text>
        <text x={64} y={321} fill={MUTED} fontSize={9} letterSpacing="2.2">使用时长</text>
        <text x={60} y={402} fill="#dfe7f0" fontFamily={MONO} fontSize={84} fontWeight={500} letterSpacing="-7">
          {formatDuration(data.summary.activeSeconds)}
        </text>
        <text x={64} y={430} fill={MUTED} fontSize={11}>
          {data.rangeLabel} · 共 {data.summary.actions.toLocaleString('en-US')} 次操作
        </text>
      </g>
      <MetricRows data={data} x={700} y={166} />

      <text x={64} y={contentY - 7} fill={MUTED} fontSize={9} letterSpacing="2">键盘热区</text>
      <text x={hasApps ? 714 : 1016} y={contentY - 7} textAnchor={hasApps ? 'start' : 'end'} fill={FAINT} fontSize={9} letterSpacing="1">
        {data.keys.length ? `最高 ${topKeys[0]?.label ?? '—'} · ${topKeys[0]?.count.toLocaleString('en-US') ?? 0} 次` : '暂无按键'}
      </text>
      <MiniKeyboard keys={data.keys} x={64} y={contentY} width={heatW} height={heatH} />

      {hasApps && (
        <g>
          <text x={748} y={contentY - 7} fill={MUTED} fontSize={9} letterSpacing="2">高频键位</text>
          <text x={1016} y={contentY - 7} textAnchor="end" fill={FAINT} fontSize={9} letterSpacing="1">TOP 3</text>
          {topKeys.map((k, i) => (
            <g key={k.label} transform={`translate(748,${contentY + 18 + i * 47})`}>
              <text x={0} y={0} fill={FAINT} fontFamily={MONO} fontSize={9}>0{i + 1}</text>
              <text x={27} y={0} fill={INK} fontFamily={SANS} fontSize={12}>{k.label}</text>
              <rect x={27} y={10} width={180} height={3} fill="rgba(255,255,255,0.09)" />
              <rect x={27} y={10} width={180 * Math.min(1, k.count / maxKey)} height={3} fill={BLUE} />
              <text x={268} y={0} textAnchor="end" fill={INK} fontFamily={MONO} fontSize={11}>
                {k.count.toLocaleString('en-US')}
              </text>
            </g>
          ))}
        </g>
      )}

      {!hasApps && (
        <>
          <text x={64} y={lowerY - 8} fill={MUTED} fontSize={9} letterSpacing="2">高频键位</text>
          <text x={468} y={lowerY - 8} textAnchor="end" fill={FAINT} fontSize={9} letterSpacing="1">TOP 3</text>
          {topKeys.map((k, i) => (
            <g key={k.label} transform={`translate(64,${lowerY + 24 + i * 48})`}>
              <text x={0} y={0} fill={FAINT} fontFamily={MONO} fontSize={9}>0{i + 1}</text>
              <text x={28} y={0} fill={INK} fontFamily={SANS} fontSize={12}>{k.label}</text>
              <rect x={28} y={10} width={310} height={3} fill="rgba(255,255,255,0.09)" />
              <rect x={28} y={10} width={310 * Math.min(1, k.count / maxKey)} height={3} fill={BLUE} />
              <text x={404} y={0} textAnchor="end" fill={INK} fontFamily={MONO} fontSize={11}>
                {k.count.toLocaleString('en-US')}
              </text>
            </g>
          ))}
          <text x={520} y={lowerY - 8} fill={MUTED} fontSize={9} letterSpacing="2">操作习惯</text>
          <text x={1016} y={lowerY - 8} textAnchor="end" fill={FAINT} fontSize={9} letterSpacing="1">UNORDERED PAIRS</text>
          <line x1={520} y1={lowerY - 1} x2={1016} y2={lowerY - 1} stroke="rgba(255,255,255,0.1)" />
          <text x={520} y={lowerY + 28} fill="#cdd5df" fontSize={11}>A / D 快速交替</text>
          <text x={1016} y={lowerY + 28} textAnchor="end" fill={INK} fontFamily={MONO} fontSize={12}>{adRate}%</text>
          {topPairs.map((p, i) => (
            <g key={p.a + p.b} transform={`translate(0,${lowerY + 60 + i * 29})`}>
              <text x={520} y={0} fill="#b8c1cc" fontSize={11}>{truncate(p.a, 8)} + {truncate(p.b, 8)}</text>
              <line x1={650} y1={-4} x2={920} y2={-4} stroke="#343b45" strokeDasharray="1 4" />
              <text x={1016} y={0} textAnchor="end" fill={INK} fontFamily={MONO} fontSize={11}>
                {p.count.toLocaleString('en-US')} 次
              </text>
              <rect x={520} y={8} width={Math.max(1, 496 * p.count / maxPair)} height={2} fill="rgba(76,141,255,0.45)" />
            </g>
          ))}
        </>
      )}

      {hasApps && (
        <>
          <text x={64} y={lowerY - 8} fill={MUTED} fontSize={9} letterSpacing="2">应用分布</text>
          <text x={500} y={lowerY - 8} textAnchor="end" fill={FAINT} fontSize={9} letterSpacing="1">可选 / 默认关闭</text>
          <line x1={64} y1={lowerY - 1} x2={500} y2={lowerY - 1} stroke="rgba(255,255,255,0.1)" />
          {data.apps.map((a, i) => (
            <g key={a.name} transform={`translate(64,${lowerY + 26 + i * 40})`}>
              <text x={0} y={0} fill="#cdd5df" fontSize={10}>{truncate(a.name, 20)}</text>
              <rect x={0} y={9} width={310} height={3} fill="rgba(255,255,255,0.09)" />
              <rect x={0} y={9} width={310 * a.seconds / maxApp} height={3} fill={BLUE} />
              <text x={382} y={0} textAnchor="end" fill={MUTED} fontFamily={MONO} fontSize={9}>
                {formatDuration(a.seconds)}
              </text>
            </g>
          ))}
          <text x={520} y={lowerY - 8} fill={MUTED} fontSize={9} letterSpacing="2">操作习惯</text>
          <text x={1016} y={lowerY - 8} textAnchor="end" fill={FAINT} fontSize={9} letterSpacing="1">UNORDERED PAIRS</text>
          <line x1={520} y1={lowerY - 1} x2={1016} y2={lowerY - 1} stroke="rgba(255,255,255,0.1)" />
          <text x={520} y={lowerY + 28} fill="#cdd5df" fontSize={11}>A / D 快速交替</text>
          <text x={1016} y={lowerY + 28} textAnchor="end" fill={INK} fontFamily={MONO} fontSize={12}>{adRate}%</text>
          {topPairs.map((p, i) => (
            <g key={p.a + p.b} transform={`translate(0,${lowerY + 60 + i * 29})`}>
              <text x={520} y={0} fill="#b8c1cc" fontSize={11}>{truncate(p.a, 8)} + {truncate(p.b, 8)}</text>
              <line x1={650} y1={-4} x2={920} y2={-4} stroke="#343b45" strokeDasharray="1 4" />
              <text x={1016} y={0} textAnchor="end" fill={INK} fontFamily={MONO} fontSize={11}>
                {p.count.toLocaleString('en-US')} 次
              </text>
            </g>
          ))}
        </>
      )}

      <line x1={64} y1={deviceY - 18} x2={1016} y2={deviceY - 18} stroke="rgba(255,255,255,0.14)" />
      <text x={64} y={deviceY} fill={MUTED} fontSize={9} letterSpacing="2">鼠标</text>
      <text x={hasPad ? 455 : 1016} y={deviceY} textAnchor={hasPad ? 'start' : 'end'} fill={FAINT} fontSize={9} letterSpacing="1">
        CLICK HEATMAP
      </text>
      <text x={64} y={deviceY + 24} fill={INK} fontFamily={MONO} fontSize={16}>
        {data.mouse.clicks.total.toLocaleString('en-US')}
        <tspan fill={MUTED} fontFamily={SANS} fontSize={10}> 次点击</tspan>
        <tspan fill={INK} fontFamily={MONO} fontSize={16}>  ·  {formatKm(data.summary.moveKm)} km</tspan>
        <tspan fill={MUTED} fontFamily={SANS} fontSize={10}>  ·  滚轮 {(data.mouse.wheel[0] + data.mouse.wheel[1]).toLocaleString('en-US')}</tspan>
      </text>
      <MiniGrid cells={data.grid} x={64} y={deviceY + 38} width={hasPad ? 390 : 800} height={hasPad ? 66 : 72} />
      <text x={64} y={deviceY + 128} fill={MUTED} fontSize={9}>
        左 <tspan fill={INK}>{data.mouse.clicks.left.toLocaleString('en-US')}</tspan>
        {'   '}右 <tspan fill={INK}>{data.mouse.clicks.right.toLocaleString('en-US')}</tspan>
        {'   '}中 <tspan fill={INK}>{data.mouse.clicks.middle.toLocaleString('en-US')}</tspan>
        {'   '}侧 <tspan fill={INK}>{(data.mouse.clicks.side1 + data.mouse.clicks.side2).toLocaleString('en-US')}</tspan>
      </text>

      {hasPad && (
        <g>
          <text x={570} y={deviceY} fill={MUTED} fontSize={9} letterSpacing="2">手柄</text>
          <text x={1016} y={deviceY} textAnchor="end" fill={FAINT} fontSize={9} letterSpacing="1">BUTTON FREQ</text>
          <text x={570} y={deviceY + 24} fill={INK} fontFamily={MONO} fontSize={16}>
            {data.pad.total.toLocaleString('en-US')}
            <tspan fill={MUTED} fontFamily={SANS} fontSize={10}> 次按键</tspan>
          </text>
          {data.pad.buttons.map((b, i) => {
            const col = i % 4;
            const row = Math.floor(i / 4);
            return (
              <g key={`${b.index}-${b.label}`} transform={`translate(${570 + col * 115},${deviceY + 42 + row * 42})`}>
                <text x={0} y={0} fill={MUTED} fontSize={9}>{b.label}</text>
                <text x={0} y={17} fill={INK} fontFamily={MONO} fontSize={12}>{b.count.toLocaleString('en-US')}</text>
                <rect x={0} y={24} width={96} height={2} fill="rgba(255,255,255,0.09)" />
                <rect x={0} y={24} width={96 * Math.min(1, b.count / Math.max(1, data.pad.total))} height={2} fill={LIME} opacity={0.65} />
              </g>
            );
          })}
          <text x={570} y={deviceY + 137} fill={FAINT} fontSize={8}>摇杆 / 扳机目前仅实时显示</text>
        </g>
      )}

      {hasDays && (
        <g>
          <line x1={64} y1={dayY - 22} x2={1016} y2={dayY - 22} stroke="rgba(255,255,255,0.14)" />
          <text x={64} y={dayY} fill={MUTED} fontSize={9} letterSpacing="2">本周节奏</text>
          <text x={1016} y={dayY} textAnchor="end" fill={FAINT} fontSize={9} letterSpacing="1">每日操作次数</text>
          {data.days.map((d, i) => {
            const barH = 78 * d.actions / maxDay;
            return (
              <g key={i} transform={`translate(${64 + i * 138},${dayY + 24})`}>
                <text x={0} y={0} fill={MUTED} fontFamily={MONO} fontSize={8}>
                  {(d.actions / 1000).toFixed(1)}k
                </text>
                <rect x={0} y={10} width={118} height={barH} fill="rgba(76,141,255,0.45)" />
                <text x={59} y={barH + 26} textAnchor="middle" fill={FAINT} fontSize={8}>{d.label}</text>
              </g>
            );
          })}
        </g>
      )}

      <line x1={64} y1={1388} x2={1016} y2={1388} stroke="rgba(255,255,255,0.12)" />
      <text x={64} y={1412} fill={FAINT} fontSize={8} letterSpacing="0.8">
        只记录按键次数与操作量 · 不含输入内容 · 不含窗口标题
      </text>
      <text x={1016} y={1412} textAnchor="end" fill="#8f9baa" fontSize={8} letterSpacing="1">HANDPULSE / 07</text>
    </svg>
  );
});

export async function shareCardPng(svg: SVGSVGElement, scale = 2): Promise<Blob> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(W));
  clone.setAttribute('height', String(H));
  const xml = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('分享卡渲染失败'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = W * scale;
    canvas.height = H * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 不可用');
    ctx.fillStyle = '#05070b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('PNG 生成失败'))), 'image/png');
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 3000);
}




