import { SignUpForm } from '../features/auth/SignUpForm';
import { AccessLayout } from './access-layout';
export function SignUpPage() {
  return (
    <AccessLayout>
      <SignUpForm />
    </AccessLayout>
  );
}
