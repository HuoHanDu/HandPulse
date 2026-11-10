import { useEffect, useRef, useState } from 'react';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { isTauri } from '../ipc/client';
import { useApp } from '../app/store';

const CHECK_EVENT = 'handpulse:check-update';

export function requestUpdateCheck() {
  window.dispatchEvent(new Event(CHECK_EVENT));
}

type Phase = 'idle' | 'checking' | 'available' | 'downloading' | 'installing' | 'ready' | 'error';

export function UpdateCenter() {
  const { dispatch } = useApp();
  const [phase, setPhase] = useState<Phase>('idle');
  const [update, setUpdate] = useState<Update | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState('');
  const updateRef = useRef<Update | null>(null);
  const checking = useRef(false);

  const toast = (message: string) => dispatch({ type: 'toast', message });

  const closeUpdate = async (silent = false) => {
    const current = updateRef.current;
    updateRef.current = null;
    setUpdate(null);
    setPhase('idle');
    setPercent(null);
    if (current) await current.close().catch(() => {});
    if (!silent) { /* 关闭时不需要额外提示 */ }
  };

  const checkNow = async (manual: boolean) => {
    if (!isTauri) {
      if (manual) toast('浏览器预览模式不检查更新。');
      return;
    }
    if (checking.current) return;
    checking.current = true;
    if (manual) setPhase('checking');
    try {
      const found = await check();
      if (found) {
        updateRef.current = found;
        setUpdate(found);
        setPhase('available');
      } else {
        setPhase('idle');
        if (manual) toast('已是最新版本。');
      }
    } catch (err) {
      setPhase('idle');
      if (manual) toast('检查更新失败：' + String(err));
    } finally {
      checking.current = false;
    }
  };

  useEffect(() => {
    if (!isTauri) return;
    const timer = window.setTimeout(() => { void checkNow(false); }, 4500);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onCheck = () => { void checkNow(true); };
    window.addEventListener(CHECK_EVENT, onCheck);
    return () => window.removeEventListener(CHECK_EVENT, onCheck);
  });

  const download = async () => {
    const current = updateRef.current;
    if (!current) return;
    setPhase('downloading');
    setPercent(0);
    try {
      let total = 0;
      let received = 0;
      await current.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? 0;
          setPercent(total > 0 ? 0 : null);
        } else if (event.event === 'Progress') {
          received += event.data.chunkLength;
          if (total > 0) setPercent(Math.min(100, (received / total) * 100));
        } else if (event.event === 'Finished') {
          setPhase('installing');
        }
      });
      setPhase('ready');
      setPercent(100);
    } catch (err) {
      setPhase('error');
      setError(String(err));
    }
  };

  const restart = async () => {
    try {
      await relaunch();
    } catch (err) {
      setError(String(err));
      setPhase('error');
    }
  };

  if (phase === 'idle') return null;

  return (
    <div className="modal update-modal" onClick={(e) => { if (e.target === e.currentTarget && phase === 'available') void closeUpdate(); }}>
      <div className="modal-panel update-panel" role="dialog" aria-modal="true" aria-labelledby="updateTitle">
        <div className="modal-head">
          <span id="updateTitle">
            {phase === 'available' ? '发现新版本' : phase === 'checking' ? '检查更新' : phase === 'error' ? '更新失败' : '正在更新'}
          </span>
          {phase === 'available' && <button type="button" aria-label="关闭" onClick={() => void closeUpdate()}>×</button>}
        </div>
        <div className="modal-body">
          {phase === 'checking' && <p className="modal-p">正在从 GitHub Releases 检查新版本…</p>}

          {phase === 'available' && update && (
            <>
              <p className="modal-p">当前版本 <span className="mono">{update.currentVersion}</span>，新版本 <b className="mono">v{update.version}</b>。</p>
              {update.body ? <pre className="update-notes">{update.body}</pre> : null}
              <p className="update-hint">更新包会校验签名；安装后应用会重启，本地数据库不受影响。</p>
              <div className="modal-actions">
                <button className="btn" type="button" onClick={() => void closeUpdate()}>稍后</button>
                <button className="btn primary" type="button" onClick={() => void download()}>下载并安装</button>
              </div>
            </>
          )}

          {(phase === 'downloading' || phase === 'installing') && (
            <>
              <p className="modal-p">{phase === 'installing' ? '下载完成，正在安装…' : '正在下载更新…'}</p>
              <div className="update-progress"><span style={{ width: `${percent ?? 8}%` }} /></div>
              <div className="update-progress-meta mono">
                {percent === null ? '下载中' : `${percent.toFixed(0)}%`}
              </div>
            </>
          )}

          {phase === 'ready' && (
            <>
              <p className="modal-p">更新已安装。如果窗口没有自动重启，请点“立即重启”。</p>
              <div className="modal-actions">
                <button className="btn primary" type="button" onClick={() => void restart()}>立即重启</button>
              </div>
            </>
          )}

          {phase === 'error' && (
            <>
              <p className="modal-p">更新失败：{error}</p>
              <div className="modal-actions">
                <button className="btn" type="button" onClick={() => setPhase('idle')}>关闭</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
