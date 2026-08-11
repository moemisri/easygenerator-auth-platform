import { useState, type InputHTMLAttributes } from 'react';
export function PasswordField({
  label = 'Password',
  error,
  describedBy,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label?: string | undefined;
  error?: string | undefined;
  describedBy?: string | undefined;
}) {
  const [visible, setVisible] = useState(false);
  const id = props.id ?? props.name ?? 'password';
  const description = [describedBy, error ? `${id}-description` : undefined]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <span className="password-input">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          aria-describedby={description || undefined}
          aria-invalid={Boolean(error)}
          {...props}
        />
        <button
          type="button"
          className="password-toggle"
          aria-label={`${visible ? 'Hide' : 'Show'} password`}
          onClick={() => setVisible(!visible)}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </span>
      {error && <small id={`${id}-description`}>{error}</small>}
    </div>
  );
}
