import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { Button, Input } from '../../components/ui';
import InstallAppButton from '../../components/pwa/InstallAppButton';
import { usePwaInstall } from '../../hooks/usePwaInstall';
import { isInstalledAppRuntime, OFFICIAL_DISTRIBUTION } from '../../config/distribution';
import { triggerAppUpdateCheck } from '../../services/appUpdateService';
import { RefreshCw } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, user } = useAuthStore();
  const navigate = useNavigate();
  const { isInstalled, isStandalone } = usePwaInstall();

  React.useEffect(() => {
    if (user) {
      navigate('/');
    }
  }, [user, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    // Simulate network request
    await new Promise(resolve => setTimeout(resolve, 800));
    try {
      await login(email, password);
      // Wait for authStore's onAuthStateChanged to populate the user
    } catch (err: any) {
      setError(err.message || 'Invalid email or password.');
      setLoading(false);
    }
  };

  const showInstall = !isInstalled && !isStandalone && !isInstalledAppRuntime();

  return (
    <div className="min-h-screen flex bg-[var(--color-bg)] relative">
      {/* Top Right Corner Install Button */}
      {showInstall && (
        <div className="absolute top-5 right-5 sm:top-8 sm:right-8 z-20">
          <InstallAppButton variant="login-corner" />
        </div>
      )}

      {/* Left side - Brand */}
      <div className="hidden lg:flex flex-1 flex-col justify-center items-center bg-[var(--color-primary)] relative overflow-hidden">
        {/* Decorative circles */}
        <div className="absolute top-0 left-0 w-[800px] h-[800px] bg-white/5 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
        <div className="absolute bottom-0 right-0 w-[600px] h-[600px] bg-black/10 rounded-full blur-3xl translate-x-1/3 translate-y-1/3" />
        
        <div className="relative z-10 flex flex-col items-center animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="w-40 h-40 rounded-full bg-white shadow-2xl p-4 flex items-center justify-center mb-8 overflow-hidden">
            <img src="/logo.png" alt="Daily Fresh Logo" className="w-full h-full object-contain" onError={(e) => { e.currentTarget.src = 'https://ui-avatars.com/api/?name=DF&color=B91C1C&background=FAFAFA'; }} />
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold text-white tracking-tight text-center max-w-sm leading-tight">Daily Fresh Billing System</h1>
          <p className="text-red-100/90 mt-5 text-lg font-medium text-center max-w-xs leading-relaxed">Food production billing & operations platform.</p>
        </div>
      </div>

      {/* Right side - Login Form */}
      <div className="flex-1 flex flex-col justify-center px-6 sm:px-12 lg:px-24 relative">
        <div className="w-full max-w-sm mx-auto animate-in fade-in slide-in-from-left duration-300">
          <div className="mb-10 lg:hidden flex flex-col items-center text-center">
            <div className="w-20 h-20 rounded-full bg-white shadow-md p-2 flex items-center justify-center mb-4 overflow-hidden border border-gray-100 dark:border-gray-800">
              <img src="/logo.png" alt="Daily Fresh Logo" className="w-full h-full object-contain" onError={(e) => { e.currentTarget.src = 'https://ui-avatars.com/api/?name=DF&color=B91C1C&background=FAFAFA'; }} />
            </div>
            <h1 className="text-2xl font-extrabold text-[var(--color-text-main)] tracking-tight">Welcome Back</h1>
            <p className="text-sm font-medium text-[var(--color-text-muted)] mt-1">Sign in to your account</p>
          </div>

          <div className="hidden lg:block mb-10">
            <h2 className="text-3xl font-extrabold text-[var(--color-text-main)] tracking-tight">Sign In</h2>
            <p className="text-sm font-medium text-[var(--color-text-muted)] mt-2">Enter your credentials to access the platform.</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <Input
              id="email"
              type="email"
              label="Email Address"
              placeholder="name@dailyfresh.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            
            <div className="space-y-2">
              <Input
                id="password"
                type="password"
                label="Password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl">
                <p className="text-sm font-medium text-red-600 dark:text-red-400 text-center">{error}</p>
              </div>
            )}

            <Button type="submit" className="w-full" size="lg" loading={loading}>
              Sign In
            </Button>
          </form>

          {/* Prominent App Install Banner */}
          {showInstall && (
            <div className="mt-8 pt-6 border-t border-gray-100 dark:border-gray-800">
              <InstallAppButton variant="login-banner" />
            </div>
          )}

          {/* Universal Check for Updates Entry Point (Available before login for all platforms and roles) */}
          <div className="mt-6 pt-5 border-t border-gray-100 dark:border-gray-800 flex flex-col items-center justify-center gap-1.5 text-center">
            <button
              type="button"
              onClick={() => triggerAppUpdateCheck()}
              className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer group"
              id="login-check-updates-button"
              title="Check for Daily Fresh ERP updates"
            >
              <RefreshCw className="w-3.5 h-3.5 group-hover:rotate-180 transition-transform duration-300" />
              <span>Check for Updates</span>
              <span className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                v{OFFICIAL_DISTRIBUTION.version}
              </span>
            </button>
            <p className="text-[11px] text-gray-400 dark:text-gray-500">
              Instant updates across Web, Android, Windows &amp; iOS
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}
