import { SignInForm } from '../features/auth/SignInForm';
import { AccessLayout } from './access-layout';
export function SignInPage() {
  return (
    <AccessLayout>
      <SignInForm />
    </AccessLayout>
  );
}
