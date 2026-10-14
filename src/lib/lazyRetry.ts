import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

const RELOAD_STORAGE_KEY = 'daily_fresh_chunk_reload_attempt';
const RELOAD_TIMEOUT_MS = 15000; // 15 seconds cooldown to prevent reload loops

export interface ChunkReloadRecord {
  timestamp: number;
  url: string;
  target?: string;
}

/**
 * Checks if an error represents a failed dynamic import or chunk loading failure
 * typically caused by a new application deployment.
 */
export function isDynamicImportError(error: unknown): boolean {
  if (!error) return false;

  const message = (
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === 'string'
      ? error
      : JSON.stringify(error)
  ).toLowerCase();

  return (
    message.includes('failed to fetch dynamically imported module') ||
    message.includes('error loading dynamically imported module') ||
    message.includes('importing a module script failed') ||
    message.includes('loading chunk') ||
    message.includes('dynamically imported module') ||
    message.includes('failed to load module script') ||
    message.includes("unexpected token '<'") || // Returned HTML instead of JS
    message.includes('mime type')
  );
}

/**
 * Checks if the user currently has unsaved input on the page
 * (e.g., active input/textarea fields with modified values).
 */
export function hasUnsavedInput(): boolean {
  if (typeof document === 'undefined') return false;

  // 1. Check active focused input
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
    const input = active as HTMLInputElement | HTMLTextAreaElement;
    if (input.value && input.value.trim().length > 0) {
      return true;
    }
  }

  // 2. Check all text inputs / textareas across the DOM for non-empty dirty values
  const inputs = document.querySelectorAll(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]), textarea'
  );
  for (let i = 0; i < inputs.length; i++) {
    const el = inputs[i] as HTMLInputElement | HTMLTextAreaElement;
    if (el.value && el.defaultValue !== undefined && el.value !== el.defaultValue) {
      return true;
    }
  }

  return false;
}

/**
 * Checks whether a single safe reload attempt is permitted.
 * Blocks reloads if one was already attempted within 15 seconds or if unsaved input exists.
 */
export function canAttemptChunkReload(_target?: string): boolean {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') {
    return false;
  }

  // Do not reload and discard unsaved user input
  if (hasUnsavedInput()) {
    console.warn('[LazyRetry] Skipping automatic reload because unsaved user input was detected.');
    return false;
  }

  try {
    const raw = sessionStorage.getItem(RELOAD_STORAGE_KEY);
    if (raw) {
      const record: ChunkReloadRecord = JSON.parse(raw);
      const elapsed = Date.now() - record.timestamp;
      if (elapsed < RELOAD_TIMEOUT_MS) {
        console.warn(`[LazyRetry] Reload already attempted ${elapsed}ms ago. Preventing infinite loop.`);
        return false;
      }
    }
  } catch {
    // If parsing fails, allow attempt
  }

  return true;
}

/**
 * Records that an automatic reload attempt was triggered.
 */
export function recordChunkReloadAttempt(target?: string): void {
  try {
    const record: ChunkReloadRecord = {
      timestamp: Date.now(),
      url: window.location.href,
      target: target || '',
    };
    sessionStorage.setItem(RELOAD_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Ignore storage quota or security errors
  }
}

/**
 * Clears any recorded reload attempt.
 */
export function clearChunkReloadAttempt(): void {
  try {
    sessionStorage.removeItem(RELOAD_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

/**
 * Safe lazy wrapper for React components.
 * Catches dynamic import failures, verifies safety, performs one controlled reload,
 * or propagates the error to the RouteErrorBoundary if reload is not safe.
 */
export function safeLazy<T extends ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
  componentName?: string
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      const module = await importer();
      // On success, clear any old reload attempt
      clearChunkReloadAttempt();
      return module;
    } catch (error: any) {
      if (isDynamicImportError(error)) {
        console.warn(`[SafeLazy] Dynamic import failed for ${componentName || 'route'}:`, error);

        if (canAttemptChunkReload(componentName)) {
          console.info('[SafeLazy] Executing controlled one-time page reload to fetch latest deployed version.');
          recordChunkReloadAttempt(componentName);
          window.location.reload();

          // Return pending promise so React does not flash an error screen before the browser reloads
          return new Promise<{ default: T }>(() => {});
        }
      }

      throw error;
    }
  });
}

/**
 * Configures global window listeners for Vite preload errors and unhandled promise rejections.
 */
export function setupGlobalChunkErrorHandler(): void {
  if (typeof window === 'undefined') return;

  // 1. Vite's preloadError event
  window.addEventListener('vite:preloadError', (event: any) => {
    const error = event?.payload || event;
    console.warn('[VitePreloadError] Caught failed preload:', error);

    if (isDynamicImportError(error) && canAttemptChunkReload('vite:preloadError')) {
      event.preventDefault?.();
      recordChunkReloadAttempt('vite:preloadError');
      window.location.reload();
    }
  });

  // 2. Global unhandled rejections
  window.addEventListener('unhandledrejection', (event) => {
    if (isDynamicImportError(event.reason)) {
      console.warn('[UnhandledRejection] Dynamic import failed:', event.reason);
      if (canAttemptChunkReload('unhandledrejection')) {
        event.preventDefault?.();
        recordChunkReloadAttempt('unhandledrejection');
        window.location.reload();
      }
    }
  });
}
