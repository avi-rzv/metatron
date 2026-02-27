import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark, faPlus, faTrash, faSpinner, faPen, faUsers, faUserGroup } from '@fortawesome/free-solid-svg-icons';
import { api } from '@/api';
import { t } from '@/i18n';
import type { WhatsAppGroupPermission, WhatsAppGroup } from '@/types';

type Tab = 'contacts' | 'groups';

interface Props {
  onClose: () => void;
}

export function WhatsAppPermissionsModal({ onClose }: Props) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('contacts');
  const [phoneInput, setPhoneInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteType, setConfirmDeleteType] = useState<Tab>('contacts');
  const [editingInstructionsId, setEditingInstructionsId] = useState<string | null>(null);
  const [instructionsText, setInstructionsText] = useState('');
  const [showGroupPicker, setShowGroupPicker] = useState(false);

  // --- Contacts queries ---
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

  // --- Groups queries ---
  const { data: groupPermissions = [], isLoading: isLoadingGroups } = useQuery({
    queryKey: ['whatsapp-group-permissions'],
    queryFn: api.whatsapp.groupPermissions.list,
  });

  const { data: availableGroupsData } = useQuery({
    queryKey: ['whatsapp-groups'],
    queryFn: api.whatsapp.groups,
    enabled: tab === 'groups',
  });
  const availableGroups: WhatsAppGroup[] = availableGroupsData?.groups ?? [];

  const createGroupMutation = useMutation({
    mutationFn: (data: { groupJid: string; groupName: string }) =>
      api.whatsapp.groupPermissions.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['whatsapp-group-permissions'] });
      setShowGroupPicker(false);
    },
  });

  const updateGroupMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { canRead?: boolean; canReply?: boolean; chatInstructions?: string | null } }) =>
      api.whatsapp.groupPermissions.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['whatsapp-group-permissions'] });
    },
  });

  const deleteGroupMutation = useMutation({
    mutationFn: (id: string) => api.whatsapp.groupPermissions.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['whatsapp-group-permissions'] });
      setConfirmDeleteId(null);
    },
  });

  const handleAdd = () => {
    if (!phoneInput.trim() || !nameInput.trim()) return;
    createMutation.mutate({ phoneNumber: phoneInput.trim(), displayName: nameInput.trim() });
  };

  // Filter groups not already in permissions
  const existingJids = new Set(groupPermissions.map((p: WhatsAppGroupPermission) => p.groupJid));
  const addableGroups = availableGroups.filter(g => !existingJids.has(g.id));

  const handleDeleteConfirm = () => {
    if (!confirmDeleteId) return;
    if (confirmDeleteType === 'contacts') {
      deleteMutation.mutate(confirmDeleteId);
    } else {
      deleteGroupMutation.mutate(confirmDeleteId);
    }
  };

  // Shared toggle component
  const Toggle = ({ checked, onChange }: { checked: boolean; onChange: () => void }) => (
    <button
      onClick={onChange}
      dir="ltr"
      className={[
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
        checked ? 'bg-black' : 'bg-gray-200',
      ].join(' ')}
      role="switch"
      aria-checked={checked}
    >
      <span
        className={[
          'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform ring-0 transition duration-200 ease-in-out',
          checked ? 'translate-x-4' : 'translate-x-0',
        ].join(' ')}
      />
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-lg rounded-2xl bg-white shadow-xl flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-3">
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

        {/* Tab bar */}
        <div className="flex gap-1 mx-6 mb-4 rounded-xl bg-gray-100 p-1">
          <button
            onClick={() => { setTab('contacts'); setEditingInstructionsId(null); setShowGroupPicker(false); }}
            className={[
              'flex-1 flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150',
              tab === 'contacts' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700',
            ].join(' ')}
          >
            <FontAwesomeIcon icon={faUsers} className="text-[11px]" />
            {t.whatsapp.contactsTab}
          </button>
          <button
            onClick={() => { setTab('groups'); setEditingInstructionsId(null); }}
            className={[
              'flex-1 flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150',
              tab === 'groups' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700',
            ].join(' ')}
          >
            <FontAwesomeIcon icon={faUserGroup} className="text-[11px]" />
            {t.whatsapp.groupsTab}
          </button>
        </div>

        {/* === Contacts Tab === */}
        {tab === 'contacts' && (
          <>
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
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{perm.displayName}</p>
                          <p className="text-xs text-gray-400">{perm.phoneNumber}</p>
                        </div>

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

                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] text-gray-400">{t.whatsapp.readAccess}</span>
                          <Toggle checked={perm.canRead} onChange={() => updateMutation.mutate({ id: perm.id, data: { canRead: !perm.canRead } })} />
                        </div>

                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] text-gray-400">{t.whatsapp.replyAccess}</span>
                          <Toggle checked={perm.canReply} onChange={() => updateMutation.mutate({ id: perm.id, data: { canReply: !perm.canReply } })} />
                        </div>

                        <button
                          onClick={() => { setConfirmDeleteId(perm.id); setConfirmDeleteType('contacts'); }}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-gray-300 hover:bg-red-50 hover:text-red-500 transition-all duration-150"
                        >
                          <FontAwesomeIcon icon={faTrash} className="text-[10px]" />
                        </button>
                      </div>

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
          </>
        )}

        {/* === Groups Tab === */}
        {tab === 'groups' && (
          <>
            {/* Add group button / picker */}
            <div className="px-6 pb-4">
              {showGroupPicker ? (
                <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                  <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-500">{t.whatsapp.selectGroup}</span>
                    <button
                      onClick={() => setShowGroupPicker(false)}
                      className="flex h-6 w-6 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-all duration-150"
                    >
                      <FontAwesomeIcon icon={faXmark} className="text-[10px]" />
                    </button>
                  </div>
                  <div className="max-h-40 overflow-y-auto">
                    {addableGroups.length === 0 ? (
                      <p className="px-3 py-4 text-center text-xs text-gray-400">
                        {availableGroups.length === 0 ? t.whatsapp.noGroupsAvailable : t.whatsapp.noGroupsAvailable}
                      </p>
                    ) : (
                      addableGroups.map((group) => (
                        <button
                          key={group.id}
                          onClick={() => createGroupMutation.mutate({ groupJid: group.id, groupName: group.name })}
                          disabled={createGroupMutation.isPending}
                          className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 transition-all duration-150 text-start"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{group.name}</p>
                            <p className="text-xs text-gray-400">{group.participants} {t.whatsapp.groupParticipants}</p>
                          </div>
                          <FontAwesomeIcon icon={faPlus} className="text-xs text-gray-400" />
                        </button>
                      ))
                    )}
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowGroupPicker(true)}
                  className="flex items-center gap-2 rounded-full bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-900 active:scale-[0.98] transition-all duration-150"
                >
                  <FontAwesomeIcon icon={faPlus} className="text-xs" />
                  {t.whatsapp.addGroup}
                </button>
              )}
            </div>

            {/* Scrollable list */}
            <div className="flex-1 overflow-y-auto px-6 pb-6">
              {isLoadingGroups ? (
                <div className="flex items-center justify-center py-8">
                  <FontAwesomeIcon icon={faSpinner} className="text-xl text-gray-300 animate-spin" />
                </div>
              ) : groupPermissions.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-400">{t.whatsapp.noGroupPermissions}</p>
              ) : (
                <div className="space-y-2">
                  {groupPermissions.map((gp: WhatsAppGroupPermission) => (
                    <div key={gp.id}>
                      <div className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/50 px-4 py-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{gp.groupName}</p>
                        </div>

                        <button
                          onClick={() => {
                            if (editingInstructionsId === gp.id) {
                              setEditingInstructionsId(null);
                            } else {
                              setEditingInstructionsId(gp.id);
                              setInstructionsText(gp.chatInstructions ?? '');
                            }
                          }}
                          className={[
                            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all duration-150',
                            gp.chatInstructions
                              ? 'text-blue-500 hover:bg-blue-50'
                              : 'text-gray-300 hover:bg-gray-100 hover:text-gray-500',
                          ].join(' ')}
                          title={t.whatsapp.chatInstructions}
                        >
                          <FontAwesomeIcon icon={faPen} className="text-[10px]" />
                        </button>

                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] text-gray-400">{t.whatsapp.readAccess}</span>
                          <Toggle checked={gp.canRead} onChange={() => updateGroupMutation.mutate({ id: gp.id, data: { canRead: !gp.canRead } })} />
                        </div>

                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] text-gray-400">{t.whatsapp.replyAccess}</span>
                          <Toggle checked={gp.canReply} onChange={() => updateGroupMutation.mutate({ id: gp.id, data: { canReply: !gp.canReply } })} />
                        </div>

                        <button
                          onClick={() => { setConfirmDeleteId(gp.id); setConfirmDeleteType('groups'); }}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-gray-300 hover:bg-red-50 hover:text-red-500 transition-all duration-150"
                        >
                          <FontAwesomeIcon icon={faTrash} className="text-[10px]" />
                        </button>
                      </div>

                      {editingInstructionsId === gp.id && (
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
                                updateGroupMutation.mutate(
                                  { id: gp.id, data: { chatInstructions: instructionsText.trim() || null } },
                                  { onSuccess: () => setEditingInstructionsId(null) },
                                );
                              }}
                              disabled={updateGroupMutation.isPending}
                              className="flex items-center gap-1.5 rounded-full bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-900 active:scale-[0.98] transition-all duration-150 disabled:opacity-60"
                            >
                              {updateGroupMutation.isPending && <FontAwesomeIcon icon={faSpinner} className="text-[10px] animate-spin" />}
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
          </>
        )}

        {/* Delete confirm dialog */}
        {confirmDeleteId && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-black/20 backdrop-blur-[2px]">
            <div className="mx-4 w-full max-w-xs rounded-2xl bg-white p-6 shadow-xl space-y-4">
              <p className="text-sm text-gray-700">
                {confirmDeleteType === 'contacts' ? t.whatsapp.removePermissionConfirm : t.whatsapp.removeGroupConfirm}
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setConfirmDeleteId(null)}
                  className="rounded-full px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-all duration-150"
                >
                  {t.whatsapp.cancel}
                </button>
                <button
                  onClick={handleDeleteConfirm}
                  disabled={deleteMutation.isPending || deleteGroupMutation.isPending}
                  className="flex items-center gap-2 rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 active:scale-[0.98] transition-all duration-150 disabled:opacity-60"
                >
                  {(deleteMutation.isPending || deleteGroupMutation.isPending) && <FontAwesomeIcon icon={faSpinner} className="text-xs animate-spin" />}
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
