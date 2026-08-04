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
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          backgroundColor: '#000000',
          color: '#cccccc',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          padding: '24px',
          textAlign: 'center'
        }}>
          <div style={{
            background: 'rgba(18, 18, 18, 0.9)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '16px',
            padding: '32px 40px',
            maxWidth: '450px',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.8)'
          }}>
            <AlertTriangle size={48} color="#ef4444" style={{ marginBottom: '16px' }} />
            <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '8px', color: '#cccccc' }}>
              Application Encountered an Error
            </h2>
            <p style={{ fontSize: '14px', color: '#888888', marginBottom: '16px', lineHeight: '1.5' }}>
              Chatra encountered an unexpected error. Your encryption keys and messages remain safe.
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
                fontFamily: 'monospace',
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
