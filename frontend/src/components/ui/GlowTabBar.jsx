import { PRODUCT_TAB_ICONS } from './Icons';

export function GlowTabBar({ tabs, activeTab, onTabChange }) {
  return (
    <div className="product-tab-bar">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        const isDisabled = tab.disabled;
        const IconComponent = PRODUCT_TAB_ICONS[tab.id];

        return (
          <button
            key={tab.id}
            type="button"
            className={`product-tab ${isActive ? 'product-tab--active' : ''} ${isDisabled ? 'product-tab--disabled' : ''}`}
            disabled={isDisabled}
            onClick={() => !isDisabled && onTabChange(tab.id)}
            title={isDisabled ? (tab.disabledTitle || 'Indisponível') : tab.label}
          >
            {tab.icon ? (
              <span className="product-tab-icon">{tab.icon}</span>
            ) : IconComponent ? (
              <span className="product-tab-icon">
                <IconComponent size={18} />
              </span>
            ) : null}
            <span className="product-tab-label">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
