import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSpinner, faSearch, faKey, faPen, faTrash } from '@fortawesome/free-solid-svg-icons';
import { api } from '@/api';
import { t } from '@/i18n';

export function ToolsPage() {
  const qc = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings.get,
  });

  const [showModal, setShowModal] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showConfirmRemove, setShowConfirmRemove] = useState(false);

  const updateMutation = useMutation({
    mutationFn: api.settings.update,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  const braveSearch = settings?.tools?.braveSearch;
  const isEnabled = braveSearch?.enabled ?? false;
  const hasKey = braveSearch?.hasApiKey ?? false;

  const handleToggle = () => {
    if (!isEnabled && !hasKey) {
      // Toggling ON without a key — show modal
      setApiKeyInput('');
      setShowModal(true);
      return;
    }
    // Toggle enabled/disabled
    updateMutation.mutate({
      tools: { braveSearch: { enabled: !isEnabled } },
    });
  };

  const handleSaveKey = () => {
    if (!apiKeyInput.trim()) return;
    updateMutation.mutate(
      { tools: { braveSearch: { enabled: true, apiKey: apiKeyInput.trim() } } },
      { onSuccess: () => { setShowModal(false); setApiKeyInput(''); } },
    );
  };

  const handleEditKey = async () => {
    try {
      const keys = await api.settings.revealKeys();
      setApiKeyInput(keys.braveSearch || '');
    } catch {
      setApiKeyInput('');
    }
    setShowModal(true);
  };

  const handleRemoveKey = () => {
    updateMutation.mutate(
      { tools: { braveSearch: { enabled: false, apiKey: '' } } },
      { onSuccess: () => setShowConfirmRemove(false) },
    );
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <FontAwesomeIcon icon={faSpinner} className="text-2xl text-gray-300 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-4 py-8 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t.tools.title}</h1>
          <p className="mt-1 text-sm text-gray-400">{t.tools.subtitle}</p>
        </div>

        {/* Brave Search Card */}
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-500">
                <FontAwesomeIcon icon={faSearch} className="text-sm" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">{t.tools.braveSearchName}</h3>
                <p className="mt-0.5 text-xs text-gray-400 max-w-sm">{t.tools.braveSearchDescription}</p>
              </div>
            </div>

            {/* Toggle */}
            <button
              onClick={handleToggle}
              disabled={updateMutation.isPending}
              className={[
                'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
                isEnabled ? 'bg-black' : 'bg-gray-200',
                updateMutation.isPending ? 'opacity-60' : '',
              ].join(' ')}
              role="switch"
              aria-checked={isEnabled}
            >
              <span
                className={[
                  'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform ring-0 transition duration-200 ease-in-out',
                  isEnabled ? 'translate-x-5' : 'translate-x-0',
                ].join(' ')}
              />
            </button>
          </div>

          {/* Status + key management */}
          <div className="flex items-center gap-2 text-xs">
            <span className={isEnabled ? 'text-green-600 font-medium' : 'text-gray-400'}>
              {isEnabled ? t.tools.enabled : t.tools.disabled}
            </span>
          </div>

          {hasKey && (
            <div className="flex items-center gap-3 pt-1">
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <FontAwesomeIcon icon={faKey} className="text-gray-300" />
                <span>{t.tools.keySecured}</span>
              </div>
              <button
                onClick={handleEditKey}
                className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 transition-colors duration-150"
              >
                <FontAwesomeIcon icon={faPen} className="text-[10px]" />
                {t.tools.editApiKey}
              </button>
              <button
                onClick={() => setShowConfirmRemove(true)}
                className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-600 transition-colors duration-150"
              >
                <FontAwesomeIcon icon={faTrash} className="text-[10px]" />
                {t.tools.removeApiKey}
              </button>
            </div>
          )}

          {!hasKey && !isEnabled && (
            <p className="text-xs text-gray-400">{t.tools.getApiKey}</p>
          )}
        </div>

        {/* Confirm Remove Dialog */}
        {showConfirmRemove && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
            <div className="mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl space-y-4">
              <p className="text-sm text-gray-700">{t.tools.removeApiKeyConfirm}</p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowConfirmRemove(false)}
                  className="rounded-full px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-all duration-150"
                >
                  {t.tools.cancel}
                </button>
                <button
                  onClick={handleRemoveKey}
                  disabled={updateMutation.isPending}
                  className="flex items-center gap-2 rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 active:scale-[0.98] transition-all duration-150 disabled:opacity-60"
                >
                  {updateMutation.isPending && <FontAwesomeIcon icon={faSpinner} className="text-xs animate-spin" />}
                  {t.tools.removeApiKey}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* API Key Modal */}
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
            <div className="mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl space-y-4">
              <h3 className="text-base font-semibold text-gray-900">
                {hasKey ? t.tools.editApiKey : t.tools.addApiKey}
              </h3>
              <div>
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder={t.tools.apiKeyPlaceholder}
                  autoFocus
                  className="w-full rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-800 placeholder-gray-400 outline-none focus:border-gray-400 focus:shadow-sm transition-all duration-150"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveKey(); }}
                />
                <p className="mt-2 text-xs text-gray-400">{t.tools.getApiKey}</p>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => { setShowModal(false); setApiKeyInput(''); }}
                  className="rounded-full px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-all duration-150"
                >
                  {t.tools.cancel}
                </button>
                <button
                  onClick={handleSaveKey}
                  disabled={!apiKeyInput.trim() || updateMutation.isPending}
                  className="flex items-center gap-2 rounded-full bg-black px-5 py-2 text-sm font-medium text-white hover:bg-gray-900 active:scale-[0.98] transition-all duration-150 disabled:opacity-60"
                >
                  {updateMutation.isPending && <FontAwesomeIcon icon={faSpinner} className="text-xs animate-spin" />}
                  {t.tools.save}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
