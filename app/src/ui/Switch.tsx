interface Props {
  id: string;
  label: string;
  checked: boolean;
  onChange: () => void;
}

export function Switch({ id, label, checked, onChange }: Props) {
  return (
    <button className="switch" id={id} role="switch" aria-checked={checked} aria-label={label} onClick={onChange}>
      <span />
    </button>
  );
}
