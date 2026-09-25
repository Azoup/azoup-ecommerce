import { useCallback, useEffect, useMemo, useState } from 'react';

import { useAuth } from '../../contexts/AuthContext';

import { GlowTabBar } from '../ui/GlowTabBar';

import { ComparePanel } from './ComparePanel';

import { ImportPanel } from './ImportPanel';

import { ExportPanel } from './ExportPanel';

import { LojaFilter } from './LojaFilter';

import {

  compareNuvemshopCatalog,

  fetchIntegrations,

  formatLojaLabel,

  getStoredIntegracaoId,

  setStoredIntegracaoId,

} from '../../services/marketplaceService';

import { toFriendlyErrorMessage } from '../../utils/helpers';

import {

  IconCompare,

  IconDownload,

  IconUpload,

} from '../ui/Icons';



const TABS = [

  { id: 'compare', label: 'Comparar', icon: 'compare' },

  { id: 'import', label: 'Puxar do e-commerce', icon: 'import' },

  { id: 'export', label: 'Enviar para e-commerce', icon: 'export' },

];



function TabIcon({ type }) {

  const props = { size: 18 };

  switch (type) {

    case 'compare': return <IconCompare {...props} />;

    case 'import': return <IconDownload {...props} />;

    case 'export': return <IconUpload {...props} />;

    default: return null;

  }

}



export function IntegrationView({ onOpenSettings }) {

  const { userData } = useAuth();

  const [lojas, setLojas] = useState([]);

  const [integracaoId, setIntegracaoId] = useState('');

  const clienteId = userData?.cliente_id;

  const [statusLoading, setStatusLoading] = useState(true);

  const [activeTab, setActiveTab] = useState('compare');

  const [compareData, setCompareData] = useState({ items: [], summary: null, integracao: null, pontaEstoque: null });

  const [compareLoading, setCompareLoading] = useState(false);

  const [error, setError] = useState('');



  const selectedLoja = useMemo(

    () => lojas.find((loja) => loja.id === integracaoId) || null,

    [lojas, integracaoId],

  );

  const connected = lojas.length > 0 && Boolean(integracaoId);



  const loadLojas = useCallback(async () => {

    if (!userData) return;

    setStatusLoading(true);

    try {

      const data = await fetchIntegrations();

      const list = data.integrations || [];

      setLojas(list);

      const stored = getStoredIntegracaoId(userData.cliente_id);

      const nextId = list.find((loja) => loja.id === stored)?.id || list[0]?.id || '';

      setIntegracaoId(nextId);

      setStoredIntegracaoId(nextId, userData.cliente_id);

    } catch (err) {

      setLojas([]);

      setIntegracaoId('');

      setError(toFriendlyErrorMessage(err));

    } finally {

      setStatusLoading(false);

    }

  }, [userData]);



  useEffect(() => {

    loadLojas();

  }, [loadLojas]);



  const handleLojaChange = (nextId) => {

    setIntegracaoId(nextId);

    setStoredIntegracaoId(nextId, clienteId);

  };



  const loadCompare = useCallback(async () => {

    if (!userData || !integracaoId) return;

    setCompareLoading(true);

    setError('');

    try {

      const data = await compareNuvemshopCatalog({ integracaoId });

      setCompareData({

        items: data.items || [],

        summary: data.summary || null,

        integracao: data.integracao || null,

        pontaEstoque: data.pontaEstoque || null,

        stockAutoResolve: data.stockAutoResolve || null,

      });

    } catch (err) {

      setError(toFriendlyErrorMessage(err));

    } finally {

      setCompareLoading(false);

    }

  }, [integracaoId, userData]);



  useEffect(() => {

    if (!userData || statusLoading || !integracaoId) return;

    if (!lojas.some((loja) => loja.id === integracaoId)) return;

    loadCompare();

  }, [userData, integracaoId, activeTab, loadCompare, statusLoading, lojas]);



  const tabsWithIcons = TABS.map((tab) => ({

    ...tab,

    icon: <TabIcon type={tab.icon} />,

    disabled: !connected,

    disabledTitle: 'Configure uma loja em Configurações',

  }));



  return (

    <div>

      <div className="page-header integration-page-header">

        <h1>Produtos</h1>

        <div className="integration-page-toolbar">

          <LojaFilter

            lojas={lojas}

            value={integracaoId}

            onChange={handleLojaChange}

            disabled={statusLoading || !lojas.length}

          />

          {connected && (

            <button type="button" className="btn btn-outline" onClick={loadCompare} disabled={compareLoading}>

              {compareLoading ? 'Atualizando...' : 'Atualizar dados'}

            </button>

          )}

        </div>

      </div>



      {error && <div className="alert alert-error">{error}</div>}



      {!statusLoading && !connected && (

        <div className="alert alert-info integration-settings-prompt">

          <div>

            <strong>Nenhuma loja vinculada</strong>

            <p style={{ margin: '0.35rem 0 0' }}>

              Adicione uma loja em Configurações antes de puxar ou enviar produtos.

            </p>

          </div>

          {onOpenSettings && (

            <button type="button" className="btn btn-primary" onClick={onOpenSettings}>

              Ir para Configurações

            </button>

          )}

        </div>

      )}



      {connected && selectedLoja && (

        <div className="integration-connected-banner">

          Loja selecionada: <strong>{formatLojaLabel(selectedLoja)}</strong>

          {compareData.pontaEstoque && (

            <span className="integration-meta">

              {' '}· Ponto de estoque: {compareData.pontaEstoque.nome}

            </span>

          )}

          {onOpenSettings && (

            <button type="button" className="btn btn-sm btn-outline" onClick={onOpenSettings}>

              Gerenciar lojas

            </button>

          )}

        </div>

      )}



      <div className="product-form-card">

        <GlowTabBar tabs={tabsWithIcons} activeTab={activeTab} onTabChange={setActiveTab} />



        {activeTab === 'compare' && (

          <ComparePanel

            items={compareData.items}

            summary={compareData.summary}

            loading={compareLoading || statusLoading}

            integracaoId={integracaoId}

            stockAutoResolve={compareData.stockAutoResolve}

            onRefresh={loadCompare}

          />

        )}

        {activeTab === 'import' && (

          <ImportPanel

            items={compareData.items}

            connected={connected}

            integracaoId={integracaoId}

            onDone={loadCompare}

          />

        )}

        {activeTab === 'export' && (

          <ExportPanel

            items={compareData.items}

            connected={connected}

            integracaoId={integracaoId}

            onDone={loadCompare}

          />

        )}

      </div>

    </div>

  );

}
