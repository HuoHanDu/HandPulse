import { useApp } from '../app/store';
import { Switch } from '../ui/Switch';

interface Props {
  active: boolean;
}

export function SettingsPage({ active }: Props) {
  const { state, dispatch } = useApp();
  const toast = (message: string) => dispatch({ type: 'toast', message });

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
                      onClick={() => dispatch({ type: 'setGranularity', value: g as 10 | 30 | 60 })}
                    >{g} 秒</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="pref-row">
              <div className="pref-label">
                <div className="pref-name">开机自启</div>
                <div className="pref-hint">登录 Windows 后自动开始采集。</div>
              </div>
              <div className="pref-ctl">
                <Switch
                  id="swAuto"
                  label="开机自启"
                  checked={state.autoStart}
                  onChange={() => {
                    const next = !state.autoStart;
                    dispatch({ type: 'setAutoStart', value: next });
                    toast(next ? '开机自启已开启。' : '开机自启已关闭。');
                  }}
                />
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
                      onClick={() => dispatch({ type: 'setRetention', value: k as 7 | 30 | 90 })}
                    >{k} 天</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="pref-row">
              <div className="pref-label">
                <div className="pref-name">数据库路径</div>
                <div className="pref-hint">只读展示。本地单文件，不联网。</div>
              </div>
              <div className="pref-ctl">
                <span className="path mono">%APPDATA%\HandPulse\data.db</span>
                <button className="tbtn" id="openDir" type="button" onClick={() => toast('打开目录为原型占位。')}>打开目录</button>
              </div>
            </div>
            <div className="pref-row">
              <div className="pref-label">
                <div className="pref-name">导出全部数据</div>
                <div className="pref-hint">导出当前保留期内的全部聚合桶。</div>
              </div>
              <div className="pref-ctl">
                <button className="tbtn" id="expCsv" type="button" onClick={() => toast('导出 CSV 为原型占位。')}>导出 CSV</button>
                <button className="tbtn" id="expJson" type="button" onClick={() => toast('导出 JSON 为原型占位。')}>导出 JSON</button>
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
              <span>全部数据已清空（原型演示，刷新页面可恢复）。</span>
              <button className="tbtn" type="button" onClick={() => dispatch({ type: 'restore' })}>恢复演示数据</button>
            </div>
          </div>
        </div>

        <div className="about">
          <div className="pref-head">关于</div>
          <div className="about-rows">
            <div className="pref-row">
              <div className="pref-label"><div className="pref-name">版本</div></div>
              <div className="pref-ctl"><span className="ver mono">0.9.0<span>原型</span></span></div>
            </div>
            <div className="pref-row">
              <div className="pref-label"><div className="pref-name">数据库 schema</div></div>
              <div className="pref-ctl"><span className="ver mono">v3</span></div>
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
