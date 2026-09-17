import React, { useEffect, useState } from "react";

import {
  SUPPORTED_HIGHLIGHT_COLORS,
  ZHighlightColor,
} from "@karakeep/shared/types/highlights";

/**
 * The bottom action bar the mobile reader uses for highlights.
 *
 * It replaces the floating `HighlightForm` popover on mobile for two reasons:
 * the popover is anchored to the selection, exactly where iOS draws its own
 * selection callout, and Radix dismisses the popover on any pointerdown it
 * reads as outside, which is what a tap that starts by closing the callout
 * looks like. A bar pinned to the bottom of the reader cannot collide with the
 * native chrome, and it only closes when the reader says so.
 *
 * Styles are inline on purpose: this component is bundled into the Expo DOM
 * reader, whose Tailwind build does not scan this package.
 */
export interface HighlightActionBarProps {
  /** A new selection waits to be saved, or an existing highlight is edited. */
  mode: "create" | "edit";
  initialColor: ZHighlightColor;
  initialNote?: string | null;
  /** Text of the selection, for the Copy action. */
  text?: string | null;
  isDark?: boolean;
  onSave: (color: ZHighlightColor, note: string | null) => void;
  onDelete?: () => void;
  onCancel: () => void;
}

const SWATCH_LABEL: Record<ZHighlightColor, string> = {
  yellow: "Yellow",
  red: "Red",
  green: "Green",
  blue: "Blue",
};

const SWATCH_COLOR: Record<ZHighlightColor, string> = {
  yellow: "#fde68a",
  red: "#fecaca",
  green: "#bbf7d0",
  blue: "#bfdbfe",
};

export default function HighlightActionBar({
  mode,
  initialColor,
  initialNote,
  text,
  isDark = false,
  onSave,
  onDelete,
  onCancel,
}: HighlightActionBarProps) {
  const [color, setColor] = useState<ZHighlightColor>(initialColor);
  const [note, setNote] = useState(initialNote ?? "");
  const [showNote, setShowNote] = useState(!!initialNote);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setColor(initialColor);
    setNote(initialNote ?? "");
    setShowNote(!!initialNote);
    setCopied(false);
  }, [initialColor, initialNote]);

  const ink = isDark ? "#e5e7eb" : "#111827";
  const muted = isDark ? "#9ca3af" : "#6b7280";
  const panel = isDark ? "#1f2937" : "#ffffff";
  const rule = isDark ? "#374151" : "#e5e7eb";
  const chip = isDark ? "#111827" : "#f3f4f6";

  const button: React.CSSProperties = {
    appearance: "none",
    border: `1px solid ${rule}`,
    background: chip,
    color: ink,
    borderRadius: 10,
    padding: "10px 14px",
    fontSize: 15,
    fontWeight: 500,
    lineHeight: 1,
    minHeight: 44,
    touchAction: "manipulation",
  };

  // Secondary actions share a row with the swatches. The primary action gets a
  // row of its own so it can never be squeezed or pushed onto a stray line.
  const small: React.CSSProperties = {
    ...button,
    padding: "8px 8px",
    fontSize: 13,
    minHeight: 36,
  };

  const copyText = () => {
    const value = text?.trim();
    if (!value || typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div
      role="toolbar"
      aria-label={mode === "create" ? "Save highlight" : "Edit highlight"}
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 100,
        background: panel,
        borderTop: `1px solid ${rule}`,
        boxShadow: "0 -2px 12px rgba(0,0,0,0.12)",
        padding: "10px 12px",
        paddingBottom: "calc(10px + env(safe-area-inset-bottom, 0px))",
        // Tapping the bar must not disturb the selection it acts on.
        userSelect: "none",
        WebkitUserSelect: "none",
        touchAction: "manipulation",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      {showNote && (
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add a note (optional)"
          rows={2}
          style={{
            ...button,
            display: "block",
            width: "100%",
            minHeight: 60,
            boxSizing: "border-box",
            marginBottom: 10,
            fontWeight: 400,
            userSelect: "text",
            WebkitUserSelect: "text",
          }}
        />
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        {SUPPORTED_HIGHLIGHT_COLORS.map((option) => (
          <button
            key={option}
            type="button"
            aria-label={SWATCH_LABEL[option]}
            aria-pressed={color === option}
            onClick={() => setColor(option)}
            style={{
              width: 36,
              height: 36,
              flex: "0 0 auto",
              borderRadius: 18,
              background: SWATCH_COLOR[option],
              border:
                color === option ? `3px solid ${ink}` : "1px solid transparent",
              touchAction: "manipulation",
            }}
          />
        ))}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => setShowNote((value) => !value)}
          style={small}
        >
          Note
        </button>
        <button
          type="button"
          onClick={copyText}
          disabled={!text}
          style={{ ...small, color: text ? ink : muted }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          aria-label="Cancel"
          onClick={onCancel}
          style={{ ...small, minWidth: 40, fontSize: 15 }}
        >
          ✕
        </button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {mode === "edit" && onDelete && (
          <button
            type="button"
            onClick={onDelete}
            style={{ ...button, color: "#dc2626", minWidth: 84 }}
          >
            Delete
          </button>
        )}
        <button
          type="button"
          onClick={() => onSave(color, note.trim() ? note : null)}
          style={{
            ...button,
            flex: 1,
            background: "#2563eb",
            borderColor: "#2563eb",
            color: "#ffffff",
            minHeight: 48,
            fontSize: 16,
            fontWeight: 600,
          }}
        >
          {mode === "create" ? "Highlight" : "Save"}
        </button>
      </div>
    </div>
  );
}
