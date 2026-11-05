interface Props {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}

export function Switch({ id, label, checked, disabled, onChange }: Props) {
  return (
    <button className="switch" id={id} role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onChange}>
      <span />
    </button>
  );
}
