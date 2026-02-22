import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheck, faSpinner } from '@fortawesome/free-solid-svg-icons';
import { api } from '@/api';
import { t } from '@/i18n';

// Detect user's local timezone
const USER_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

// Compute UTC offset string for a given IANA timezone (e.g. "UTC+02:00")
function getUTCOffset(tz: string): string {
  try {
    const now = new Date();
    const tzDate = new Date(now.toLocaleString('en-US', { timeZone: tz }));
    const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
    const offsetMinutes = Math.round((tzDate.getTime() - utcDate.getTime()) / 60000);
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const absMinutes = Math.abs(offsetMinutes);
    const hours = Math.floor(absMinutes / 60);
    const minutes = absMinutes % 60;
    return `UTC${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  } catch {
    return 'UTC+00:00';
  }
}

// Build options list: detected timezone first, then all others
const buildTimezoneOptions = () => {
  const allTzs = Intl.supportedValuesOf('timeZone');
  const withOffsets = allTzs.map(tz => ({
    value: tz,
    label: `${tz} (${getUTCOffset(tz)})`,
  }));
  const userIdx = withOffsets.findIndex(t => t.value === USER_TIMEZONE);
  if (userIdx > 0) {
    const [userTz] = withOffsets.splice(userIdx, 1);
    withOffsets.unshift(userTz);
  }
  return withOffsets;
};

const ALL_TIMEZONE_OPTIONS = buildTimezoneOptions();

export function SettingsPage() {
  const qc = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings.get,
  });

  const [timezone, setTimezone] = useState('UTC');
  const [saved, setSaved] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [filtered, setFiltered] = useState(ALL_TIMEZONE_OPTIONS);

  useEffect(() => {
    if (settings?.timezone) {
      const tz = settings.timezone;
      setTimezone(tz);
      const option = ALL_TIMEZONE_OPTIONS.find(o => o.value === tz);
      setInputValue(option?.label ?? tz);
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: api.settings.update,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const handleSave = () => {
    saveMutation.mutate({ timezone });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);
    const lower = val.toLowerCase();
    setFiltered(ALL_TIMEZONE_OPTIONS.filter(o => o.label.toLowerCase().includes(lower)));
    setIsOpen(true);
  };

  const handleSelect = (option: { value: string; label: string }) => {
    setTimezone(option.value);
    setInputValue(option.label);
    setIsOpen(false);
  };

  const handleBlur = () => {
    // Delay to allow mousedown on option to fire first
    setTimeout(() => {
      setIsOpen(false);
      const current = ALL_TIMEZONE_OPTIONS.find(o => o.value === timezone);
      setInputValue(current?.label ?? timezone);
    }, 150);
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
          <h1 className="text-2xl font-semibold text-gray-900">{t.settings.title}</h1>
          <p className="mt-1 text-sm text-gray-400">{t.settings.subtitle}</p>
        </div>

        {/* Timezone Section */}
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm space-y-5">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-gray-400">
              {t.settings.timezone}
            </p>
            <p className="mb-3 text-xs text-gray-400">{t.settings.timezoneDescription}</p>
            <div className="relative">
              <input
                type="text"
                value={inputValue}
                onChange={handleInputChange}
                onFocus={() => {
                  setFiltered(ALL_TIMEZONE_OPTIONS.filter(o =>
                    o.label.toLowerCase().includes(inputValue.toLowerCase())
                  ));
                  setIsOpen(true);
                }}
                onBlur={handleBlur}
                placeholder="Search timezone…"
                className="w-full rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-800 outline-none focus:border-gray-400 focus:shadow-sm transition-all duration-150"
              />
              {isOpen && filtered.length > 0 && (
                <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-md text-sm">
                  {filtered.slice(0, 50).map((option) => (
                    <li
                      key={option.value}
                      onMouseDown={() => handleSelect(option)}
                      className={`cursor-pointer px-4 py-2 hover:bg-gray-50 flex items-center justify-between ${option.value === timezone ? 'bg-gray-50 font-medium' : ''}`}
                    >
                      <span>{option.label}</span>
                      {option.value === USER_TIMEZONE && (
                        <span className="ml-2 text-xs text-gray-400">Detected</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 rounded-full bg-black px-5 py-2 text-sm font-medium text-white hover:bg-gray-900 active:scale-[0.98] transition-all duration-150 disabled:opacity-60"
          >
            {isSaving && <FontAwesomeIcon icon={faSpinner} className="text-xs animate-spin" />}
            {saved && !isSaving && <FontAwesomeIcon icon={faCheck} className="text-xs" />}
            {isSaving ? t.settings.saving : saved ? t.settings.saved : t.settings.save}
          </button>
        </div>
      </div>
    </div>
  );
}
