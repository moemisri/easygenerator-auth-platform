type AuthExpiryListener = () => void;

const listeners = new Set<AuthExpiryListener>();

export function subscribeToAuthExpiry(listener: AuthExpiryListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publishAuthExpiry() {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // One subscriber must not prevent expiry delivery to the others.
    }
  }
}
