import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app/store';

export function Modal() {
  const { state, dispatch } = useApp();
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const kind = state.modal;

  useEffect(() => {
    if (kind === 'clear') {
      setText('');
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [kind]);

  const close = () => dispatch({ type: 'modal', modal: null });
  const canClear = text.trim().toUpperCase() === 'DELETE';

  return (
    <div
      className="modal"
      id="modal"
      hidden={!kind}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
        <div className="modal-head">
          <span id="modalTitle">{kind === 'clear' ? '清空全部数据' : '重置当前视图'}</span>
          <button id="modalX" type="button" aria-label="关闭" onClick={close}>×</button>
        </div>
        <div className="modal-body" id="modalBody">
          {kind === 'clear' && (
            <>
              <p className="modal-p">将删除本机数据库里的全部采集记录。删除后不可恢复。请输入 DELETE 以确认。</p>
              <input
                className="modal-input"
                id="modalInput"
                ref={inputRef}
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="DELETE"
                aria-label="输入 DELETE 确认"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <div className="modal-actions">
                <button className="btn" type="button" onClick={close}>取消</button>
                <button
                  className="btn danger"
                  id="modalOk"
                  type="button"
                  disabled={!canClear}
                  onClick={() => {
                    dispatch({ type: 'clearData' });
                    dispatch({ type: 'toast', message: '全部数据已清空（原型演示：刷新页面可恢复）。' });
                  }}
                >清空全部数据</button>
              </div>
            </>
          )}
          {kind === 'reset' && (
            <>
              <p className="modal-p">只清空页面显示，历史数据不受影响。下次采集仍会写入数据库。</p>
              <div className="modal-actions">
                <button className="btn" type="button" onClick={close}>取消</button>
                <button
                  className="btn primary"
                  id="modalOk"
                  type="button"
                  onClick={() => {
                    dispatch({ type: 'resetView' });
                    dispatch({ type: 'toast', message: '视图已重置，历史数据未改动。再次点击可恢复视图。' });
                  }}
                >重置视图</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
