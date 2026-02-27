import { useState, useRef, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronDown, faCheck } from '@fortawesome/free-solid-svg-icons';
import { GEMINI_MODELS, OPENAI_MODELS, type Provider } from '@/types';
import { t } from '@/i18n';

interface ModelSelectorProps {
  provider: Provider;
  model: string;
  onChange: (provider: Provider, model: string) => void;
}

const groups = [
  {
    label: t.modelSelector.google,
    provider: 'gemini' as Provider,
    models: GEMINI_MODELS,
  },
  {
    label: t.modelSelector.openai,
    provider: 'openai' as Provider,
    models: OPENAI_MODELS,
  },
];

export function ModelSelector({ provider, model, onChange }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const currentLabel =
    [...GEMINI_MODELS, ...OPENAI_MODELS].find((m) => m.id === model)?.label ?? model;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 shadow-sm hover:border-gray-300 hover:bg-gray-50 active:scale-95 transition-all duration-150"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="max-w-[160px] truncate">{currentLabel}</span>
        <FontAwesomeIcon
          icon={faChevronDown}
          className={`text-xs text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute start-0 top-full z-50 mt-2 min-w-[220px] rounded-2xl border border-gray-100 bg-white shadow-xl animate-fade-in overflow-hidden">
          {groups.map((group, gi) => (
            <div key={group.provider}>
              {gi > 0 && <div className="mx-3 border-t border-gray-100" />}
              <div className="px-3 pt-3 pb-1">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                  {group.label}
                </p>
              </div>
              <ul role="listbox" className="pb-2">
                {group.models.map((m) => {
                  const active = provider === group.provider && model === m.id;
                  return (
                    <li key={m.id}>
                      <button
                        role="option"
                        aria-selected={active}
                        onClick={() => {
                          onChange(group.provider, m.id);
                          setOpen(false);
                        }}
                        className={[
                          'flex w-full items-center justify-between gap-2 px-3 py-2 text-sm transition-colors duration-100',
                          active
                            ? 'bg-black text-white'
                            : 'text-gray-700 hover:bg-gray-50',
                        ].join(' ')}
                      >
                        <span>{m.label}</span>
                        {active && <FontAwesomeIcon icon={faCheck} className="text-xs" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
