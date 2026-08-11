import { zodResolver } from '@hookform/resolvers/zod';
import { signinSchema, type SigninInput } from '@easygenerator/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { ApiProblem } from '../../lib/api-client';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { PasswordField } from '../../components/PasswordField';
import { ProblemAlert } from '../../components/ProblemAlert';
import { useAuth } from './AuthProvider';

export function SignInForm() {
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const [problem, setProblem] = useState<ApiProblem | undefined>();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SigninInput>({ resolver: zodResolver(signinSchema) });
  const onSubmit = handleSubmit(async (input) => {
    setProblem(undefined);
    try {
      await signIn(input);
      navigate('/app');
    } catch (error) {
      setProblem(
        error instanceof ApiProblem
          ? error
          : new ApiProblem(0, 'Check your email and password and try again.'),
      );
    }
  });
  const message =
    problem?.status === 401
      ? 'Check your email and password and try again.'
      : problem?.title;
  return (
    <form noValidate onSubmit={onSubmit} className="auth-form">
      <div className="form-header">
        <p className="eyebrow">Secure access</p>
        <h1>Sign in to continue.</h1>
        <p>Use your team account to enter the application.</p>
      </div>
      {message && (
        <ProblemAlert message={message} retryAfter={problem?.retryAfter} />
      )}
      <Field
        label="Email"
        type="email"
        autoComplete="email"
        error={errors.email?.message}
        {...register('email')}
      />
      <PasswordField
        label="Password"
        autoComplete="current-password"
        error={errors.password?.message}
        {...register('password')}
      />
      <Button type="submit" disabled={isSubmitting}>
        Sign in
      </Button>
      <p className="form-switch">
        New here? <Link to="/signup">Create an account</Link>
      </p>
    </form>
  );
}
