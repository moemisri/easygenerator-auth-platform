import { useState, type InputHTMLAttributes } from 'react';
export function PasswordField({
  label = 'Password',
  error,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label?: string | undefined;
  error?: string | undefined;
}) {
  const [visible, setVisible] = useState(false);
  const id = props.id ?? props.name ?? 'password';
  const description = `${id}-description`;
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <span className="password-input">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          aria-describedby={error ? description : undefined}
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
      {error && <small id={description}>{error}</small>}
    </label>
  );
}
