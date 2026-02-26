import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheck, faSpinner, faPlus, faTrash } from '@fortawesome/free-solid-svg-icons';
import { api } from '@/api';
import { PageTopBar } from '@/components/layout/PageTopBar';
import { t } from '@/i18n';
import type { PulseInterval, QuietHoursRange } from '@/types';

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
  const allTzs = (Intl as any).supportedValuesOf('timeZone') as string[];
  const withOffsets = allTzs.map((tz: string) => ({
    value: tz,
    label: `${tz} (${getUTCOffset(tz)})`,
  }));
  const userIdx = withOffsets.findIndex((t: { value: string }) => t.value === USER_TIMEZONE);
  if (userIdx > 0) {
    const [userTz] = withOffsets.splice(userIdx, 1);
    withOffsets.unshift(userTz);
  }
  return withOffsets;
};

const ALL_TIMEZONE_OPTIONS = buildTimezoneOptions();

const INTERVAL_OPTIONS: { value: PulseInterval; label: string }[] = [
  { value: 48, label: t.pulse.every30min },
  { value: 24, label: t.pulse.everyHour },
  { value: 12, label: `${t.pulse.every2hours} ${t.pulse.recommended}` },
  { value: 6, label: t.pulse.every4hours },
  { value: 2, label: t.pulse.every12hours },
];

const DAY_LABELS = [
  t.pulse.daySun, t.pulse.dayMon, t.pulse.dayTue, t.pulse.dayWed,
  t.pulse.dayThu, t.pulse.dayFri, t.pulse.daySat,
];

export function SettingsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings.get,
  });

  // Timezone state
  const [timezone, setTimezone] = useState('UTC');
  const [saved, setSaved] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [filtered, setFiltered] = useState(ALL_TIMEZONE_OPTIONS);

  // Pulse state
  const [pulseEnabled, setPulseEnabled] = useState(false);
  const [pulsesPerDay, setPulsesPerDay] = useState<PulseInterval>(12);
  const [activeDays, setActiveDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [quietHours, setQuietHours] = useState<QuietHoursRange[]>([]);
  const [pulseSaved, setPulseSaved] = useState(false);

  useEffect(() => {
    if (settings?.timezone) {
      const tz = settings.timezone;
      setTimezone(tz);
      const option = ALL_TIMEZONE_OPTIONS.find((o: { value: string }) => o.value === tz);
      setInputValue(option?.label ?? tz);
    }
    if (settings?.pulse) {
      setPulseEnabled(settings.pulse.enabled);
      setPulsesPerDay(settings.pulse.pulsesPerDay);
      setActiveDays(settings.pulse.activeDays);
      setQuietHours(settings.pulse.quietHours);
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

  const pulseSaveMutation = useMutation({
    mutationFn: api.settings.update,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      setPulseSaved(true);
      setTimeout(() => setPulseSaved(false), 2000);
    },
  });

  const handleSave = () => {
    saveMutation.mutate({ timezone });
  };

  const handlePulseSave = () => {
    pulseSaveMutation.mutate({
      pulse: {
        ...(settings?.pulse ?? {
          chatId: null,
          notes: '',
          lastPulseAt: null,
          pulsesToday: 0,
          todayDate: null,
        }),
        enabled: pulseEnabled,
        pulsesPerDay,
        activeDays,
        quietHours,
      },
    });
  };

  const toggleDay = (day: number) => {
    setActiveDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );
  };

  const updateQuietHour = (index: number, field: 'start' | 'end', value: string) => {
    setQuietHours((prev) => prev.map((qh, i) => (i === index ? { ...qh, [field]: value } : qh)));
  };

  const addQuietHourRange = () => {
    setQuietHours((prev) => [...prev, { start: '22:00', end: '08:00' }]);
  };

  const removeQuietHourRange = (index: number) => {
    setQuietHours((prev) => prev.filter((_, i) => i !== index));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);
    const lower = val.toLowerCase();
    setFiltered(ALL_TIMEZONE_OPTIONS.filter((o: { label: string }) => o.label.toLowerCase().includes(lower)));
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
      const current = ALL_TIMEZONE_OPTIONS.find((o: { value: string }) => o.value === timezone);
      setInputValue(current?.label ?? timezone);
    }, 150);
  };

  const isSaving = saveMutation.isPending;
  const isPulseSaving = pulseSaveMutation.isPending;

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <FontAwesomeIcon icon={faSpinner} className="text-2xl text-gray-300 animate-spin" />
      </div>
    );
  }

  const lastPulseStr = settings?.pulse?.lastPulseAt
    ? new Date(settings.pulse.lastPulseAt).toLocaleString()
    : t.pulse.never;

  return (
    <div className="flex h-full flex-col">
      <PageTopBar title={t.settings.title} />
      <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-4 py-8 space-y-6">

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
                  setFiltered(ALL_TIMEZONE_OPTIONS.filter((o: { label: string }) =>
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
                  {filtered.slice(0, 50).map((option: { value: string; label: string }) => (
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

        {/* Pulse Section */}
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-gray-400">
                {t.pulse.title}
              </p>
              <p className="text-xs text-gray-400">{t.pulse.description}</p>
            </div>
            <button
              onClick={() => setPulseEnabled(!pulseEnabled)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ${
                pulseEnabled ? 'bg-black' : 'bg-gray-200'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform duration-200 mt-0.5 ${
                  pulseEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          {/* Pulse Interval */}
          <div>
            <p className="mb-2 text-xs font-medium text-gray-500">{t.pulse.interval}</p>
            <div className="flex flex-wrap gap-2">
              {INTERVAL_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setPulsesPerDay(opt.value)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-150 ${
                    pulsesPerDay === opt.value
                      ? 'bg-black text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Active Days */}
          <div>
            <p className="mb-2 text-xs font-medium text-gray-500">{t.pulse.activeDays}</p>
            <div className="flex gap-2">
              {DAY_LABELS.map((label, idx) => (
                <button
                  key={idx}
                  onClick={() => toggleDay(idx)}
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-medium transition-all duration-150 ${
                    activeDays.includes(idx)
                      ? 'bg-black text-white'
                      : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Quiet Hours */}
          <div>
            <p className="mb-1 text-xs font-medium text-gray-500">{t.pulse.quietHours}</p>
            <p className="mb-2 text-xs text-gray-400">{t.pulse.quietHoursDescription}</p>
            <div className="space-y-2">
              {quietHours.map((qh, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="time"
                    value={qh.start}
                    onChange={(e) => updateQuietHour(idx, 'start', e.target.value)}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 outline-none focus:border-gray-400"
                  />
                  <span className="text-xs text-gray-400">to</span>
                  <input
                    type="time"
                    value={qh.end}
                    onChange={(e) => updateQuietHour(idx, 'end', e.target.value)}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 outline-none focus:border-gray-400"
                  />
                  <button
                    onClick={() => removeQuietHourRange(idx)}
                    className="text-gray-300 hover:text-red-400 transition-colors"
                  >
                    <FontAwesomeIcon icon={faTrash} className="text-xs" />
                  </button>
                </div>
              ))}
              <button
                onClick={addQuietHourRange}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                <FontAwesomeIcon icon={faPlus} className="text-[10px]" />
                {t.pulse.addRange}
              </button>
            </div>
          </div>

          {/* Status Info */}
          {settings?.pulse && (
            <div className="rounded-xl bg-gray-50 p-3 space-y-1">
              <p className="text-xs font-medium text-gray-500">{t.pulse.status}</p>
              <div className="flex justify-between text-xs text-gray-500">
                <span>{t.pulse.lastPulse}</span>
                <span className="text-gray-700">{lastPulseStr}</span>
              </div>
              <div className="flex justify-between text-xs text-gray-500">
                <span>{t.pulse.pulsesToday}</span>
                <span className="text-gray-700">{settings.pulse.pulsesToday}/{settings.pulse.pulsesPerDay}</span>
              </div>
            </div>
          )}

          {/* View Pulse Chat */}
          <div className="flex items-center gap-3">
            <button
              onClick={handlePulseSave}
              disabled={isPulseSaving}
              className="flex items-center gap-2 rounded-full bg-black px-5 py-2 text-sm font-medium text-white hover:bg-gray-900 active:scale-[0.98] transition-all duration-150 disabled:opacity-60"
            >
              {isPulseSaving && <FontAwesomeIcon icon={faSpinner} className="text-xs animate-spin" />}
              {pulseSaved && !isPulseSaving && <FontAwesomeIcon icon={faCheck} className="text-xs" />}
              {isPulseSaving ? t.pulse.saving : pulseSaved ? t.pulse.saved : t.pulse.save}
            </button>

            {settings?.pulse?.chatId && (
              <button
                onClick={() => navigate(`/chat/${settings.pulse.chatId}`)}
                className="rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-all duration-150"
              >
                {t.pulse.viewChat}
              </button>
            )}
          </div>
        </div>

      </div>
      </div>
    </div>
  );
}
