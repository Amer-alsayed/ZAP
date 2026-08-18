import React, { useState, useEffect, useCallback } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X, LogOut, Trash2, Ban } from 'lucide-react';

/**
 * Premium In-App Floating Toast Container
 */
export function AppToastContainer({ toasts, onDismiss }) {
  if (!toasts || toasts.length === 0) return null;

  return (
    <div className="app-toast-container" role="region" aria-label="Notifications">
      {toasts.map((toast) => {
        const type = toast.type || 'error';
        return (
          <div 
            key={toast.id} 
            className={`app-toast-item type-${type} ${toast.isExiting ? 'is-exiting' : ''}`}
            role="alert"
          >
            <div className="toast-icon-wrapper">
              {type === 'error' && <AlertCircle size={18} className="toast-icon icon-error" />}
              {type === 'warning' && <AlertTriangle size={18} className="toast-icon icon-warning" />}
              {type === 'success' && <CheckCircle2 size={18} className="toast-icon icon-success" />}
              {type === 'info' && <Info size={18} className="toast-icon icon-info" />}
            </div>

            <div className="toast-content">
              {toast.title && <div className="toast-title">{toast.title}</div>}
              <div className="toast-message">{toast.message}</div>
            </div>

            <button 
              type="button" 
              className="toast-dismiss-btn" 
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss notification"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Premium In-App Confirmation / Action Dialog Modal
 * Styled and animated identically to the app's Contact Action Modal
 */
export function AppConfirmModal({ modalState, onClose }) {
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (modalState?.isOpen) {
      setIsClosing(false);
    }
  }, [modalState?.isOpen]);

  const handleClose = useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 220);
  }, [isClosing, onClose]);

  if (!modalState || (!modalState.isOpen && !isClosing)) return null;

  const {
    title = 'Are you sure?',
    message = '',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    isDanger = false,
    iconType = 'logout',
    onConfirm
  } = modalState;

  const handleConfirm = () => {
    handleClose();
    if (onConfirm) onConfirm();
  };

  return (
    <div 
      className={`confirmation-modal-overlay ${isClosing ? 'closing' : ''}`}
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
    >
      <div 
        className={`confirmation-modal glass ${isClosing ? 'closing' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="confirmation-icon-container">
          {iconType === 'logout' ? (
            <div className="confirmation-icon delete-icon">
              <LogOut size={24} />
            </div>
          ) : iconType === 'delete' ? (
            <div className="confirmation-icon delete-icon">
              <Trash2 size={24} />
            </div>
          ) : iconType === 'block' ? (
            <div className="confirmation-icon block-icon">
              <Ban size={24} />
            </div>
          ) : (
            <div className="confirmation-icon info-icon">
              <AlertTriangle size={24} />
            </div>
          )}
        </div>

        <h3 className="confirmation-title">{title}</h3>
        {message && <p className="confirmation-desc">{message}</p>}

        <div className="confirmation-actions">
          <button 
            type="button" 
            className="confirmation-cancel-btn" 
            onClick={handleClose}
          >
            {cancelText}
          </button>
          <button 
            type="button" 
            className={`confirmation-danger-btn ${isDanger ? 'delete-confirm' : 'primary-confirm'}`} 
            onClick={handleConfirm}
            autoFocus
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
