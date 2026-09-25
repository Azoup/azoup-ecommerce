import { IconCart, IconClipboard, IconIntegration, IconSettings } from '../ui/Icons';

export function HomeView({ onNavigate }) {
  return (
    <div>
      <h1 style={{ marginBottom: '0.5rem' }}>Bem-vindo ao Azoup E-commerce</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
        Integração de e-commerce com o sistema de confecção Azoup.
      </p>

      <div className="home-grid">
        <div className="home-card" onClick={() => onNavigate('Settings')}>
          <div className="home-card-icon"><IconSettings size={24} /></div>
          <h3>Configurações</h3>
          <p>Conecte a loja Nuvemshop da sua conta. Cada cliente configura sua própria integração.</p>
        </div>
        <div className="home-card" onClick={() => onNavigate('Sales')}>
          <div className="home-card-icon"><IconCart size={24} /></div>
          <h3>Vendas</h3>
          <p>Pedidos da Nuvemshop importados automaticamente como Pedido Aprovado no Azoup.</p>
        </div>
        <div className="home-card" onClick={() => onNavigate('Integration')}>
          <div className="home-card-icon"><IconIntegration size={24} /></div>
          <h3>Produtos</h3>
          <p>Compare catálogos, puxe e envie produtos do e-commerce e sincronize estoque com a Nuvemshop.</p>
        </div>
        <div className="home-card" onClick={() => onNavigate('EventLog')}>
          <div className="home-card-icon"><IconClipboard size={24} /></div>
          <h3>Log do sistema</h3>
          <p>Histórico de conexões, sincronizações, estoque, pedidos, webhooks e erros da integração.</p>
        </div>
      </div>
    </div>
  );
}
