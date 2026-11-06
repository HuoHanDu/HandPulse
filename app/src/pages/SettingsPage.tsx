import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useApp } from '../app/store';
import { getSettings, isTauri, openDataDir, setSettings } from '../ipc/client';
import { clearPageDataCache, usePageData } from '../state/usePageData';
import { Switch } from '../ui/Switch';
import {
  CLOSE_BEHAVIOR_EVENT,
  readCloseBehavior,
  writeCloseBehavior,
  type CloseBehavior
} from '../shell/CloseGuard';

interface Props {
  active: boolean;
}

export function SettingsPage({ active }: Props) {
  const { state, dispatch } = useApp();
  const toast = (message: string) => dispatch({ type: 'toast', message });
  const { data: settings } = usePageData('settings', getSettings);
  const [closeBehavior, setCloseBehavior] = useState<CloseBehavior>(readCloseBehavior);
  const fileInput = useRef<HTMLInputElement>(null);

  const importDatabase = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 200 * 1024 * 1024) {
      toast('数据库文件超过 200 MB，拒绝导入。');
      return;
    }
    try {
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      await invoke('stage_database_import', { bytes });
      toast('已准备导入：请退出并重新打开手脉，导入时当前数据库会自动备份。');
    } catch (err) {
      toast('导入失败：' + String(err));
    }
  };

  useEffect(() => {
    const sync = () => setCloseBehavior(readCloseBehavior());
    window.addEventListener(CLOSE_BEHAVIOR_EVENT, sync);
    return () => window.removeEventListener(CLOSE_BEHAVIOR_EVENT, sync);
  }, []);

  const chooseCloseBehavior = (behavior: CloseBehavior) => {
    writeCloseBehavior(behavior);
    setCloseBehavior(behavior);
    toast(behavior === 'tray'
      ? '已启用后台运行：关闭窗口后会留在系统托盘继续采集。'
      : behavior === 'quit'
        ? '关闭窗口将直接退出应用。'
        : '关闭窗口时会询问你。'
    );
  };

  useEffect(() => {
    if (!settings) return;
    if (state.granularity !== settings.bucketSeconds) {
      dispatch({ type: 'setGranularity', value: settings.bucketSeconds as 10 | 30 | 60 });
    }
    if (state.retention !== settings.retentionDays) {
      dispatch({ type: 'setRetention', value: settings.retentionDays as 7 | 30 | 90 });
    }
  }, [settings, state.granularity, state.retention, dispatch]);

  const save = (granularity: 10 | 30 | 60, retention: 7 | 30 | 90) => {
    const prevG = state.granularity;
    const prevK = state.retention;
    dispatch({ type: 'setGranularity', value: granularity });
    dispatch({ type: 'setRetention', value: retention });
    setSettings(granularity, retention)
      .then(() => {
        clearPageDataCache();
        toast('设置已保存。');
      })
      .catch((err) => {
        dispatch({ type: 'setGranularity', value: prevG });
        dispatch({ type: 'setRetention', value: prevK });
        toast('设置保存失败：' + String(err));
      });
  };

  return (
    <section className={'page' + (active ? ' active' : '')} data-page="settings" aria-label="设置">
      <header className="g-head">
        <h1>设置</h1>
        <p>采集只在本机进行，不联网，也不记录你输入了什么。</p>
      </header>

      <div className="settings-wrap" id="settingsWrap">
        <div className="prefs">
          <div className="pref-group">
            <div className="pref-head">采集</div>
            <div className="pref-row">
              <div className="pref-label">
                <div className="pref-name">采集总开关</div>
                <div className="pref-hint">关闭后立即停止写入，已记录的数据保留。</div>
              </div>
              <div className="pref-ctl">
                <Switch id="swCollect" label="采集总开关" checked={!state.paused} onChange={() => dispatch({ type: 'togglePause' })} />
              </div>
            </div>
            <div className="pref-row">
              <div className="pref-label">
                <div className="pref-name">桶粒度</div>
                <div className="pref-hint">写入数据库的时间聚合粒度。</div>
              </div>
              <div className="pref-ctl">
                <div className="seg" id="granSeg" role="group" aria-label="桶粒度">
                  {[10, 30, 60].map(g => (
                    <button
                      key={g}
                      type="button"
                      data-g={g}
                      aria-pressed={state.granularity === g}
                      onClick={() => save(g as 10 | 30 | 60, state.retention)}
                    >{g} 秒</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="pref-row">
              <div className="pref-label">
                <div className="pref-name">后台运行</div>
                <div className="pref-hint">关闭窗口后继续采集；从系统托盘可重新打开或退出。首次关闭也可单独询问。</div>
              </div>
              <div className="pref-ctl">
                <div className="seg" id="closeBehaviorSeg" role="group" aria-label="关闭窗口时">
                  <button
                    type="button"
                    aria-pressed={closeBehavior === 'ask'}
                    onClick={() => chooseCloseBehavior('ask')}
                  >每次询问</button>
                  <button
                    type="button"
                    aria-pressed={closeBehavior === 'tray'}
                    onClick={() => chooseCloseBehavior('tray')}
                  >最小化到托盘</button>
                  <button
                    type="button"
                    aria-pressed={closeBehavior === 'quit'}
                    onClick={() => chooseCloseBehavior('quit')}
                  >直接退出</button>
                </div>
              </div>
            </div>
            <div className="pref-row">
              <div className="pref-label">
                <div className="pref-name">开机自启 <span className="m4badge">M4</span></div>
                <div className="pref-hint">M4 再接入系统登录项；当前不生效。</div>
              </div>
              <div className="pref-ctl">
                <Switch id="swAuto" label="开机自启（M4）" checked={false} disabled onChange={() => {}} />
              </div>
            </div>
          </div>

          <div className="pref-group">
            <div className="pref-head">数据</div>
            <div className="pref-row">
              <div className="pref-label">
                <div className="pref-name">数据保留</div>
                <div className="pref-hint">超过保留期的数据自动清理。</div>
              </div>
              <div className="pref-ctl">
                <div className="seg" id="keepSeg" role="group" aria-label="数据保留">
                  {[7, 30, 90].map(k => (
                    <button
                      key={k}
                      type="button"
                      data-k={k}
                      aria-pressed={state.retention === k}
                      onClick={() => save(state.granularity, k as 7 | 30 | 90)}
                    >{k} 天</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="pref-row">
              <div className="pref-label">
                <div className="pref-name">数据库路径</div>
                <div className="pref-hint">本地单文件，不联网。迁移时关闭应用，复制整个目录或 data.db 到新机器同一路径。</div>
              </div>
              <div className="pref-ctl">
                <span className="path mono">{settings?.dbPath ?? '%APPDATA%\\com.handpulse.desktop\\data.db'}</span>
                <button
                  className="tbtn"
                  id="openDir"
                  type="button"
                  disabled={!isTauri}
                  title="在资源管理器中打开数据目录"
                  onClick={() => {
                    void openDataDir().catch((err) => toast('打开数据目录失败：' + String(err)));
                  }}
                >打开目录</button>
              </div>
            </div>
            <div className="pref-row">
              <div className="pref-label">
                <div className="pref-name">导出全部数据 <span className="m4badge">M4</span></div>
                <div className="pref-hint">M4 再实现真实导出；当前不可用。</div>
              </div>
              <div className="pref-ctl">
                <button className="tbtn" id="expCsv" type="button" disabled title="M4 再实现">导出 CSV</button>
                <button className="tbtn" id="expJson" type="button" disabled title="M4 再实现">导出 JSON</button>
              </div>
            </div>
            <div className="pref-row">
              <div className="pref-label">
                <div className="pref-name">迁移数据库</div>
                <div className="pref-hint">选择旧版 data.db；退出并重新打开后替换，当前库会自动备份。</div>
              </div>
              <div className="pref-ctl">
                <input
                  ref={fileInput}
                  type="file"
                  accept=".db,application/x-sqlite3"
                  hidden
                  onChange={(e) => void importDatabase(e)}
                />
                <button
                  className="tbtn"
                  id="importDb"
                  type="button"
                  disabled={!isTauri}
                  title="选择旧版 data.db 并排队导入"
                  onClick={() => fileInput.current?.click()}
                >导入旧数据库</button>
              </div>
            </div>
            <div className="pref-row">
              <div className="pref-label">
                <div className="pref-name">清空全部数据</div>
                <div className="pref-hint">需要二次确认并输入 DELETE。删除后不可恢复。</div>
              </div>
              <div className="pref-ctl">
                <button className="tbtn danger" id="clearAll" type="button" onClick={() => dispatch({ type: 'modal', modal: 'clear' })}>清空全部数据</button>
              </div>
            </div>
            <div className="banner" id="emptyBanner" hidden={!state.empty}>
              <span>{isTauri ? '全部数据已清空。' : '全部数据已清空（原型演示，刷新页面可恢复）。'}</span>
              {!isTauri && (
                <button className="tbtn" type="button" onClick={() => dispatch({ type: 'restore' })}>恢复演示数据</button>
              )}
            </div>
          </div>
        </div>

        <div className="about">
          <div className="pref-head">关于</div>
          <div className="about-rows">
            <div className="pref-row">
              <div className="pref-label"><div className="pref-name">版本</div></div>
              <div className="pref-ctl"><span className="ver mono">0.9.5<span>原型</span></span></div>
            </div>
            <div className="pref-row">
              <div className="pref-label"><div className="pref-name">数据库 schema</div></div>
              <div className="pref-ctl"><span className="ver mono">v{settings?.schemaVersion ?? 1}</span></div>
            </div>
            <div className="pref-row">
              <div className="pref-label"><div className="pref-name">采集内核</div></div>
              <div className="pref-ctl"><span className="ver mono">HandPulse Core 0.4.2<span>源码公开</span></span></div>
            </div>
          </div>
          <div className="privacy">
            <p>手脉只记录你按下哪个物理键、按了多少次、鼠标移动了多远。</p>
            <p>它不记录你输入了什么字，不读取窗口标题，不截屏，不联网。</p>
            <p>你可以随时在设置里暂停记录或清空全部数据。删除后不可恢复。</p>
            <p>采集内核 HandPulse Core 的源码公开，你可以自行验证上述承诺。</p>
          </div>
        </div>
      </div>
    </section>
  );
}
