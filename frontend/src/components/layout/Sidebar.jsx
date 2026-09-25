import { useAuth } from '../../contexts/AuthContext';

import { canAccessMenu } from '../../utils/helpers';

import {
  AzoupLogo,
  IconCart,
  IconChevronLeft,
  IconHome,
  IconIntegration,
  IconLogOut,
  IconSettings,
  IconClipboard,
} from '../ui/Icons';

const MENU_ITEMS = [
  { key: 'Home', label: 'Início', Icon: IconHome },
  { key: 'Sales', label: 'Vendas', Icon: IconCart },
  { key: 'Integration', label: 'Produtos', Icon: IconIntegration },
  { key: 'EventLog', label: 'Log', Icon: IconClipboard },
];



function ProfileAvatar({ fotoUrl, size = 36 }) {

  if (fotoUrl) {

    return (

      <img

        src={fotoUrl}

        alt=""

        className="sidebar-profile-avatar"

        style={{ width: size, height: size }}

      />

    );

  }

  return <AzoupLogo size={size} />;

}



export function Sidebar({ activeMenu, onMenuChange, open, onClose, collapsed, onToggleCollapse }) {

  const { userData, signOut } = useAuth();

  const visibleItems = MENU_ITEMS.filter((item) => canAccessMenu(userData, item.key));

  const showSettings = canAccessMenu(userData, 'Settings');



  const userName = userData?.nome || 'Usuário';

  const userEmail = userData?.usuario || userData?.email || '';

  const fotoUrl = userData?.foto_perfil_url || '';



  const navigate = (key) => {

    onMenuChange(key);

    onClose?.();

  };



  const renderItem = (item) => {

    const { key, label, Icon } = item;

    const isActive = activeMenu === key;

    return (

      <button

        key={key}

        type="button"

        className={`sidebar-item ${isActive ? 'sidebar-item--active' : ''}`}

        title={collapsed ? label : undefined}

        onClick={() => navigate(key)}

      >

        <span className="sidebar-item-icon"><Icon size={18} /></span>

        {!collapsed && <span className="sidebar-item-label">{label}</span>}

      </button>

    );

  };



  return (

    <>

      {open && <div className="sidebar-overlay" onClick={onClose} />}

      <aside className={`sidebar ${open ? 'sidebar--open' : ''} ${collapsed ? 'sidebar--collapsed' : ''}`}>

        <div className="sidebar-header">

          <div className="sidebar-brand">

            <AzoupLogo size={collapsed ? 32 : 36} />

            {!collapsed && <span className="sidebar-brand-name">Azoup</span>}

          </div>

          {!collapsed && onToggleCollapse && (

            <button type="button" className="sidebar-collapse-btn" onClick={onToggleCollapse} aria-label="Recolher menu">

              <IconChevronLeft size={18} />

            </button>

          )}

        </div>



        <nav className="sidebar-nav">

          {visibleItems.map(renderItem)}

        </nav>



        <div className="sidebar-footer">

          {showSettings && (

            <button

              type="button"

              className={`sidebar-item sidebar-item--settings ${activeMenu === 'Settings' ? 'sidebar-item--active' : ''}`}

              title={collapsed ? 'Configurações' : undefined}

              onClick={() => navigate('Settings')}

            >

              <span className="sidebar-item-icon"><IconSettings size={18} /></span>

              {!collapsed && <span className="sidebar-item-label">Configurações</span>}

            </button>

          )}

          <div className="sidebar-profile-row">
            <button
              type="button"
              className="sidebar-logout-btn"
              onClick={signOut}
              title="Sair"
              aria-label="Sair"
            >
              <span className="sidebar-logout-icon"><IconLogOut size={16} /></span>
              {!collapsed && <span className="sidebar-logout-label">Sair</span>}
            </button>

            <button
              type="button"

              className={`sidebar-profile sidebar-profile--clickable ${activeMenu === 'Profile' ? 'sidebar-profile--active' : ''}`}

              onClick={() => navigate('Profile')}

              title="Editar perfil"

            >

              <ProfileAvatar fotoUrl={fotoUrl} size={collapsed ? 32 : 36} />

              {!collapsed && (

                <div className="sidebar-profile-info">

                  <strong>{userName}</strong>

                  <span>{userEmail}</span>

                </div>

              )}

            </button>

          </div>

        </div>

      </aside>

    </>

  );

}

