import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faKey, faCheck, faSpinner, faEye, faEyeSlash, faXmark, faPlus } from '@fortawesome/free-solid-svg-icons';
import { api } from '@/api';
import { t } from '@/i18n';
import { showToast } from '@/utils/toast';
import {
  ALL_MODELS,
  ALL_IMAGE_MODELS,
  getProviderForModel,
  type ModelDefinition,
  type ModelWithThinking,
  type ThinkingLevel,
  type AppSettings,
} from '@/types';

const THINKING_LEVELS: ThinkingLevel[] = ['minimal', 'low', 'medium', 'high'];

// --- ModelCombobox ---

interface ModelComboboxProps {
  value: string;
  onChange: (modelId: string) => void;
  models: ModelDefinition[];
  placeholder: string;
}

function ModelCombobox({ value, onChange, models, placeholder }: ModelComboboxProps) {
  const [inputValue, setInputValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selectedModel = models.find(m => m.id === value);

  // Sync display when value changes externally
  useEffect(() => {
    if (!isOpen) {
      setInputValue(selectedModel?.label ?? '');
    }
  }, [value, selectedModel, isOpen]);

  const lower = inputValue.toLowerCase();
  const filtered = inputValue ? models.filter(m => m.label.toLowerCase().includes(lower)) : models;

  const geminiModels = filtered.filter(m => m.provider === 'gemini');
  const openaiModels = filtered.filter(m => m.provider === 'openai');

  const handleSelect = (modelId: string) => {
    onChange(modelId);
    const model = models.find(m => m.id === modelId);
    setInputValue(model?.label ?? '');
    setIsOpen(false);
  };

  const handleBlur = () => {
    setTimeout(() => {
      setIsOpen(false);
      setInputValue(selectedModel?.label ?? '');
    }, 150);
  };

  return (
    <div className="relative flex-1 min-w-0" ref={ref}>
      <input
        type="text"
        value={isOpen ? inputValue : (selectedModel?.label ?? '')}
        onChange={(e) => {
          setInputValue(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => {
          setInputValue(selectedModel?.label ?? '');
          setIsOpen(true);
        }}
        onBlur={handleBlur}
        placeholder={placeholder}
        className="w-full rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-800 outline-none focus:border-gray-400 focus:shadow-sm transition-all duration-150"
      />
      {isOpen && filtered.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-md text-sm">
          {geminiModels.length > 0 && (
            <>
              <li className="px-3 pt-3 pb-1">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                  {t.modelManager.providerGoogle}
                </p>
              </li>
              {geminiModels.map((m) => (
                <li
                  key={m.id}
                  onMouseDown={() => handleSelect(m.id)}
                  className={`cursor-pointer px-4 py-2 hover:bg-gray-50 ${m.id === value ? 'bg-gray-50 font-medium' : ''}`}
                >
                  {m.label}
                </li>
              ))}
            </>
          )}
          {openaiModels.length > 0 && (
            <>
              {geminiModels.length > 0 && <li className="mx-3 border-t border-gray-100" />}
              <li className="px-3 pt-3 pb-1">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                  {t.modelManager.providerOpenAI}
                </p>
              </li>
              {openaiModels.map((m) => (
                <li
                  key={m.id}
                  onMouseDown={() => handleSelect(m.id)}
                  className={`cursor-pointer px-4 py-2 hover:bg-gray-50 ${m.id === value ? 'bg-gray-50 font-medium' : ''}`}
                >
                  {m.label}
                </li>
              ))}
            </>
          )}
        </ul>
      )}
    </div>
  );
}

// --- ThinkingLevelDropdown ---

function ThinkingLevelDropdown({ value, onChange }: { value: ThinkingLevel; onChange: (v: ThinkingLevel) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as ThinkingLevel)}
      className="rounded-full border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-gray-400 focus:shadow-sm transition-all duration-150"
    >
      {THINKING_LEVELS.map((level) => (
        <option key={level} value={level}>
          {t.modelManager.thinkingLevels[level]}
        </option>
      ))}
    </select>
  );
}

// --- ApiKeyField (reused from old page) ---

interface ApiKeyFieldProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  secured?: boolean;
  maskedValue?: string;
  revealedValue?: string;
  onReveal?: () => void;
}

function ApiKeyField({ value, onChange, placeholder, secured, maskedValue, revealedValue, onReveal }: ApiKeyFieldProps) {
  const [show, setShow] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!value) {
      setIsEditing(false);
      setShow(false);
    }
  }, [value]);

  const showingMasked = secured && !!maskedValue && !isEditing;

  const handleMaskedClick = () => {
    setIsEditing(true);
    setShow(false);
    onChange('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleToggleShow = () => {
    if (!show && onReveal) {
      onReveal();
    }
    setShow((s) => !s);
  };

  return (
    <div className="relative flex items-center">
      <FontAwesomeIcon icon={faKey} className="absolute left-3 text-gray-300 text-xs" />
      {showingMasked ? (
        <input
          ref={inputRef}
          type="text"
          value={show ? (revealedValue ?? maskedValue ?? '') : '***'}
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
        onClick={handleToggleShow}
        className="absolute right-3 text-gray-400 hover:text-gray-700 transition-colors duration-150"
        aria-label={show ? 'Hide key' : 'Show key'}
      >
        <FontAwesomeIcon icon={show ? faEyeSlash : faEye} className="text-xs" />
      </button>
    </div>
  );
}

// --- Section ---

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm space-y-5">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      {children}
    </div>
  );
}

// --- Main Page ---

export function ModelManagerPage() {
  const qc = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings.get,
  });

  // Primary model
  const [primaryModelId, setPrimaryModelId] = useState('gemini-3.1-pro-preview');
  const [primaryThinking, setPrimaryThinking] = useState<ThinkingLevel>('medium');

  // Fallback models
  const [fallbackModels, setFallbackModels] = useState<ModelWithThinking[]>([]);

  // Image models
  const [primaryImageModel, setPrimaryImageModel] = useState('gemini-3-pro-image-preview');
  const [fallbackImageModels, setFallbackImageModels] = useState<string[]>([]);

  // API keys
  const [geminiKey, setGeminiKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');

  const [saved, setSaved] = useState(false);
  const [revealedKeys, setRevealedKeys] = useState<{ gemini: string; openai: string } | null>(null);

  // Sync local state from loaded settings
  useEffect(() => {
    if (settings) {
      setPrimaryModelId(settings.primaryModel.modelId);
      setPrimaryThinking(settings.primaryModel.thinkingLevel);
      setFallbackModels(settings.fallbackModels ?? []);
      setPrimaryImageModel(settings.primaryImageModel);
      setFallbackImageModels(settings.fallbackImageModels ?? []);
    }
  }, [settings]);

  const handleReveal = async () => {
    if (!revealedKeys) {
      const keys = await api.settings.revealKeys();
      setRevealedKeys(keys);
    }
  };

  const saveMutation = useMutation({
    mutationFn: api.settings.update,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  // Check API key when model selected
  const checkApiKeyForModel = (modelId: string) => {
    if (!modelId || !settings) return;
    const provider = getProviderForModel(modelId);
    if (!provider) return;
    const hasKey = settings.apiKeys[provider]?.hasApiKey;
    if (!hasKey) {
      const providerName = provider === 'gemini' ? 'Google' : 'OpenAI';
      showToast(t.modelManager.apiKeyWarning.replace('{provider}', providerName));
    }
  };

  const handlePrimaryModelChange = (modelId: string) => {
    setPrimaryModelId(modelId);
    checkApiKeyForModel(modelId);
  };

  const handleFallbackModelChange = (index: number, modelId: string) => {
    setFallbackModels(prev => prev.map((fb, i) => i === index ? { ...fb, modelId } : fb));
    checkApiKeyForModel(modelId);
  };

  const handleFallbackThinkingChange = (index: number, thinkingLevel: ThinkingLevel) => {
    setFallbackModels(prev => prev.map((fb, i) => i === index ? { ...fb, thinkingLevel } : fb));
  };

  const addFallbackModel = () => {
    setFallbackModels(prev => [...prev, { modelId: '', thinkingLevel: 'medium' }]);
  };

  const removeFallbackModel = (index: number) => {
    setFallbackModels(prev => prev.filter((_, i) => i !== index));
  };

  const handlePrimaryImageChange = (modelId: string) => {
    setPrimaryImageModel(modelId);
    checkApiKeyForModel(modelId);
  };

  const handleFallbackImageChange = (index: number, modelId: string) => {
    setFallbackImageModels(prev => prev.map((id, i) => i === index ? modelId : id));
    checkApiKeyForModel(modelId);
  };

  const addFallbackImage = () => {
    setFallbackImageModels(prev => [...prev, '']);
  };

  const removeFallbackImage = (index: number) => {
    setFallbackImageModels(prev => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    // Filter out empty fallback slots
    const cleanFallbacks = fallbackModels.filter(fb => fb.modelId);
    const cleanImageFallbacks = fallbackImageModels.filter(id => id);

    const payload: Partial<AppSettings> = {
      primaryModel: { modelId: primaryModelId, thinkingLevel: primaryThinking },
      fallbackModels: cleanFallbacks,
      primaryImageModel,
      fallbackImageModels: cleanImageFallbacks,
      apiKeys: {
        gemini: { apiKey: geminiKey || undefined },
        openai: { apiKey: openaiKey || undefined },
      },
    };

    await saveMutation.mutateAsync(payload);
    setGeminiKey('');
    setOpenaiKey('');
    setRevealedKeys(null);
  };

  const isSaving = saveMutation.isPending;

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

        {/* Model Defaults */}
        <Section title={t.modelManager.modelDefaults}>
          {/* Primary Model */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-400">
              {t.modelManager.primaryModel}
            </p>
            <div className="flex items-center gap-2">
              <ModelCombobox
                value={primaryModelId}
                onChange={handlePrimaryModelChange}
                models={ALL_MODELS}
                placeholder={t.modelManager.searchModels}
              />
              <ThinkingLevelDropdown value={primaryThinking} onChange={setPrimaryThinking} />
            </div>
          </div>

          {/* Fallback Models */}
          {fallbackModels.map((fb, i) => (
            <div key={i} className="flex items-center gap-2">
              <ModelCombobox
                value={fb.modelId}
                onChange={(id) => handleFallbackModelChange(i, id)}
                models={ALL_MODELS}
                placeholder={t.modelManager.searchModels}
              />
              <ThinkingLevelDropdown
                value={fb.thinkingLevel}
                onChange={(v) => handleFallbackThinkingChange(i, v)}
              />
              <button
                onClick={() => removeFallbackModel(i)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-all duration-150"
                aria-label={t.modelManager.removeFallback}
              >
                <FontAwesomeIcon icon={faXmark} className="text-sm" />
              </button>
            </div>
          ))}
          <button
            onClick={addFallbackModel}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors duration-150"
          >
            <FontAwesomeIcon icon={faPlus} className="text-xs" />
            {t.modelManager.addFallback}
          </button>

          <div className="border-t border-gray-100" />

          {/* Primary Image Model */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-400">
              {t.modelManager.primaryImageModel}
            </p>
            <ModelCombobox
              value={primaryImageModel}
              onChange={handlePrimaryImageChange}
              models={ALL_IMAGE_MODELS}
              placeholder={t.modelManager.searchImageModels}
            />
          </div>

          {/* Fallback Image Models */}
          {fallbackImageModels.map((id, i) => (
            <div key={i} className="flex items-center gap-2">
              <ModelCombobox
                value={id}
                onChange={(modelId) => handleFallbackImageChange(i, modelId)}
                models={ALL_IMAGE_MODELS}
                placeholder={t.modelManager.searchImageModels}
              />
              <button
                onClick={() => removeFallbackImage(i)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-all duration-150"
                aria-label={t.modelManager.removeFallback}
              >
                <FontAwesomeIcon icon={faXmark} className="text-sm" />
              </button>
            </div>
          ))}
          <button
            onClick={addFallbackImage}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors duration-150"
          >
            <FontAwesomeIcon icon={faPlus} className="text-xs" />
            {t.modelManager.addFallback}
          </button>
        </Section>

        {/* API Keys */}
        <Section title={t.modelManager.apiKeysSection}>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-400">
              {t.modelManager.providerGoogle}
            </p>
            <ApiKeyField
              value={geminiKey}
              onChange={setGeminiKey}
              secured={settings?.apiKeys.gemini.hasApiKey}
              maskedValue={settings?.apiKeys.gemini.apiKey}
              revealedValue={revealedKeys?.gemini}
              onReveal={handleReveal}
            />
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-400">
              {t.modelManager.providerOpenAI}
            </p>
            <ApiKeyField
              value={openaiKey}
              onChange={setOpenaiKey}
              secured={settings?.apiKeys.openai.hasApiKey}
              maskedValue={settings?.apiKeys.openai.apiKey}
              revealedValue={revealedKeys?.openai}
              onReveal={handleReveal}
            />
          </div>
        </Section>

        {/* Save Button */}
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-2 rounded-full bg-black px-5 py-2 text-sm font-medium text-white hover:bg-gray-900 active:scale-[0.98] transition-all duration-150 disabled:opacity-60"
        >
          {isSaving && <FontAwesomeIcon icon={faSpinner} className="text-xs animate-spin" />}
          {saved && !isSaving && <FontAwesomeIcon icon={faCheck} className="text-xs" />}
          {isSaving ? t.modelManager.saving : saved ? t.modelManager.saved : t.modelManager.save}
        </button>
      </div>
    </div>
  );
}
