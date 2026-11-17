import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../app/store';
import { SHARE_RANGE_OPTIONS, loadShareCard, type ShareCardData, type ShareRange } from './loadShareCard';
import { ShareCard, downloadBlob, shareCardPng } from './ShareCard';
import '../styles/share.css';

interface Props {
  open: boolean;
  onClose: () => void;
  defaultRange: ShareRange;
}

function todayStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

export function ShareCardModal({ open, onClose, defaultRange }: Props) {
  const { dispatch } = useApp();
  const svgRef = useRef<SVGSVGElement>(null);
  const [range, setRange] = useState<ShareRange>(defaultRange);
  const [includeApps, setIncludeApps] = useState(false);
  const [data, setData] = useState<ShareCardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRange(defaultRange);
  }, [open, defaultRange]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setError(null);
    loadShareCard(range, includeApps)
      .then(v => { if (alive) setData(v); })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, range, includeApps]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const save = async () => {
    if (!svgRef.current || !data) return;
    setSaving(true);
    try {
      const blob = await shareCardPng(svgRef.current, 2);
      downloadBlob(blob, `HandPulse_share_${range}_${todayStamp()}.png`);
      dispatch({ type: 'toast', message: '分享卡已生成，正在保存 PNG。' });
    } catch (e) {
      dispatch({ type: 'toast', message: e instanceof Error ? e.message : '分享卡导出失败' });
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="share-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="share-sheet" role="dialog" aria-modal="true" aria-label="分享卡预览">
        <div className="share-preview">
          {data ? (
            <ShareCard ref={svgRef} data={data} includeApps={includeApps} />
          ) : (
            <div className="share-loading">{loading ? '正在生成分享卡…' : '没有可展示的数据'}</div>
          )}
        </div>
        <aside className="share-side">
          <div className="share-side-head">
            <div>
              <div className="share-kicker">SHARE CARD</div>
              <h2>分享卡</h2>
            </div>
            <button className="share-close" type="button" aria-label="关闭" onClick={onClose}>×</button>
          </div>

          <div className="share-field">
            <span className="share-label">时间范围</span>
            <div className="share-seg" role="group" aria-label="分享卡时间范围">
              {SHARE_RANGE_OPTIONS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={range === value}
                  onClick={() => setRange(value)}
                >{label}</button>
              ))}
            </div>
          </div>

          <label className="share-check">
            <input
              type="checkbox"
              checked={includeApps}
              onChange={(e) => setIncludeApps(e.target.checked)}
            />
            <span>
              <b>包含前台应用分布</b>
              <small>默认关闭。开启后会显示应用名和前台时长。</small>
            </span>
          </label>

          {includeApps && data && data.apps.length === 0 && (
            <div className="share-note">当前范围内没有可展示的前台应用数据；需要先在设置里开启前台应用统计。</div>
          )}

          <div className="share-facts">
            <div><span>按键</span><b>{data ? data.summary.keys.toLocaleString('en-US') : '—'}</b></div>
            <div><span>使用时长</span><b>{data ? `${Math.floor(data.summary.activeSeconds / 3600)}h ${Math.round((data.summary.activeSeconds % 3600) / 60)}m` : '—'}</b></div>
            <div><span>鼠标</span><b>{data ? `${data.mouse.clicks.total.toLocaleString('en-US')} 次点击` : '—'}</b></div>
            <div><span>手柄</span><b>{data && data.pad.total > 0 ? `${data.pad.total.toLocaleString('en-US')} 次` : '无数据'}</b></div>
          </div>

          {error && <div className="share-error">{error}</div>}

          <div className="share-actions">
            <button className="tbtn" type="button" onClick={onClose}>取消</button>
            <button className="tbtn primary" type="button" disabled={!data || saving || loading} onClick={save}>
              {saving ? '生成中…' : '保存 PNG 2×'}
            </button>
          </div>
          <p className="share-footnote">
            预览为 1080×1440 分享卡，导出为 2× PNG。默认不包含应用名、窗口标题和输入内容。
          </p>
        </aside>
      </div>
    </div>,
    document.body
  );
}

