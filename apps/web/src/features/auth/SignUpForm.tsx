import { zodResolver } from '@hookform/resolvers/zod';
import { signupSchema, type SignupInput } from '@easygenerator/contracts';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ApiProblem } from '../../lib/api-client';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { PasswordField } from '../../components/PasswordField';
import { ProblemAlert } from '../../components/ProblemAlert';
import { useAuth } from './AuthProvider';
import { requestedPath } from './auth-navigation';

const rules = [
  ['At least 8 characters', (value: string) => value.length >= 8],
  ['At most 128 characters', (value: string) => value.length <= 128],
  ['One letter', (value: string) => /[A-Za-z]/.test(value)],
  ['One number', (value: string) => /[0-9]/.test(value)],
  ['One special character', (value: string) => /[^A-Za-z0-9]/.test(value)],
] as const;
export function SignUpForm() {
  const navigate = useNavigate();
  const location = useLocation();
  const navigationState = location.state as unknown;
  const { signUp } = useAuth();
  const [problem, setProblem] = useState<ApiProblem | undefined>();
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<SignupInput>({ resolver: zodResolver(signupSchema) });
  const password = useWatch({ control, name: 'password', defaultValue: '' });
  const onSubmit = handleSubmit(async (input) => {
    setProblem(undefined);
    try {
      await signUp(input);
      void navigate(requestedPath(navigationState), { replace: true });
    } catch (error) {
      setProblem(
        error instanceof ApiProblem
          ? error
          : new ApiProblem(0, 'Unable to create your account.'),
      );
    }
  });
  return (
    <form
      noValidate
      onSubmit={(event) => void onSubmit(event)}
      className="auth-form"
    >
      <div className="form-header">
        <p className="eyebrow">Create secure access</p>
        <h1>Set up your account.</h1>
        <p>Your session stays protected in this browser.</p>
      </div>
      {problem && (
        <ProblemAlert
          message={problem.title}
          retryAfter={problem.retryAfter}
          autoFocus
        />
      )}
      <Field
        label="Email"
        type="email"
        autoComplete="email"
        error={errors.email?.message}
        {...register('email')}
      />
      <Field
        label="Name"
        autoComplete="name"
        error={errors.name?.message}
        {...register('name')}
      />
      <PasswordField
        label="Password"
        autoComplete="new-password"
        error={errors.password?.message}
        describedBy="password-requirements"
        {...register('password')}
      />
      <ul
        id="password-requirements"
        className="password-rules"
        aria-label="Password requirements"
      >
        {rules.map(([label, passes]) => (
          <li key={label} data-met={passes(password)}>
            {label}
          </li>
        ))}
      </ul>
      <Button type="submit" disabled={isSubmitting}>
        Create account
      </Button>
      <p className="form-switch">
        Already have access?{' '}
        <Link to="/signin" state={navigationState}>
          Sign in
        </Link>
      </p>
    </form>
  );
}
