import { NavLink } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faComments,
  faSlidersH,
  faBrain,
  faBars,
  faUser,
  faRightFromBracket,
  faXmark,
  faGear,
  faToolbox,
  faImages,
} from '@fortawesome/free-solid-svg-icons';
import { useUIStore } from '@/store/uiStore';
import { t } from '@/i18n';

const navItems = [
  { to: '/chat', icon: faComments, label: t.nav.chat },
  { to: '/gallery', icon: faImages, label: t.nav.gallery },
  { to: '/models', icon: faSlidersH, label: t.nav.modelManager },
  { to: '/tools', icon: faToolbox, label: t.nav.tools },
  { to: '/system-instruction', icon: faBrain, label: t.nav.memory },
];

export function SidePanel() {
  const { sidebarOpen, isMobile, toggleSidebar } = useUIStore();

  // On mobile: overlay drawer. On desktop: inline collapsible.
  const collapsed = !sidebarOpen;

  return (
    <>
      {/* Mobile overlay backdrop */}
      {isMobile && sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/30 backdrop-blur-sm"
          onClick={toggleSidebar}
          aria-hidden="true"
        />
      )}

      <aside
        className={[
          'flex flex-col bg-white border-r border-gray-100 z-30 transition-all duration-200 ease-in-out',
          isMobile
            ? `fixed top-0 left-0 h-full ${sidebarOpen ? 'w-64' : 'w-0 overflow-hidden'}`
            : `relative h-full ${collapsed ? 'w-16' : 'w-56'}`,
        ].join(' ')}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-4 min-h-[60px]">
          {!collapsed && (
            <span className="text-base font-semibold tracking-tight text-black select-none">
              {t.appName}
            </span>
          )}
          <button
            onClick={toggleSidebar}
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-black active:scale-95 transition-all duration-150"
            aria-label={sidebarOpen ? t.sidebar.close : t.sidebar.open}
          >
            <FontAwesomeIcon icon={sidebarOpen && isMobile ? faXmark : faBars} className="text-sm" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto">
          {navItems.map(({ to, icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                [
                  'flex items-center gap-3 px-3 py-2.5 rounded-full text-sm font-medium transition-all duration-150 active:scale-[0.97]',
                  isActive
                    ? 'bg-black text-white hover:bg-black/90'
                    : 'text-gray-700 hover:bg-gray-100',
                  collapsed ? 'justify-center' : '',
                ].join(' ')
              }
              title={collapsed ? label : undefined}
            >
              <FontAwesomeIcon icon={icon} className="w-4 h-4 shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Settings link — always at the bottom of the nav area */}
        <div className="px-2 pb-1">
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              [
                'flex items-center gap-3 px-3 py-2.5 rounded-full text-sm font-medium transition-all duration-150 active:scale-[0.97]',
                isActive
                  ? 'bg-black text-white hover:bg-black/90'
                  : 'text-gray-700 hover:bg-gray-100',
                collapsed ? 'justify-center' : '',
              ].join(' ')
            }
            title={collapsed ? t.nav.settings : undefined}
          >
            <FontAwesomeIcon icon={faGear} className="w-4 h-4 shrink-0" />
            {!collapsed && <span className="truncate">{t.nav.settings}</span>}
          </NavLink>
        </div>

        {/* Footer */}
        <div
          className={[
            'border-t border-gray-100 px-2 py-3',
            collapsed ? 'flex flex-col items-center gap-2' : 'flex items-center gap-2',
          ].join(' ')}
        >
          <div
            className={[
              'flex items-center gap-2 flex-1 min-w-0',
              collapsed ? 'flex-col' : '',
            ].join(' ')}
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100">
              <FontAwesomeIcon icon={faUser} className="text-xs text-gray-500" />
            </div>
            {!collapsed && (
              <span className="truncate text-sm font-medium text-gray-800">{t.user.name}</span>
            )}
          </div>
          <button
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-black active:scale-95 transition-all duration-150"
            title={t.user.logout}
            aria-label={t.user.logout}
          >
            <FontAwesomeIcon icon={faRightFromBracket} className="text-sm" />
          </button>
        </div>
      </aside>
    </>
  );
}
