import { useEffect, useMemo, useState } from 'react';
import {
  disconnectIntegration,
  fetchIntegrations,
  fetchMarketplaceAuthUrl,
  fetchMarketplaceProviders,
  fetchPontasEstoque,
  fetchTabelasPreco,
  MARKETPLACE_LABELS,
  updateIntegration,
} from '../../services/marketplaceService';
import { fetchEcommerceStoreBillingStatus } from '../../services/billingService';
import { useAuth } from '../../contexts/AuthContext';
import { FormInput, FormPicker, FormCheckbox } from '../ui/FormComponents';
import { MarketplaceSelector } from '../integration/MarketplaceSelector';
import { toFriendlyErrorMessage } from '../../utils/helpers';

const ECOMMERCE_STORE_PRICE_BRL = 97;

function resolveSelectedId(list, currentId) {
  if (currentId && list.some((item) => item.id === currentId)) return currentId;
  return list[0]?.id || '';
}

function buildTabelaOptions(tabelas) {
  return tabelas.map((t) => ({ value: t.id, label: t.descricao }));
}

function buildPontaOptions(pontas) {
  return pontas.map((p) => ({
    value: p.id,
    label: p.codigo ? `${p.nome} (${p.codigo})` : p.nome,
  }));
}

function LojaConfigForm({
  idPrefix,
  nome,
  onNomeChange,
  tabelaPrecoId,
  onTabelaChange,
  pontaEstoqueId,
  onPontaChange,
  tabelas,
  pontas,
  marketplace,
  onMarketplaceChange,
  providers,
  showMarketplace = false,
}) {
  return (
    <div className="form-grid settings-loja-form-grid">
      {showMarketplace && (
        <MarketplaceSelector
          providers={providers}
          value={marketplace}
          onChange={onMarketplaceChange}
          fieldClassName="settings-loja-form-grid__full"
        />
      )}
      <FormInput
        id={`${idPrefix}-nome`}
        label="Nome no sistema"
        required
        value={nome}
        onChange={(e) => onNomeChange(e.target.value)}
        placeholder="Ex.: Loja Matriz, Outlet SP"
      />
      <FormPicker
        id={`${idPrefix}-tabela`}
        label="Tabela de preço"
        required
        value={tabelaPrecoId}
        onChange={(e) => onTabelaChange(e.target.value)}
        options={buildTabelaOptions(tabelas)}
        disabled={!tabelas.length}
      />
      <FormPicker
        id={`${idPrefix}-ponta`}
        label="Ponto de estoque"
        required
        value={pontaEstoqueId}
        onChange={(e) => onPontaChange(e.target.value)}
        options={buildPontaOptions(pontas)}
        disabled={!pontas.length}
      />
    </div>
  );
}

function LojaVinculadaCard({
  loja,
  tabelas,
  pontas,
  onUpdated,
  onPatched,
  onDisconnected,
}) {
  const [nome, setNome] = useState(loja.nome || '');
  const [tabelaPrecoId, setTabelaPrecoId] = useState(loja.tabela_preco_id || '');
  const [pontaEstoqueId, setPontaEstoqueId] = useState(loja.ponta_estoque_id || '');
  const [syncEstoque, setSyncEstoque] = useState(loja.sync_estoque !== false);
  const [saving, setSaving] = useState(false);
  const [savingSync, setSavingSync] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const marketplaceLabel = MARKETPLACE_LABELS[loja.marketplace] || loja.marketplace || 'Marketplace';
  const isDirty = nome !== (loja.nome || '')
    || tabelaPrecoId !== (loja.tabela_preco_id || '')
    || pontaEstoqueId !== (loja.ponta_estoque_id || '')
    || syncEstoque !== (loja.sync_estoque !== false);

  useEffect(() => {
    setNome(loja.nome || '');
    setTabelaPrecoId(resolveSelectedId(tabelas, loja.tabela_preco_id));
    setPontaEstoqueId(resolveSelectedId(pontas, loja.ponta_estoque_id));
    setSyncEstoque(loja.sync_estoque !== false);
  }, [
    loja.id,
    loja.nome,
    loja.tabela_preco_id,
    loja.ponta_estoque_id,
    loja.sync_estoque,
    tabelas,
    pontas,
  ]);

  const handleSyncEstoqueChange = async (checked) => {
    const previous = syncEstoque;
    setSyncEstoque(checked);
    setSavingSync(true);
    setError('');
    setMessage('');
    try {
      const result = await updateIntegration(loja.id, { syncEstoque: checked });
      const savedFlag = result.integration?.sync_estoque;
      const saved = savedFlag !== false;
      setSyncEstoque(saved);
      onPatched?.(loja.id, { sync_estoque: savedFlag ?? checked });
      setMessage(saved
        ? 'Sincronização de estoque ativada.'
        : 'Sincronização de estoque desativada.');
    } catch (err) {
      setSyncEstoque(previous);
      setError(toFriendlyErrorMessage(err));
    } finally {
      setSavingSync(false);
    }
  };

  const handleSave = async () => {
    if (!tabelaPrecoId || !pontaEstoqueId) {
      setError('Selecione tabela de preço e ponto de estoque.');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await updateIntegration(loja.id, {
        nome,
        tabelaPrecoId,
        pontaEstoqueId,
        syncEstoque,
      });
      setMessage('Configurações salvas.');
      onPatched?.(loja.id, {
        nome,
        tabela_preco_id: tabelaPrecoId,
        ponta_estoque_id: pontaEstoqueId,
        sync_estoque: syncEstoque,
      });
      onUpdated?.();
    } catch (err) {
      setError(toFriendlyErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm(
      `Desconectar a loja "${nome || loja.nome}"?\n\n`
      + `A cobrança de R$ ${ECOMMERCE_STORE_PRICE_BRL}/mês desta loja será removida da assinatura na próxima fatura.`,
    )) return;
    setDisconnecting(true);
    setError('');
    try {
      await disconnectIntegration(loja.id);
      onDisconnected?.();
    } catch (err) {
      setError(toFriendlyErrorMessage(err));
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <article className="settings-loja-card">
      <header className="settings-loja-card__header">
        <div className="settings-loja-card__heading">
          <span className="settings-loja-card__marketplace">{marketplaceLabel}</span>
          <h3 className="settings-loja-card__title">{loja.nome || loja.store_name || 'Loja'}</h3>
          <p className="settings-loja-card__meta">
            {loja.store_name && loja.store_name !== loja.nome ? `${loja.store_name} · ` : ''}
            ID {loja.store_id || '—'}
            {loja.connected_at && (
              <> · Conectada em {new Date(loja.connected_at).toLocaleString('pt-BR')}</>
            )}
          </p>
        </div>
        <span className="settings-loja-card__status">
          <span className="settings-loja-card__status-dot" aria-hidden />
          Conectada
        </span>
      </header>

      <div className="settings-loja-card__body">
        <LojaConfigForm
          idPrefix={`loja-${loja.id}`}
          nome={nome}
          onNomeChange={setNome}
          tabelaPrecoId={tabelaPrecoId}
          onTabelaChange={setTabelaPrecoId}
          pontaEstoqueId={pontaEstoqueId}
          onPontaChange={setPontaEstoqueId}
          tabelas={tabelas}
          pontas={pontas}
        />

        <FormCheckbox
          id={`loja-${loja.id}-sync-estoque`}
          className="settings-loja-card__sync-estoque"
          label="Sincronizar estoque com o e-commerce"
          checked={syncEstoque}
          disabled={savingSync}
          onChange={handleSyncEstoqueChange}
        />
        <p className="integration-meta settings-loja-card__sync-hint">
          {savingSync
            ? 'Salvando preferência de estoque...'
            : 'Desmarcado: estoques podem ficar diferentes; pedidos e demais sincronizações continuam normais.'}
        </p>

        {error && <div className="alert alert-error">{error}</div>}
        {message && <div className="alert alert-success">{message}</div>}

        <div className="settings-form-actions settings-loja-card__actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving || savingSync || !isDirty || !tabelaPrecoId || !pontaEstoqueId}
          >
            {saving ? 'Salvando...' : 'Salvar alterações'}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={handleDisconnect}
            disabled={disconnecting || saving || savingSync}
          >
            {disconnecting ? 'Desconectando...' : 'Desconectar'}
          </button>
        </div>
      </div>
    </article>
  );
}

export function LojasVinculadasPanel({ oauthFlash, onConnectionChange }) {
  const { userData } = useAuth();
  const [providers, setProviders] = useState([]);
  const [marketplace, setMarketplace] = useState('nuvemshop');
  const [lojas, setLojas] = useState([]);
  const [tabelas, setTabelas] = useState([]);
  const [pontas, setPontas] = useState([]);
  const [nome, setNome] = useState('');
  const [storeUrl, setStoreUrl] = useState('');
  const [tabelaPrecoId, setTabelaPrecoId] = useState('');
  const [pontaEstoqueId, setPontaEstoqueId] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [billingHint, setBillingHint] = useState(null);
  const [error, setError] = useState(() => (
    oauthFlash?.settings === 'error' && oauthFlash.reason ? oauthFlash.reason : ''
  ));
  const [success, setSuccess] = useState('');

  const providerList = providers.length
    ? providers
    : [{ id: 'nuvemshop', label: 'Nuvemshop', enabled: true }];

  const handleLojaPatched = (integracaoId, patch) => {
    setLojas((prev) => prev.map((item) => (
      item.id === integracaoId ? { ...item, ...patch } : item
    )));
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [integrationsData, tabelasData, pontasData] = await Promise.all([
        fetchIntegrations(),
        fetchTabelasPreco(),
        fetchPontasEstoque(),
      ]);
      const tabelasList = tabelasData.tabelas || [];
      const pontasList = pontasData.pontas || [];
      setLojas(integrationsData.integrations || []);
      setTabelas(tabelasList);
      setPontas(pontasList);
      setTabelaPrecoId((prev) => resolveSelectedId(tabelasList, prev));
      setPontaEstoqueId((prev) => resolveSelectedId(pontasList, prev));
      onConnectionChange?.((integrationsData.integrations || []).length > 0);
      if (oauthFlash?.settings === 'connected') {
        setSuccess('Loja conectada com sucesso.');
        setError('');
      }
    } catch (err) {
      setError(toFriendlyErrorMessage(err));
      onConnectionChange?.(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMarketplaceProviders()
      .then((data) => setProviders(data.providers || []))
      .catch(() => setProviders([{ id: 'nuvemshop', label: 'Nuvemshop', enabled: true }]));
    loadData();
  }, []);

  const enabledProvider = useMemo(
    () => providers.find((p) => p.id === marketplace && p.enabled),
    [providers, marketplace],
  );

  const handleAddLoja = async () => {
    if (!enabledProvider) return;
    const trimmedNome = nome.trim();
    if (!trimmedNome) {
      setError('Informe um nome para identificar a loja no sistema.');
      return;
    }
    if (marketplace === 'tray' && !storeUrl.trim()) {
      setError('Informe a URL da loja Tray (ex.: https://sualoja.commercesuite.com.br).');
      return;
    }
    if (!tabelaPrecoId || !pontaEstoqueId) {
      setError('Selecione tabela de preço e ponto de estoque.');
      return;
    }

    setAdding(true);
    setError('');
    setSuccess('');
    try {
      if (userData?.cliente_id) {
        const billing = await fetchEcommerceStoreBillingStatus(userData.cliente_id);
        setBillingHint(billing);
        if (billing.ativoConfec === false) {
          throw new Error(
            'Assinatura Confec inativa. Ative o plano no Confec para vincular lojas e-commerce.',
          );
        }
        if (billing.podeAdicionar === false && !billing.skipped) {
          throw new Error(
            'Não é possível adicionar loja cobrável. Verifique a assinatura Stripe ativa no Confec.',
          );
        }

        const price = billing.unitPriceBrl || ECOMMERCE_STORE_PRICE_BRL;
        const ok = confirm(
          `Adicionar esta loja incluirá +R$ ${price}/mês na assinatura Confec (próxima fatura).\n\nDeseja continuar?`,
        );
        if (!ok) {
          setAdding(false);
          return;
        }
      } else {
        const ok = confirm(
          `Adicionar esta loja incluirá +R$ ${ECOMMERCE_STORE_PRICE_BRL}/mês na assinatura Confec (próxima fatura).\n\nDeseja continuar?`,
        );
        if (!ok) {
          setAdding(false);
          return;
        }
      }

      const { url } = await fetchMarketplaceAuthUrl({
        marketplace,
        nome: trimmedNome,
        storeUrl: storeUrl.trim(),
        tabelaPrecoId,
        pontaEstoqueId,
      });
      window.location.href = url;
    } catch (err) {
      setError(toFriendlyErrorMessage(err));
      setAdding(false);
    }
  };

  const canAddLoja = Boolean(
    nome.trim()
    && tabelaPrecoId
    && pontaEstoqueId
    && tabelas.length
    && pontas.length
    && enabledProvider
    && (marketplace !== 'tray' || storeUrl.trim()),
  );

  if (loading) {
    return <div className="empty-state">Carregando lojas vinculadas...</div>;
  }

  return (
    <div className="settings-lojas-panel">
      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="settings-add-loja-panel">
        <h3 className="settings-section-subtitle">Adicionar loja</h3>
        <p className="settings-section-desc settings-add-loja-desc">
          Escolha o marketplace, defina um nome interno e as regras de preço e estoque desta loja.
          Cada loja vinculada adiciona R$ {ECOMMERCE_STORE_PRICE_BRL}/mês na assinatura Confec.
        </p>

        <LojaConfigForm
          idPrefix="nova-loja"
          showMarketplace
          marketplace={marketplace}
          onMarketplaceChange={setMarketplace}
          providers={providerList}
          nome={nome}
          onNomeChange={setNome}
          tabelaPrecoId={tabelaPrecoId}
          onTabelaChange={setTabelaPrecoId}
          pontaEstoqueId={pontaEstoqueId}
          onPontaChange={setPontaEstoqueId}
          tabelas={tabelas}
          pontas={pontas}
        />

        {(tabelas.length === 0 || pontas.length === 0) && (
          <div className="alert alert-info">
            {tabelas.length === 0 && pontas.length === 0
              ? 'Cadastre ao menos uma tabela de preço e um ponto de estoque no Azoup para vincular lojas.'
              : tabelas.length === 0
                ? 'Cadastre ao menos uma tabela de preço ativa no Azoup.'
                : 'Cadastre ao menos um ponto de estoque ativo no Azoup.'}
          </div>
        )}

        {!enabledProvider && (
          <div className="alert alert-info">Este marketplace ainda não está disponível.</div>
        )}

        {marketplace === 'tray' && (
          <FormInput
            id="nova-loja-tray-url"
            label="URL da loja Tray"
            required
            value={storeUrl}
            onChange={(e) => setStoreUrl(e.target.value)}
            placeholder="https://sualoja.commercesuite.com.br"
          />
        )}

        {enabledProvider && (
          <div className="settings-form-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleAddLoja}
              disabled={adding || !canAddLoja}
            >
              {adding ? 'Redirecionando...' : 'Adicionar loja'}
            </button>
          </div>
        )}
      </div>

      {lojas.length > 0 && (
        <div className="settings-lojas-connected">
          <h3 className="settings-section-subtitle">
            Lojas conectadas ({lojas.length})
          </h3>
          <p className="settings-section-desc">
            Cada loja usa sua própria tabela de preço e ponto de estoque na sincronização.
          </p>
          <div className="settings-lojas-grid">
            {lojas.map((loja) => (
              <LojaVinculadaCard
                key={loja.id}
                loja={loja}
                tabelas={tabelas}
                pontas={pontas}
                onPatched={handleLojaPatched}
                onUpdated={loadData}
                onDisconnected={loadData}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
