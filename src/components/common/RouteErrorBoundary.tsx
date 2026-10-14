import { useRouteError } from 'react-router-dom';
import { useState } from 'react';
import { RefreshCw, AlertTriangle, ArrowLeft, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { isDynamicImportError, clearChunkReloadAttempt } from '../../lib/lazyRetry';

export function RouteErrorBoundary() {
  const error = useRouteError() as any;
  const [showDetails, setShowDetails] = useState(false);

  const isChunkError = isDynamicImportError(error);

  const handleRefresh = () => {
    clearChunkReloadAttempt();
    // Cache bust on manual user refresh
    window.location.reload();
  };

  const handleGoHome = () => {
    clearChunkReloadAttempt();
    window.location.href = '/';
  };

  const errorMessage = error?.message || (typeof error === 'string' ? error : 'An unexpected error occurred');
  const errorStack = error?.stack || null;

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-6 bg-gray-50 dark:bg-gray-950 font-sans">
      <div className="max-w-lg w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-3xl p-8 shadow-xl text-center space-y-6 animate-in fade-in duration-300">
        
        {/* Icon */}
        <div className="mx-auto w-16 h-16 rounded-2xl flex items-center justify-center bg-red-50 dark:bg-red-950/40 text-[var(--color-primary)] shadow-sm">
          {isChunkError ? (
            <Sparkles className="w-8 h-8 animate-pulse text-[var(--color-primary)]" />
          ) : (
            <AlertTriangle className="w-8 h-8 text-amber-500" />
          )}
        </div>

        {/* Headings */}
        <div className="space-y-2">
          <h2 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
            {isChunkError ? 'Application Update Available' : 'Something went wrong'}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm mx-auto leading-relaxed">
            {isChunkError
              ? 'A new version of Daily Fresh ERP has been deployed. Please refresh to load the latest features and data.'
              : 'The application encountered an unexpected issue while rendering this page.'}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 pt-2 justify-center">
          <button
            type="button"
            onClick={handleRefresh}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-[var(--color-primary)] text-white text-sm font-semibold hover:opacity-90 active:scale-[0.98] transition-all shadow-md shadow-red-900/10 cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh Application
          </button>

          <button
            type="button"
            onClick={handleGoHome}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-sm font-semibold hover:bg-gray-200 dark:hover:bg-gray-700 active:scale-[0.98] transition-all cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            Go to Home
          </button>
        </div>

        {/* Expandable Technical Details */}
        <div className="pt-4 border-t border-gray-100 dark:border-gray-800/60 text-left">
          <button
            type="button"
            onClick={() => setShowDetails(!showDetails)}
            className="w-full flex items-center justify-between text-xs font-medium text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 py-1"
          >
            <span>Technical details</span>
            {showDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {showDetails && (
            <div className="mt-3 p-3.5 bg-gray-50 dark:bg-gray-800/50 rounded-xl text-xs font-mono text-gray-600 dark:text-gray-300 overflow-x-auto max-h-48 space-y-1">
              <p className="font-semibold text-red-600 dark:text-red-400">{errorMessage}</p>
              {errorStack && <pre className="whitespace-pre-wrap text-[11px] opacity-75">{errorStack}</pre>}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
