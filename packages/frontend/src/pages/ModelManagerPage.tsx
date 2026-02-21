import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faKey, faCheck, faSpinner, faEye, faEyeSlash } from '@fortawesome/free-solid-svg-icons';
import { api } from '@/api';
import { t } from '@/i18n';
import { GEMINI_MODELS, GEMINI_IMAGE_MODELS, OPENAI_MODELS, OPENAI_IMAGE_MODELS } from '@/types';

type ThinkingLevel = 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';
type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

const thinkingLevels: ThinkingLevel[] = ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'];
const reasoningEfforts: ReasoningEffort[] = ['minimal', 'low', 'medium', 'high'];

interface SelectGroupProps<T extends string> {
  label: string;
  value: T;
  options: readonly { id: T; label: string }[] | readonly string[];
  onChange: (v: T) => void;
  getLabelFn?: (id: T) => string;
}

function SelectGroup<T extends string>({ label, value, options, onChange, getLabelFn }: SelectGroupProps<T>) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-400">{label}</p>
      <div className="flex flex-wrap gap-2">
        {(options as readonly (T | { id: T; label: string })[]).map((opt) => {
          const id = typeof opt === 'string' ? opt as T : (opt as { id: T }).id;
          const displayLabel = getLabelFn
            ? getLabelFn(id)
            : typeof opt === 'string'
            ? opt
            : (opt as { id: T; label: string }).label;
          const active = value === id;
          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              className={[
                'rounded-full px-4 py-1.5 text-sm font-medium border transition-all duration-150 active:scale-95',
                active
                  ? 'bg-black text-white border-black'
                  : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400 hover:bg-gray-50',
              ].join(' ')}
            >
              {displayLabel}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface ApiKeyFieldProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  secured?: boolean;
  maskedValue?: string;
}

function ApiKeyField({ value, onChange, placeholder, secured, maskedValue }: ApiKeyFieldProps) {
  const [show, setShow] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // When parent clears value (after save), exit editing mode
  useEffect(() => {
    if (!value) setIsEditing(false);
  }, [value]);

  // Showing the saved masked key (not in edit mode for new key entry)
  const showingMasked = secured && !!maskedValue && !isEditing;

  const handleMaskedClick = () => {
    setIsEditing(true);
    onChange('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  return (
    <div className="relative flex items-center">
      <FontAwesomeIcon icon={faKey} className="absolute left-3 text-gray-300 text-xs" />
      {showingMasked ? (
        <input
          ref={inputRef}
          type={show ? 'text' : 'password'}
          value={show ? maskedValue : '***'}
          readOnly
          onClick={handleMaskedClick}
          className="w-full cursor-pointer rounded-full border border-gray-200 bg-white py-2 pl-8 pr-10 text-sm text-gray-800 placeholder-gray-400 outline-none focus:border-gray-400 focus:shadow-sm transition-all duration-150"
        />
      ) : (
        <input
          ref={inputRef}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? t.modelManager.apiKeyPlaceholder}
          className="w-full rounded-full border border-gray-200 bg-white py-2 pl-8 pr-10 text-sm text-gray-800 placeholder-gray-400 outline-none focus:border-gray-400 focus:shadow-sm transition-all duration-150"
        />
      )}
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-3 text-gray-400 hover:text-gray-700 transition-colors duration-150"
        aria-label={show ? 'Hide key' : 'Show key'}
      >
        <FontAwesomeIcon icon={show ? faEyeSlash : faEye} className="text-xs" />
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm space-y-5">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      {children}
    </div>
  );
}

export function ModelManagerPage() {
  const qc = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings.get,
  });

  const [geminiKey, setGeminiKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');

  const [geminiModel, setGeminiModel] = useState('gemini-3-pro-preview');
  const [geminiThinking, setGeminiThinking] = useState<ThinkingLevel>('MEDIUM');
  const [geminiImage, setGeminiImage] = useState('gemini-3-pro-image-preview');

  const [openaiModel, setOpenaiModel] = useState('gpt-5.2');
  const [openaiReasoning, setOpenaiReasoning] = useState<ReasoningEffort>('medium');
  const [openaiImage, setOpenaiImage] = useState('gpt-image-1');

  // Sync local state from loaded settings (useState initial value is ignored after first render)
  useEffect(() => {
    if (settings) {
      setGeminiModel(settings.gemini.defaultModel);
      setGeminiThinking(settings.gemini.thinkingLevel);
      setGeminiImage(settings.gemini.imageModel);
      setOpenaiModel(settings.openai.defaultModel);
      setOpenaiReasoning(settings.openai.reasoningEffort);
      setOpenaiImage(settings.openai.imageModel);
    }
  }, [settings]);

  const [savedSection, setSavedSection] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: api.settings.update,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  const saveGemini = async () => {
    await saveMutation.mutateAsync({
      gemini: {
        ...(geminiKey ? { apiKey: geminiKey } : {}),
        defaultModel: geminiModel,
        thinkingLevel: geminiThinking,
        imageModel: geminiImage,
      },
    });
    setSavedSection('gemini');
    setGeminiKey('');
    setTimeout(() => setSavedSection(null), 2000);
  };

  const saveOpenAI = async () => {
    await saveMutation.mutateAsync({
      openai: {
        ...(openaiKey ? { apiKey: openaiKey } : {}),
        defaultModel: openaiModel,
        reasoningEffort: openaiReasoning,
        imageModel: openaiImage,
      },
    });
    setSavedSection('openai');
    setOpenaiKey('');
    setTimeout(() => setSavedSection(null), 2000);
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
        {isSaving ? t.modelManager.saving : isSaved ? t.modelManager.saved : t.modelManager.save}
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
          <h1 className="text-2xl font-semibold text-gray-900">{t.modelManager.title}</h1>
          <p className="mt-1 text-sm text-gray-400">{t.modelManager.subtitle}</p>
        </div>

        {/* Google / Gemini */}
        <Section title={t.modelManager.google}>
          {/* API Key */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-400">
              {t.modelManager.apiKey}
            </p>
            <ApiKeyField
              value={geminiKey}
              onChange={setGeminiKey}
              secured={settings?.gemini.hasApiKey}
              maskedValue={settings?.gemini.apiKey}
            />
          </div>

          {/* Default Model */}
          <SelectGroup
            label={t.modelManager.defaultModel}
            value={geminiModel}
            options={GEMINI_MODELS}
            onChange={setGeminiModel}
          />

          {/* Thinking Level */}
          <SelectGroup<ThinkingLevel>
            label={t.modelManager.thinkingLevel}
            value={geminiThinking}
            options={thinkingLevels}
            onChange={setGeminiThinking}
            getLabelFn={(v) => t.modelManager.thinkingLevels[v]}
          />

          {/* Image Model */}
          <SelectGroup
            label={t.modelManager.imageModel}
            value={geminiImage}
            options={GEMINI_IMAGE_MODELS}
            onChange={setGeminiImage}
          />

          <SaveButton section="gemini" onClick={saveGemini} />
        </Section>

        {/* OpenAI */}
        <Section title={t.modelManager.openai}>
          {/* API Key */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-400">
              {t.modelManager.apiKey}
            </p>
            <ApiKeyField
              value={openaiKey}
              onChange={setOpenaiKey}
              secured={settings?.openai.hasApiKey}
              maskedValue={settings?.openai.apiKey}
            />
          </div>

          {/* Default Model */}
          <SelectGroup
            label={t.modelManager.defaultModel}
            value={openaiModel}
            options={OPENAI_MODELS}
            onChange={setOpenaiModel}
          />

          {/* Reasoning Effort */}
          <SelectGroup<ReasoningEffort>
            label={t.modelManager.reasoningEffort}
            value={openaiReasoning}
            options={reasoningEfforts}
            onChange={setOpenaiReasoning}
            getLabelFn={(v) => t.modelManager.reasoningEfforts[v]}
          />

          {/* Image Model */}
          <SelectGroup
            label={t.modelManager.imageModel}
            value={openaiImage}
            options={OPENAI_IMAGE_MODELS}
            onChange={setOpenaiImage}
          />

          <SaveButton section="openai" onClick={saveOpenAI} />
        </Section>
      </div>
    </div>
  );
}
