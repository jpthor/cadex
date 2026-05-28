import { defaultModel } from "../../app/constants";

export function SettingsDialog({
  apiKey,
  model,
  onApiKeyChange,
  onClose,
  onModelChange,
}: {
  apiKey: string;
  model: string;
  onApiKeyChange: (value: string) => void;
  onClose: () => void;
  onModelChange: (value: string) => void;
}) {
  return (
    <div className="settings-backdrop" role="presentation">
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-label="Settings">
        <div className="settings-header">
          <div>
            <h2>Settings</h2>
            <span>AI design commands</span>
          </div>
          <button className="tool-button" onClick={onClose} title="Close settings" aria-label="Close settings">
            X
          </button>
        </div>
        <label className="settings-field">
          <span>OpenAI API key</span>
          <input
            autoFocus
            value={apiKey}
            onChange={(event) => onApiKeyChange(event.target.value)}
            placeholder="sk-..."
            type="password"
          />
        </label>
        <label className="settings-field">
          <span>Model</span>
          <select value={model} onChange={(event) => onModelChange(event.target.value)}>
            <option value="gpt-5">gpt-5</option>
            <option value="gpt-5-mini">gpt-5-mini</option>
            <option value="gpt-4.1">gpt-4.1</option>
            <option value="gpt-4.1-mini">gpt-4.1-mini</option>
          </select>
        </label>
        <div className="settings-actions">
          <button onClick={() => onModelChange(defaultModel)}>Reset model</button>
          <button onClick={onClose}>Done</button>
        </div>
      </section>
    </div>
  );
}

function ToolButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button className={`tool-button ${active ? "active" : ""}`} onClick={onClick} title={label} aria-label={label}>
      {children}
    </button>
  );
}
