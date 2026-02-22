import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSpinner, faCheck } from '@fortawesome/free-solid-svg-icons';
import { api } from '@/api';
import { t } from '@/i18n';

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-gray-400">{description}</p>}
      </div>
      {children}
    </div>
  );
}

export function SystemInstructionPage() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['system-instruction'],
    queryFn: api.systemInstruction.get,
  });

  const [coreInstruction, setCoreInstruction] = useState('');
  const [memory, setMemory] = useState('');
  const [memoryEnabled, setMemoryEnabled] = useState(true);

  useEffect(() => {
    if (data) {
      setCoreInstruction(data.coreInstruction);
      setMemory(data.memory);
      setMemoryEnabled(data.memoryEnabled);
    }
  }, [data]);

  const [savedSection, setSavedSection] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: api.systemInstruction.update,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['system-instruction'] });
    },
  });

  const saveCoreInstruction = async () => {
    await saveMutation.mutateAsync({ coreInstruction });
    setSavedSection('core');
    setTimeout(() => setSavedSection(null), 2000);
  };

  const saveMemory = async () => {
    await saveMutation.mutateAsync({ memory });
    setSavedSection('memory');
    setTimeout(() => setSavedSection(null), 2000);
  };

  const toggleMemoryEnabled = async () => {
    const newValue = !memoryEnabled;
    setMemoryEnabled(newValue);
    await saveMutation.mutateAsync({ memoryEnabled: newValue });
  };

  const clearMemory = async () => {
    if (!confirm(t.systemInstruction.clearMemoryConfirm)) return;
    await api.systemInstruction.clearMemory();
    setMemory('');
    qc.invalidateQueries({ queryKey: ['system-instruction'] });
  };

  const clearDbSchema = async () => {
    if (!confirm(t.systemInstruction.clearSchemaConfirm)) return;
    await api.systemInstruction.clearDbSchema();
    qc.invalidateQueries({ queryKey: ['system-instruction'] });
  };

  function SaveButton({ section, onClick }: { section: string; onClick: () => void }) {
    const isSaving = saveMutation.isPending;
    const isSaved = savedSection === section && !isSaving;
    return (
      <button
        onClick={onClick}
        disabled={isSaving}
        className="flex items-center gap-2 rounded-full bg-black px-5 py-2 text-sm font-medium text-white hover:bg-gray-900 active:scale-[0.98] transition-all duration-150 disabled:opacity-60"
      >
        {isSaving && <FontAwesomeIcon icon={faSpinner} className="text-xs animate-spin" />}
        {isSaved && <FontAwesomeIcon icon={faCheck} className="text-xs" />}
        {isSaving ? t.systemInstruction.saving : isSaved ? t.systemInstruction.saved : t.systemInstruction.save}
      </button>
    );
  }

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
          <h1 className="text-2xl font-semibold text-gray-900">{t.systemInstruction.title}</h1>
          <p className="mt-1 text-sm text-gray-400">{t.systemInstruction.subtitle}</p>
        </div>

        {/* Core Instruction */}
        <Section
          title={t.systemInstruction.coreInstruction}
          description={t.systemInstruction.coreInstructionDescription}
        >
          <textarea
            value={coreInstruction}
            onChange={(e) => setCoreInstruction(e.target.value)}
            placeholder={t.systemInstruction.coreInstructionPlaceholder}
            rows={14}
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800 font-mono placeholder-gray-400 outline-none focus:border-gray-400 focus:shadow-sm transition-all duration-150 resize-y"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">
              {coreInstruction.length} {t.systemInstruction.charCount}
            </span>
            <SaveButton section="core" onClick={saveCoreInstruction} />
          </div>
        </Section>

        {/* Dynamic Memory */}
        <Section
          title={t.systemInstruction.memory}
          description={t.systemInstruction.memoryDescription}
        >
          {/* Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700">{t.systemInstruction.enableTools}</p>
              <p className="text-xs text-gray-400">{t.systemInstruction.enableToolsDescription}</p>
            </div>
            <button
              onClick={toggleMemoryEnabled}
              className={[
                'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out',
                memoryEnabled ? 'bg-black' : 'bg-gray-200',
              ].join(' ')}
              role="switch"
              aria-checked={memoryEnabled}
            >
              <span
                className={[
                  'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                  memoryEnabled ? 'translate-x-5' : 'translate-x-0',
                ].join(' ')}
              />
            </button>
          </div>

          <textarea
            value={memory}
            onChange={(e) => setMemory(e.target.value)}
            placeholder={t.systemInstruction.memoryPlaceholder}
            rows={6}
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800 font-mono placeholder-gray-400 outline-none focus:border-gray-400 focus:shadow-sm transition-all duration-150 resize-y"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">
              {memory.length} / 4,000 {t.systemInstruction.charCount}
            </span>
            <div className="flex gap-2">
              <button
                onClick={clearMemory}
                className="rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 active:scale-[0.98] transition-all duration-150"
              >
                {t.systemInstruction.clear}
              </button>
              <SaveButton section="memory" onClick={saveMemory} />
            </div>
          </div>
          {data?.updatedAt && (
            <p className="text-xs text-gray-400">
              {t.systemInstruction.lastUpdated}: {new Date(data.updatedAt).toLocaleString()}
            </p>
          )}
        </Section>

        {/* Database Schema */}
        <Section
          title={t.systemInstruction.dbSchema}
          description={t.systemInstruction.dbSchemaDescription}
        >
          <textarea
            value={data?.dbSchema || ''}
            readOnly
            placeholder={t.systemInstruction.dbSchemaPlaceholder}
            rows={8}
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600 font-mono placeholder-gray-400 outline-none resize-y cursor-default"
          />
          <div className="flex justify-end">
            <button
              onClick={clearDbSchema}
              className="rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 active:scale-[0.98] transition-all duration-150"
            >
              {t.systemInstruction.clear}
            </button>
          </div>
        </Section>
      </div>
    </div>
  );
}
