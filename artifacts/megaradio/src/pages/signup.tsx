import { useState } from "react";
import { Link } from "wouter";
import { useSeoRouting } from "@/hooks/useSeoRouting";
import { useTranslation } from "@/hooks/useTranslation";
import { safeAuthReturnTo, withAuthReturnTo } from '@/lib/safe-auth-return';

export default function Signup() {
  const { getLocalizedUrl } = useSeoRouting();
  const { t } = useTranslation();
  const returnTo = safeAuthReturnTo(new URLSearchParams(window.location.search).get('returnTo'));
  const [signupForm, setSignupForm] = useState({
    fullName: '',
    username: '',
    email: '',
    password: '',
  });
  const [errors, setErrors] = useState<any>({});
  const [message, setMessage] = useState('');

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setMessage('');

    // Validate required fields
    if (!signupForm.fullName.trim()) {
      setErrors({ fullName: t('auth_full_name_required') || 'Full name is required' });
      return;
    }
    if (!signupForm.email.trim()) {
      setErrors({ email: t('auth_email_required') || 'Email is required' });
      return;
    }
    if (!signupForm.password) {
      setErrors({ password: t('auth_password_required') || 'Password is required' });
      return;
    }
    if (signupForm.password.length < 8) {
      setErrors({ password: t('auth_password_min_length', 'Password must be at least 8 characters') });
      return;
    }

    // Blank usernames use the server's unique full-name-based handle.
    const username = signupForm.username.trim() || undefined;

    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: signupForm.fullName,
          username,
          email: signupForm.email,
          password: signupForm.password,
        }),
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        setMessage(t('auth_account_created') || 'Account created successfully! You can now login.');
        setTimeout(() => {
          window.location.href = withAuthReturnTo(getLocalizedUrl('/login'), returnTo);
        }, 2000);
      } else {
        const errorData = await response.json();
        setErrors(errorData.errors || {});
        setMessage(errorData.error || t('auth_signup_failed') || 'Signup failed');
      }
    } catch (err) {
      setMessage(t('auth_something_wrong') || 'Something went wrong, please try again later');
    }
  };

  return (
    <div className="bg-[#0E0E0E]">
      {/* Header - EXACT from original */}
      <div className="bg-[#151515] py-7">
        <div className="container mx-auto px-4">
          <h1 className="text-2xl font-bold text-white md:text-3xl">{t('auth_signup_header') || 'Sign up'}</h1>
        </div>
      </div>

      <div className="container mx-auto pb-6 text-white px-4">
        <div className="mx-auto max-w-md">
          
          {/* Continue with text - EXACT from original */}
          <div className="pt-8 pb-6 text-center">
            <p className="text-white text-base font-normal">{t('auth_continue_with') || 'Continue with'}</p>
          </div>

          {/* Social login buttons - EXACT original design */}
          <div className="flex justify-center gap-4 pb-8">
            {/* Facebook Button */}
            <button
              type="button"
              onClick={() => window.location.href = withAuthReturnTo('/api/auth/facebook', returnTo)}
              className="w-14 h-14 rounded-full bg-[#1877F2] flex items-center justify-center hover:bg-[#166FE5] transition-colors"
              title="Continue with Facebook"
            >
              <svg className="w-6 h-6 fill-white" viewBox="0 0 24 24">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
              </svg>
            </button>

            {/* Google Button */}
            <button
              type="button"
              onClick={() => window.location.href = withAuthReturnTo('/api/auth/google', returnTo)}
              className="w-14 h-14 rounded-full bg-white flex items-center justify-center hover:bg-gray-100 transition-colors"
              title="Continue with Google"
            >
              <svg className="w-6 h-6" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
            </button>

            {/* GitHub Button */}
            <button
              type="button"
              disabled
              className="w-14 h-14 rounded-full bg-[#333333] flex items-center justify-center hover:bg-[#4a4a4a] transition-colors"
              title={t('auth_github_unavailable', 'GitHub sign-in is not available')}
              aria-label={t('auth_github_unavailable', 'GitHub sign-in is not available')}
            >
              <svg className="w-6 h-6 fill-white" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
            </button>
          </div>

          {/* Profile text - EXACT from original */}
          <div className="py-6 text-center">
            <h2 className="text-xl font-medium text-white leading-tight">
              {t('auth_manage_profile') || 'Manage Your Profile'}<br/>
              {t('auth_enjoy_listening') || 'Enjoy'}<br/>
              {t('auth_listening') || 'Listening'}
            </h2>
          </div>

          {/* Signup Form - EXACT original styling */}
          <div className="mx-auto max-w-sm">
            <form onSubmit={submitForm} className="space-y-4">
              {message && (
                <p className={`text-center font-bold text-sm ${
                  message.includes('successfully') ? 'text-green-400' : 'text-red-400'
                }`}>
                  {message}
                </p>
              )}

              <div className="relative">
                <input
                  type="text"
                  placeholder={t('auth_full_name_placeholder') || 'Your full name'}
                  value={signupForm.fullName}
                  onChange={(e) => setSignupForm({ ...signupForm, fullName: e.target.value })}
                  className="w-full bg-[#2F2F2F] border-0 rounded-md px-4 py-3 text-white placeholder-[#808080] focus:outline-none focus:ring-0"
                  required
                />
                {errors.fullName && <p className="text-red-400 text-xs mt-1">{errors.fullName}</p>}
              </div>

              <div className="relative">
                <input
                  type="text"
                  placeholder={t('auth_username_optional') || 'Username (optional)'}
                  value={signupForm.username}
                  onChange={(e) => setSignupForm({ ...signupForm, username: e.target.value })}
                  className="w-full bg-[#2F2F2F] border-0 rounded-md px-4 py-3 text-white placeholder-[#808080] focus:outline-none focus:ring-0"
                />
                {errors.username && <p className="text-red-400 text-xs mt-1">{errors.username}</p>}
              </div>

              <div className="relative">
                <input
                  type="email"
                  placeholder={t('auth_email_placeholder') || 'E-Mail'}
                  value={signupForm.email}
                  onChange={(e) => setSignupForm({ ...signupForm, email: e.target.value })}
                  className="w-full bg-[#2F2F2F] border-0 rounded-md px-4 py-3 text-white placeholder-[#808080] focus:outline-none focus:ring-0"
                />
                {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email}</p>}
              </div>

              <div className="relative">
                <input
                  type="password"
                  placeholder={t('auth_password_placeholder') || 'Password'}
                  value={signupForm.password}
                  onChange={(e) => setSignupForm({ ...signupForm, password: e.target.value })}
                  className="w-full bg-[#2F2F2F] border-0 rounded-md px-4 py-3 text-white placeholder-[#808080] focus:outline-none focus:ring-0"
                />
                {errors.password && <p className="text-red-400 text-xs mt-1">{errors.password}</p>}
              </div>

              <button
                className="w-full py-3 bg-[#FF4199] text-white rounded-md text-base font-medium hover:bg-[#e6388a] transition-colors focus:outline-none focus:ring-0"
                type="submit"
              >
                {t('auth_signup_button') || 'Sign up'}
              </button>

              <div className="text-center pt-2">
                <Link
                  href={withAuthReturnTo(getLocalizedUrl('/login'), returnTo)}
                  className="text-[#808080] text-sm hover:text-white transition-colors"
                >
                  {t('auth_already_have_account') || 'Already have an account?'}
                </Link>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
