import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Unhandled React component error caught by ErrorBoundary:', error, errorInfo);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          height: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#000000',
          color: '#cccccc',
          fontFamily: 'var(--font-primary, -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif)',
          padding: '24px',
          boxSizing: 'border-box',
          textAlign: 'center',
          zIndex: 99999
        }}>
          <div style={{
            background: 'rgba(18, 18, 18, 0.95)',
            border: '1px solid rgba(255, 69, 58, 0.25)',
            borderRadius: '20px',
            padding: '32px 36px',
            maxWidth: '440px',
            width: '100%',
            boxSizing: 'border-box',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 24px 48px rgba(0, 0, 0, 0.75)'
          }}>
            <AlertTriangle size={48} color="#ef4444" style={{ marginBottom: '16px' }} />
            <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '8px', color: '#cccccc', letterSpacing: '-0.02em' }}>
              Application Encountered an Error
            </h2>
            <p style={{ fontSize: '14px', color: '#888888', marginBottom: '16px', lineHeight: '1.5' }}>
              ZAP encountered an unexpected error. Your encryption keys and messages remain safe.
            </p>
            {this.state.error && (
              <div style={{
                marginBottom: '20px',
                padding: '12px',
                background: 'rgba(0, 0, 0, 0.6)',
                borderRadius: '8px',
                textAlign: 'left',
                maxHeight: '100px',
                overflowY: 'auto',
                fontSize: '11px',
                fontFamily: 'var(--font-mono, monospace)',
                color: '#f87171',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all'
              }}>
                {this.state.error.toString()}
              </div>
            )}
            <button
              onClick={this.handleReload}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                backgroundColor: '#007acc',
                color: '#ffffff',
                border: 'none',
                padding: '10px 20px',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: 'pointer',
                transition: 'background-color 0.2s'
              }}
            >
              <RotateCcw size={16} /> Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
