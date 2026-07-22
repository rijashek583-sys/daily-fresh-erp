import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { Button, Input } from '../../components/ui';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, user } = useAuthStore();
  const navigate = useNavigate();

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



  return (
    <div className="min-h-screen flex bg-[var(--color-bg)]">
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

        </div>
      </div>
    </div>
  );
}
