import React from "react";

/**
 * Reusable confirmation modal for delete operations (single and multi).
 * Props:
 *   open       – boolean, show/hide
 *   title      – modal heading
 *   message    – body text
 *   onConfirm  – called when user clicks "Confirm"
 *   onCancel   – called when user clicks "Cancel" or outside
 */
const ConfirmModal = ({ open, title, message, onConfirm, onCancel }) => {
  if (!open) return null;

  return (
    <div className="confirm-modal-backdrop" onClick={onCancel}>
      <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="confirm-modal-title">{title || "Confirm"}</h3>
        <p className="confirm-modal-message">{message || "Are you sure?"}</p>
        <div className="confirm-modal-actions">
          <button className="ghost-btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="danger-btn confirm-modal-danger" onClick={onConfirm}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
