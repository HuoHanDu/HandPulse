import type { DetailPage } from '../ipc/types';

interface Props {
  page: DetailPage | null;
}

export function DetailTable({ page }: Props) {
  const rows = (page?.rows ?? []).slice(0, 8);
  return (
    <div id="tableRows">
      {rows.map((r, i) => (
        <div className="t-row" key={i}>
          <span className="t-time">{r.label}</span>
          <span>{r.actions.toLocaleString('en-US')}</span>
          <span>{r.keys.toLocaleString('en-US')}</span>
          <span>{r.clicks.toLocaleString('en-US')}</span>
          <span>{r.moveCm.toLocaleString('en-US')}</span>
        </div>
      ))}
    </div>
  );
}
