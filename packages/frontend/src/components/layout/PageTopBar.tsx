import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBars } from '@fortawesome/free-solid-svg-icons';
import { useUIStore } from '@/store/uiStore';
import { t } from '@/i18n';

interface PageTopBarProps {
  title: string;
  children?: React.ReactNode;
}

export function PageTopBar({ title, children }: PageTopBarProps) {
  const { isMobile, toggleSidebar } = useUIStore();

  return (
    <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 shrink-0">
      <div className="flex items-center gap-2">
        {isMobile && (
          <button
            onClick={toggleSidebar}
            className="flex h-9 w-9 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-black active:scale-95 transition-all duration-150"
            aria-label={t.sidebar.open}
          >
            <FontAwesomeIcon icon={faBars} className="text-sm" />
          </button>
        )}
        <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
      </div>
      {children}
    </div>
  );
}
