import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSpinner, faSearch, faKey, faPen, faTrash, faCheck, faLinkSlash, faLink, faShieldHalved } from '@fortawesome/free-solid-svg-icons';
import { faWhatsapp } from '@fortawesome/free-brands-svg-icons';
import { api, streamWhatsAppQR } from '@/api';
import { PageTopBar } from '@/components/layout/PageTopBar';
import { WhatsAppPermissionsModal } from '@/components/whatsapp/WhatsAppPermissionsModal';
import { t } from '@/i18n';

export function ToolsPage() {
  const qc = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings.get,
  });

  // Brave Search state
  const [showModal, setShowModal] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showConfirmRemove, setShowConfirmRemove] = useState(false);

  // WhatsApp state
  const { data: waStatusData } = useQuery({
    queryKey: ['whatsapp-status'],
    queryFn: api.whatsapp.status,
    refetchInterval: 10_000,
  });
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState<string | null>(null);
  const [streamPhone, setStreamPhone] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [clearSession, setClearSession] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [showPermissions, setShowPermissions] = useState(false);
  const streamRef = useRef<AbortController | null>(null);

  const waStatus = streamStatus ?? waStatusData?.status ?? 'disconnected';
  const waPhoneNumber = streamPhone ?? waStatusData?.phoneNumber ?? null;
  const waConnected = waStatus === 'connected';
  const waQrReady = waStatus === 'qr_ready';

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.abort();
      streamRef.current = null;
    }
  }, []);

  useEffect(() => () => stopStream(), [stopStream]);

  // Brave Search handlers
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
      setApiKeyInput('');
      setShowModal(true);
      return;
    }
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

  // WhatsApp handlers
  const handleLinkDevice = async () => {
    setIsConnecting(true);
    setQrDataUrl(null);
    setStreamStatus('connecting');

    stopStream();
    streamRef.current = streamWhatsAppQR({
      onQr: (qr) => {
        setQrDataUrl(qr);
        setStreamStatus('qr_ready');
      },
      onStatus: (s, phone) => {
        setStreamStatus(s);
        if (phone) setStreamPhone(phone);
        if (s === 'connected') {
          setIsConnecting(false);
          setQrDataUrl(null);
          stopStream();
          qc.invalidateQueries({ queryKey: ['whatsapp-status'] });
        }
        if (s === 'disconnected') {
          setIsConnecting(false);
          setQrDataUrl(null);
        }
      },
      onConnected: (phone) => {
        setStreamPhone(phone);
        setStreamStatus('connected');
        setIsConnecting(false);
        setQrDataUrl(null);
        stopStream();
        qc.invalidateQueries({ queryKey: ['whatsapp-status'] });
      },
      onClose: () => {
        setIsConnecting(false);
        setStreamStatus(null);
        setQrDataUrl(null);
        qc.invalidateQueries({ queryKey: ['whatsapp-status'] });
      },
      onError: () => {
        setIsConnecting(false);
        setStreamStatus('disconnected');
      },
    });

    try {
      await api.whatsapp.connect();
    } catch {
      setIsConnecting(false);
      setStreamStatus('disconnected');
      stopStream();
    }
  };

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      await api.whatsapp.disconnect(clearSession);
      setStreamStatus('disconnected');
      setStreamPhone(null);
      setQrDataUrl(null);
      qc.invalidateQueries({ queryKey: ['whatsapp-status'] });
    } finally {
      setIsDisconnecting(false);
      setShowDisconnectConfirm(false);
      setClearSession(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <FontAwesomeIcon icon={faSpinner} className="text-2xl text-gray-300 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <PageTopBar title={t.tools.title} />
      <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-4 py-8 space-y-6">

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
              dir="ltr"
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

        {/* WhatsApp Card */}
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-green-50 text-green-600">
                <FontAwesomeIcon icon={faWhatsapp} className="text-lg" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">{t.whatsapp.title}</h3>
                <p className="mt-0.5 text-xs text-gray-400 max-w-sm">{t.whatsapp.subtitle}</p>
              </div>
            </div>

            {/* Status badge */}
            <span
              className={[
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
                waConnected
                  ? 'bg-green-50 text-green-700'
                  : waStatus === 'connecting' || waQrReady
                    ? 'bg-yellow-50 text-yellow-700'
                    : 'bg-gray-100 text-gray-500',
              ].join(' ')}
            >
              {waConnected && <FontAwesomeIcon icon={faCheck} className="text-[10px]" />}
              {waConnected
                ? t.whatsapp.connected
                : waStatus === 'connecting' || waQrReady
                  ? t.whatsapp.connecting
                  : t.whatsapp.disconnected}
            </span>
          </div>

          {/* Connected state */}
          {waConnected && (
            <div className="space-y-3">
              {waPhoneNumber && (
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <span className="text-xs text-gray-400">{t.whatsapp.phoneNumber}:</span>
                  <span className="font-medium">+{waPhoneNumber}</span>
                </div>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setShowPermissions(true)}
                  className="flex items-center gap-2 rounded-full bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-900 active:scale-[0.98] transition-all duration-150"
                >
                  <FontAwesomeIcon icon={faShieldHalved} className="text-xs" />
                  {t.whatsapp.managePermissions}
                </button>
                <button
                  onClick={() => setShowDisconnectConfirm(true)}
                  className="flex items-center gap-2 rounded-full bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 active:scale-[0.98] transition-all duration-150"
                >
                  <FontAwesomeIcon icon={faLinkSlash} className="text-xs" />
                  {t.whatsapp.disconnect}
                </button>
              </div>
            </div>
          )}

          {/* QR code display */}
          {waQrReady && qrDataUrl && (
            <div className="flex flex-col items-center gap-3 py-2">
              <p className="text-sm text-gray-600">{t.whatsapp.scanQR}</p>
              <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
                <img src={qrDataUrl} alt="WhatsApp QR Code" className="h-64 w-64" />
              </div>
              <p className="text-xs text-gray-400 text-center max-w-xs">{t.whatsapp.scanInstructions}</p>
            </div>
          )}

          {/* Connecting but no QR yet */}
          {(waStatus === 'connecting' && !qrDataUrl) && (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-gray-400">
              <FontAwesomeIcon icon={faSpinner} className="animate-spin" />
              {t.whatsapp.waitingForQR}
            </div>
          )}

          {/* Disconnected: show link button */}
          {!waConnected && !isConnecting && waStatus === 'disconnected' && (
            <button
              onClick={handleLinkDevice}
              className="flex items-center gap-2 rounded-full bg-black px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-900 active:scale-[0.98] transition-all duration-150"
            >
              <FontAwesomeIcon icon={faLink} className="text-xs" />
              {t.whatsapp.linkDevice}
            </button>
          )}
        </div>

        {/* Confirm Remove Dialog (Brave Search) */}
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

        {/* API Key Modal (Brave Search) */}
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

        {/* WhatsApp Disconnect Confirm Dialog */}
        {showDisconnectConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
            <div className="mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl space-y-4">
              <p className="text-sm text-gray-700">{t.whatsapp.disconnectConfirm}</p>
              <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={clearSession}
                  onChange={(e) => setClearSession(e.target.checked)}
                  className="rounded border-gray-300"
                />
                {t.whatsapp.disconnectClearSession}
              </label>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => { setShowDisconnectConfirm(false); setClearSession(false); }}
                  className="rounded-full px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-all duration-150"
                >
                  {t.whatsapp.cancel}
                </button>
                <button
                  onClick={handleDisconnect}
                  disabled={isDisconnecting}
                  className="flex items-center gap-2 rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 active:scale-[0.98] transition-all duration-150 disabled:opacity-60"
                >
                  {isDisconnecting && <FontAwesomeIcon icon={faSpinner} className="text-xs animate-spin" />}
                  {t.whatsapp.yes}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* WhatsApp Permissions Modal */}
        {showPermissions && (
          <WhatsAppPermissionsModal onClose={() => setShowPermissions(false)} />
        )}
      </div>
      </div>
    </div>
  );
}
