export interface SegOption<T extends string | number> {
  value: T;
  label: string;
}

interface Props<T extends string | number> {
  id?: string;
  label: string;
  options: Array<SegOption<T>>;
  value: T;
  onChange?: (value: T) => void;
  dataAttr?: 'v' | 'g' | 'k';
}

export function Segmented<T extends string | number>({ id, label, options, value, onChange, dataAttr = 'v' }: Props<T>) {
  return (
    <div className="seg" id={id} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          {...{ [`data-${dataAttr}`]: String(o.value) }}
          aria-pressed={String(o.value) === String(value)}
          onClick={onChange ? () => onChange(o.value) : undefined}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
