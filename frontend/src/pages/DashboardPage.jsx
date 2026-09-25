import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useResponsiveLayout } from '../hooks/useResponsiveLayout';
import { Sidebar } from '../components/layout/Sidebar';
import { HomeView } from '../components/home/HomeView';
import { IntegrationView } from '../components/integration/IntegrationView';
import { SettingsView } from '../components/settings/SettingsView';
import { SalesView } from '../components/sales/SalesView';
import { EventLogView } from '../components/log/EventLogView';
import { ProfileView } from '../components/profile/ProfileView';
import { captureOAuthFlash, clearOAuthQueryParams } from '../utils/oauthFlash';

import { IconMenu } from '../components/ui/Icons';
const MENU_TITLES = {
  Home: 'Início',
  Settings: 'Configurações',
  Integration: 'Produtos',
  Sales: 'Vendas E-commerce',
  EventLog: 'Log do sistema',
  Profile: 'Meu perfil',
};

function resolveMenuFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('menu') === 'Settings' || params.get('settings')) return 'Settings';
  if (params.get('menu') === 'Integration' || params.get('integration')) return 'Integration';
  return null;
}

export function DashboardPage() {
  const { userData } = useAuth();
  const { isMobileNav } = useResponsiveLayout();
  const [oauthFlash] = useState(captureOAuthFlash);
  const [activeMenu, setActiveMenu] = useState(() => resolveMenuFromUrl() || 'Home');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    clearOAuthQueryParams();
  }, []);
  const renderContent = () => {
    switch (activeMenu) {
      case 'Settings':
        return <SettingsView oauthFlash={oauthFlash} />;
      case 'Integration':
        return <IntegrationView onOpenSettings={() => setActiveMenu('Settings')} />;
      case 'Sales':
        return <SalesView onOpenSettings={() => setActiveMenu('Settings')} />;
      case 'EventLog':
        return <EventLogView />;
      case 'Profile':
        return <ProfileView />;
      case 'Home':
      default:
        return <HomeView onNavigate={setActiveMenu} />;
    }
  };

  return (
    <div className="dashboard-layout">
      <Sidebar
        activeMenu={activeMenu}
        onMenuChange={setActiveMenu}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={sidebarCollapsed && !isMobileNav}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
      />

      <div className="dashboard-main">
        <header className="dashboard-topbar">
          {isMobileNav && (
            <button type="button" className="menu-toggle" onClick={() => setSidebarOpen(true)} aria-label="Abrir menu">
              <IconMenu size={20} />
            </button>
          )}
          <h1 style={{ fontSize: '1.125rem' }}>{MENU_TITLES[activeMenu] || activeMenu}</h1>
        </header>
        <main className="dashboard-content">
          {renderContent()}
        </main>
      </div>
    </div>
  );
}
