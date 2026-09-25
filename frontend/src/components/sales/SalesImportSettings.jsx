import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchOrderImportConfig,
  updateIntegration,
} from '../../services/marketplaceService';
import { toFriendlyErrorMessage } from '../../utils/helpers';
import { LojaFilter } from '../integration/LojaFilter';
import { CadastroFormActionsFooter } from '../ui/CadastroFormActionsFooter';
import { FormCheckbox } from '../ui/FormComponents';

function toggleValue(list, value) {
  return list.includes(value)
    ? list.filter((item) => item !== value)
    : [...list, value];
}

function StatusGroup({ groupId, title, hint, options, selected, onToggle, onSelectAll, onClearAll }) {
  return (
    <section className="form-section sales-import-status-group">
      <div className="form-section-header sales-import-status-group-header">
        <div>
          <h4>{title}</h4>
          {hint && <p className="form-label-hint">{hint}</p>}
        </div>
        <div className="sales-import-status-actions">
          <button type="button" className="btn btn-outline btn-sm" onClick={onSelectAll}>
            Marcar todos
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={onClearAll}>
            Desmarcar todos
          </button>
        </div>
      </div>
      <div className="sales-import-status-grid">
        {options.map((option) => (
          <div key={option.value} className="sales-import-status-option">
            <FormCheckbox
              id={`${groupId}-${option.value}`}
              label={option.label}
              checked={selected.includes(option.value)}
              onChange={() => onToggle(option.value)}
            />
            {option.description && (
              <span className="form-label-hint">{option.description}</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export function SalesImportSettings({ onClose, onSaved }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [definitions, setDefinitions] = useState(null);
  const [definitionsByMarketplace, setDefinitionsByMarketplace] = useState(null);
  const [integrations, setIntegrations] = useState([]);
  const [selectedIntegracaoId, setSelectedIntegracaoId] = useState('');
  const [draftByIntegracao, setDraftByIntegracao] = useState({});

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchOrderImportConfig();
      setDefinitions(data);
      setDefinitionsByMarketplace(data.definitionsByMarketplace || null);
      setIntegrations(data.integrations || []);

      const initialDraft = {};
      for (const integration of data.integrations || []) {
        const marketplaceDefs = data.definitionsByMarketplace?.[integration.marketplace] || data;
        initialDraft[integration.id] = {
          order_statuses: [...(integration.importOrderStatuses?.order_statuses || marketplaceDefs.defaults.order_statuses)],
          payment_statuses: [...(integration.importOrderStatuses?.payment_statuses || marketplaceDefs.defaults.payment_statuses)],
        };
      }
      setDraftByIntegracao(initialDraft);
      setSelectedIntegracaoId(data.integrations?.[0]?.id || '');
    } catch (err) {
      setError(toFriendlyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const currentDraft = selectedIntegracaoId
    ? draftByIntegracao[selectedIntegracaoId]
    : null;

  const updateDraft = (updater) => {
    if (!selectedIntegracaoId) return;
    setDraftByIntegracao((prev) => ({
      ...prev,
      [selectedIntegracaoId]: updater(prev[selectedIntegracaoId]),
    }));
  };

  const handleSave = async () => {
    if (!selectedIntegracaoId || !currentDraft) return;

    if (!currentDraft.order_statuses.length || !currentDraft.payment_statuses.length) {
      setError('Selecione ao menos um status de pedido e um de pagamento.');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      await updateIntegration(selectedIntegracaoId, {
        importOrderStatuses: currentDraft,
      });
      setMessage('Regras de importação salvas para esta loja.');
      onSaved?.();
    } catch (err) {
      setError(toFriendlyErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const selectedIntegration = useMemo(
    () => integrations.find((item) => item.id === selectedIntegracaoId) || null,
    [integrations, selectedIntegracaoId],
  );

  const activeDefinitions = useMemo(() => {
    if (!selectedIntegration) return definitions;
    return definitionsByMarketplace?.[selectedIntegration.marketplace] || definitions;
  }, [definitions, definitionsByMarketplace, selectedIntegration]);

  return (
    <div className="sales-order-detail-overlay" onClick={onClose} role="presentation">
      <div
        className="sales-import-settings-panel product-form-card"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sales-import-settings-title"
      >
        <header className="sales-order-detail-header">
          <div>
            <h2 id="sales-import-settings-title">Importação de pedidos</h2>
            <p className="form-label-hint">
              Defina quais status do e-commerce viram Pedido Aprovado no Azoup. A configuração é por loja conectada.
            </p>
          </div>
          <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>
            Fechar
          </button>
        </header>

        {error && <div className="alert alert-error">{error}</div>}
        {message && <div className="alert alert-success">{message}</div>}

        {loading ? (
          <div className="empty-state">Carregando configurações...</div>
        ) : integrations.length === 0 ? (
          <div className="empty-state">Nenhuma loja conectada.</div>
        ) : (
          <>
            <div className="integration-page-toolbar sales-import-toolbar">
              <LojaFilter
                id="sales-import-loja-filter"
                label="Loja"
                lojas={integrations.map((integration) => ({
                  id: integration.id,
                  nome: integration.nome,
                  store_name: integration.storeName,
                  marketplace: 'nuvemshop',
                }))}
                value={selectedIntegracaoId}
                onChange={setSelectedIntegracaoId}
              />
            </div>

            {selectedIntegration && (
              <p className="integration-meta sales-import-footnote">
                Configurando regras para <strong>{selectedIntegration.nome || selectedIntegration.storeName}</strong>.
              </p>
            )}

            {currentDraft && activeDefinitions && (
              <>
                <StatusGroup
                  groupId="order-status"
                  title="Status do pedido (Nuvemshop)"
                  hint="Estado geral do pedido na loja."
                  options={activeDefinitions.orderStatuses}
                  selected={currentDraft.order_statuses}
                  onToggle={(value) => updateDraft((draft) => ({
                    ...draft,
                    order_statuses: toggleValue(draft.order_statuses, value),
                  }))}
                  onSelectAll={() => updateDraft((draft) => ({
                    ...draft,
                    order_statuses: activeDefinitions.orderStatuses.map((item) => item.value),
                  }))}
                  onClearAll={() => updateDraft((draft) => ({
                    ...draft,
                    order_statuses: [],
                  }))}
                />

                <StatusGroup
                  groupId="payment-status"
                  title="Status de pagamento (Nuvemshop)"
                  hint="Situação do pagamento no checkout."
                  options={activeDefinitions.paymentStatuses}
                  selected={currentDraft.payment_statuses}
                  onToggle={(value) => updateDraft((draft) => ({
                    ...draft,
                    payment_statuses: toggleValue(draft.payment_statuses, value),
                  }))}
                  onSelectAll={() => updateDraft((draft) => ({
                    ...draft,
                    payment_statuses: activeDefinitions.paymentStatuses.map((item) => item.value),
                  }))}
                  onClearAll={() => updateDraft((draft) => ({
                    ...draft,
                    payment_statuses: [],
                  }))}
                />

                <p className="sales-import-footnote form-label-hint">
                  Pedidos que não atenderem à combinação selecionada permanecem visíveis na lista,
                  mas não serão importados como Pedido Aprovado. A sincronização continua considerando
                  <strong> todas as lojas</strong> conectadas.
                </p>

                <CadastroFormActionsFooter
                  onSave={handleSave}
                  saving={saving}
                  saveLabel="Salvar regras desta loja"
                />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
