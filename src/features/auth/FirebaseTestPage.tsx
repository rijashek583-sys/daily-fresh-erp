import { useState } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

export default function FirebaseTestPage() {
  const [status, setStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [errorDetails, setErrorDetails] = useState<string>('');

  const runTest = async () => {
    setStatus('testing');
    setErrorDetails('');
    try {
      const app = initializeApp(firebaseConfig, 'test-app');
      const auth = getAuth(app);
      await signInAnonymously(auth);
      setStatus('success');
    } catch (err: any) {
      setStatus('error');
      // Print the full error, code, and message without summarizing
      const fullError = `Code: ${err.code || 'UNKNOWN'}\nMessage: ${err.message || String(err)}\n\nFull Object: ${JSON.stringify(err, Object.getOwnPropertyNames(err), 2)}`;
      setErrorDetails(fullError);
    }
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto', fontFamily: 'monospace' }}>
      <h1>Firebase Connection Test</h1>
      
      <button 
        onClick={runTest}
        disabled={status === 'testing'}
        style={{
          padding: '10px 20px',
          fontSize: '16px',
          cursor: 'pointer',
          background: '#000',
          color: '#fff',
          border: 'none',
          borderRadius: '4px',
          marginBottom: '20px'
        }}
      >
        {status === 'testing' ? 'Testing...' : 'Run Test'}
      </button>

      {status === 'success' && (
        <div style={{ padding: '20px', background: '#d4edda', color: '#155724', borderRadius: '4px' }}>
          <h2>✅ Firebase Connected</h2>
          <p>Successfully authenticated anonymously.</p>
        </div>
      )}

      {status === 'error' && (
        <div style={{ padding: '20px', background: '#f8d7da', color: '#721c24', borderRadius: '4px', overflowX: 'auto' }}>
          <h2>❌ Firebase Connection Failed</h2>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {errorDetails}
          </pre>
        </div>
      )}
    </div>
  );
}
