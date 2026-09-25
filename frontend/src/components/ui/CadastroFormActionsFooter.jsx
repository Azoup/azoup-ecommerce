export function CadastroFormActionsFooter({ onSave, onCancel, saving, saveLabel = 'Salvar', extraActions }) {
  return (
    <div className="cadastro-footer">
      <div className="cadastro-footer-left">
        {extraActions}
      </div>
      <div className="cadastro-footer-right">
        {onCancel && (
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>
            Cancelar
          </button>
        )}
        <button type="button" className="btn btn-primary" onClick={onSave} disabled={saving}>
          {saving ? 'Salvando...' : saveLabel}
        </button>
      </div>
    </div>
  );
}
