import React, { useEffect, useState } from 'react';
import { Asterisk02, Key01 } from '@untitledui/icons';
import { Button } from './base/buttons/button';
import { Icon } from './icon';
import { Input } from './base/input/input';
import { resolveApiBaseUrl } from '@/utils/config-helpers';

export function LoginPage({ isDark }: { isDark: boolean }) {
  const [providers, setProviders] = useState<string[]>([]);
  const [passkeyEnabled, setPasskeyEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [passkey, setPasskey] = useState('');
  const [passkeyError, setPasskeyError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const apiBaseUrl = resolveApiBaseUrl();

  useEffect(() => {
    fetch(`${apiBaseUrl}/api/auth/providers`)
      .then((res) => res.json())
      .then((data) => {
        setProviders(data.providers || []);
        setPasskeyEnabled(data.passkeyEnabled || false);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [apiBaseUrl]);

  const handleOAuthLogin = (provider: string) => {
    const returnTo = encodeURIComponent(window.location.pathname);
    window.location.href = `${apiBaseUrl}/auth/login/${provider}?state=${returnTo}`;
  };

  const handlePasskeySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasskeyError('');
    setSubmitting(true);

    try {
      const res = await fetch(`${apiBaseUrl}/auth/passkey`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ passkey })
      });

      if (res.ok) {
        // Reload to trigger auth check
        window.location.href = '/panel/feed';
      } else {
        const data = await res.json();
        setPasskeyError(data.error || 'Invalid passkey');
      }
    } catch (err) {
      setPasskeyError('Failed to authenticate');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-primary">
        <div className="text-tertiary">Loading...</div>
      </div>
    );
  }

  const hasOAuth = providers.length > 0;
  const hasAnyAuth = hasOAuth || passkeyEnabled;

  if (!hasAnyAuth) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-primary">
        <div className="max-w-md rounded-xl border border-danger bg-primary p-6 text-center">
          <h1 className="mb-2 text-lg font-semibold text-primary">Authentication Not Configured</h1>
          <p className="text-sm text-secondary">
            Please configure OAuth credentials or set AUTH_PASSKEY in your .env file to enable authentication.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-primary">
      <div className="w-full max-w-md rounded-xl border border-secondary bg-primary p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <Icon icon={Asterisk02} className="size-8 text-brand-primary" />
          <div>
            <h1 className="text-lg font-semibold text-primary">PM Automation</h1>
            <p className="text-xs text-tertiary">Board + Claude Panel</p>
          </div>
        </div>

        <h2 className="mb-1 text-md font-semibold text-primary">Sign in to continue</h2>
        <p className="mb-6 text-sm text-secondary">Choose your preferred authentication method</p>

        <div className="space-y-4">
          {/* Passkey Login */}
          {passkeyEnabled && (
            <form onSubmit={handlePasskeySubmit} className="space-y-3">
              <div>
                <Input
                  type="password"
                  placeholder="Enter your passkey"
                  value={passkey}
                  onChange={(e) => setPasskey(e.target.value)}
                  disabled={submitting}
                  className="w-full"
                />
                {passkeyError && (
                  <p className="mt-1 text-xs text-danger">{passkeyError}</p>
                )}
              </div>
              <Button
                type="submit"
                color="brand"
                size="large"
                className="w-full justify-center"
                disabled={!passkey || submitting}
              >
                <Icon icon={Key01} className="size-5" />
                {submitting ? 'Signing in...' : 'Sign in with Passkey'}
              </Button>
            </form>
          )}

          {/* Divider if both passkey and OAuth */}
          {passkeyEnabled && hasOAuth && (
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-secondary"></div>
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-primary px-2 text-tertiary">Or continue with</span>
              </div>
            </div>
          )}

          {/* OAuth Buttons */}
          {hasOAuth && (
            <div className="space-y-3">
              {providers.includes('github') && (
                <Button
                  color="secondary"
                  size="large"
                  className="w-full justify-center"
                  onClick={() => handleOAuthLogin('github')}
                >
                  <svg className="size-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z"/>
                  </svg>
                  Continue with GitHub
                </Button>
              )}

              {providers.includes('google') && (
                <Button
                  color="secondary"
                  size="large"
                  className="w-full justify-center"
                  onClick={() => handleOAuthLogin('google')}
                >
                  <svg className="size-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Continue with Google
                </Button>
              )}
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-tertiary">
          This panel is running in public mode and requires authentication.
        </p>
      </div>
    </div>
  );
}
