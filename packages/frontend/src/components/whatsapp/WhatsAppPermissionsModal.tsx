import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark, faPlus, faTrash, faSpinner, faPen } from '@fortawesome/free-solid-svg-icons';
import { api } from '@/api';
import { t } from '@/i18n';

interface Props {
  onClose: () => void;
}

export function WhatsAppPermissionsModal({ onClose }: Props) {
  const qc = useQueryClient();
  const [phoneInput, setPhoneInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingInstructionsId, setEditingInstructionsId] = useState<string | null>(null);
  const [instructionsText, setInstructionsText] = useState('');

  const { data: permissions = [], isLoading } = useQuery({
    queryKey: ['whatsapp-permissions'],
    queryFn: api.whatsapp.permissions.list,
  });

  const createMutation = useMutation({
    mutationFn: (data: { phoneNumber: string; displayName: string }) =>
      api.whatsapp.permissions.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['whatsapp-permissions'] });
      setPhoneInput('');
      setNameInput('');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { canRead?: boolean; canReply?: boolean; chatInstructions?: string | null } }) =>
      api.whatsapp.permissions.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['whatsapp-permissions'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.whatsapp.permissions.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['whatsapp-permissions'] });
      setConfirmDeleteId(null);
    },
  });

  const handleAdd = () => {
    if (!phoneInput.trim() || !nameInput.trim()) return;
    createMutation.mutate({ phoneNumber: phoneInput.trim(), displayName: nameInput.trim() });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-lg rounded-2xl bg-white shadow-xl flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{t.whatsapp.permissionsTitle}</h2>
            <p className="mt-0.5 text-xs text-gray-400">{t.whatsapp.permissionsSubtitle}</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-all duration-150"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        {/* Add contact row */}
        <div className="flex items-center gap-2 px-6 pb-4">
          <input
            type="text"
            value={phoneInput}
            onChange={(e) => setPhoneInput(e.target.value)}
            placeholder={t.whatsapp.phonePlaceholder}
            className="flex-1 min-w-0 rounded-full border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder-gray-400 outline-none focus:border-gray-400 transition-all duration-150"
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
          />
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder={t.whatsapp.namePlaceholder}
            className="flex-1 min-w-0 rounded-full border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder-gray-400 outline-none focus:border-gray-400 transition-all duration-150"
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
          />
          <button
            onClick={handleAdd}
            disabled={!phoneInput.trim() || !nameInput.trim() || createMutation.isPending}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black text-white hover:bg-gray-900 active:scale-[0.95] transition-all duration-150 disabled:opacity-40"
          >
            {createMutation.isPending
              ? <FontAwesomeIcon icon={faSpinner} className="text-xs animate-spin" />
              : <FontAwesomeIcon icon={faPlus} className="text-xs" />}
          </button>
        </div>

        {/* Scrollable list */}
        <div className="flex-1 overflow-y-auto px-6 pb-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <FontAwesomeIcon icon={faSpinner} className="text-xl text-gray-300 animate-spin" />
            </div>
          ) : permissions.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">{t.whatsapp.noPermissions}</p>
          ) : (
            <div className="space-y-2">
              {permissions.map((perm) => (
                <div key={perm.id}>
                  <div className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/50 px-4 py-3">
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{perm.displayName}</p>
                      <p className="text-xs text-gray-400">{perm.phoneNumber}</p>
                    </div>

                    {/* Chat instructions toggle */}
                    <button
                      onClick={() => {
                        if (editingInstructionsId === perm.id) {
                          setEditingInstructionsId(null);
                        } else {
                          setEditingInstructionsId(perm.id);
                          setInstructionsText(perm.chatInstructions ?? '');
                        }
                      }}
                      className={[
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all duration-150',
                        perm.chatInstructions
                          ? 'text-blue-500 hover:bg-blue-50'
                          : 'text-gray-300 hover:bg-gray-100 hover:text-gray-500',
                      ].join(' ')}
                      title={t.whatsapp.chatInstructions}
                    >
                      <FontAwesomeIcon icon={faPen} className="text-[10px]" />
                    </button>

                    {/* Read toggle */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-gray-400">{t.whatsapp.readAccess}</span>
                      <button
                        onClick={() => updateMutation.mutate({ id: perm.id, data: { canRead: !perm.canRead } })}
                        dir="ltr"
                        className={[
                          'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
                          perm.canRead ? 'bg-black' : 'bg-gray-200',
                        ].join(' ')}
                        role="switch"
                        aria-checked={perm.canRead}
                      >
                        <span
                          className={[
                            'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform ring-0 transition duration-200 ease-in-out',
                            perm.canRead ? 'translate-x-4' : 'translate-x-0',
                          ].join(' ')}
                        />
                      </button>
                    </div>

                    {/* Reply toggle */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-gray-400">{t.whatsapp.replyAccess}</span>
                      <button
                        onClick={() => updateMutation.mutate({ id: perm.id, data: { canReply: !perm.canReply } })}
                        dir="ltr"
                        className={[
                          'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
                          perm.canReply ? 'bg-black' : 'bg-gray-200',
                        ].join(' ')}
                        role="switch"
                        aria-checked={perm.canReply}
                      >
                        <span
                          className={[
                            'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform ring-0 transition duration-200 ease-in-out',
                            perm.canReply ? 'translate-x-4' : 'translate-x-0',
                          ].join(' ')}
                        />
                      </button>
                    </div>

                    {/* Delete */}
                    <button
                      onClick={() => setConfirmDeleteId(perm.id)}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-gray-300 hover:bg-red-50 hover:text-red-500 transition-all duration-150"
                    >
                      <FontAwesomeIcon icon={faTrash} className="text-[10px]" />
                    </button>
                  </div>

                  {/* Collapsible instructions editor */}
                  {editingInstructionsId === perm.id && (
                    <div className="mt-1 ms-4 me-4 rounded-xl border border-gray-100 bg-white p-3 space-y-2">
                      <label className="text-xs font-medium text-gray-500">{t.whatsapp.chatInstructions}</label>
                      <textarea
                        value={instructionsText}
                        onChange={(e) => setInstructionsText(e.target.value)}
                        placeholder={t.whatsapp.chatInstructionsPlaceholder}
                        rows={3}
                        className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800 placeholder-gray-400 outline-none focus:border-gray-400 resize-none transition-all duration-150"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => setEditingInstructionsId(null)}
                          className="rounded-full px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 transition-all duration-150"
                        >
                          {t.whatsapp.cancel}
                        </button>
                        <button
                          onClick={() => {
                            updateMutation.mutate(
                              { id: perm.id, data: { chatInstructions: instructionsText.trim() || null } },
                              { onSuccess: () => setEditingInstructionsId(null) },
                            );
                          }}
                          disabled={updateMutation.isPending}
                          className="flex items-center gap-1.5 rounded-full bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-900 active:scale-[0.98] transition-all duration-150 disabled:opacity-60"
                        >
                          {updateMutation.isPending && <FontAwesomeIcon icon={faSpinner} className="text-[10px] animate-spin" />}
                          {t.whatsapp.save}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Delete confirm dialog */}
        {confirmDeleteId && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-black/20 backdrop-blur-[2px]">
            <div className="mx-4 w-full max-w-xs rounded-2xl bg-white p-6 shadow-xl space-y-4">
              <p className="text-sm text-gray-700">{t.whatsapp.removePermissionConfirm}</p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setConfirmDeleteId(null)}
                  className="rounded-full px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-all duration-150"
                >
                  {t.whatsapp.cancel}
                </button>
                <button
                  onClick={() => deleteMutation.mutate(confirmDeleteId)}
                  disabled={deleteMutation.isPending}
                  className="flex items-center gap-2 rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 active:scale-[0.98] transition-all duration-150 disabled:opacity-60"
                >
                  {deleteMutation.isPending && <FontAwesomeIcon icon={faSpinner} className="text-xs animate-spin" />}
                  {t.whatsapp.removePermission}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
