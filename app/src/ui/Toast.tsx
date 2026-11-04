import { useApp } from '../app/store';

export function Toast() {
  const { state } = useApp();
  return (
    <div className="toast" id="toast" role="status" aria-live="polite" hidden={!state.toast}>
      {state.toast}
    </div>
  );
}
