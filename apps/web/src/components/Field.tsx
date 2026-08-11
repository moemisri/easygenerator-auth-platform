import type { InputHTMLAttributes, ReactNode } from 'react';
export function Field({
  label,
  error,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string | undefined;
  hint?: ReactNode | undefined;
}) {
  const id = props.id ?? props.name;
  const description = `${id}-description`;
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        aria-describedby={hint || error ? description : undefined}
        aria-invalid={Boolean(error)}
        {...props}
      />
      {(hint || error) && <small id={description}>{error ?? hint}</small>}
    </label>
  );
}
