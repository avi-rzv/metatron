import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faSpinner,
  faPlus,
  faTrash,
  faPen,
  faComments,
  faClock,
} from '@fortawesome/free-solid-svg-icons';
import { api } from '@/api';
import { PageTopBar } from '@/components/layout/PageTopBar';
import { t } from '@/i18n';
import type { CronJob } from '@/types';

// --- Schedule helpers ---

type Frequency = 'daily' | 'specific' | 'hourly';
type AmPm = 'AM' | 'PM';

interface ScheduleState {
  frequency: Frequency;
  days: number[];
  hour: number;
  minute: number;
  ampm: AmPm;
}

const DEFAULT_SCHEDULE: ScheduleState = {
  frequency: 'daily',
  days: [],
  hour: 9,
  minute: 0,
  ampm: 'PM',
};

function buildCron(s: ScheduleState): string {
  if (s.frequency === 'hourly') return '0 * * * *';

  let h = s.hour;
  if (s.ampm === 'PM' && h !== 12) h += 12;
  if (s.ampm === 'AM' && h === 12) h = 0;

  const dow = s.frequency === 'specific' && s.days.length > 0
    ? s.days.sort((a, b) => a - b).join(',')
    : '*';

  return `${s.minute} ${h} * * ${dow}`;
}

function parseCron(expr: string): ScheduleState {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return { ...DEFAULT_SCHEDULE };

  const [minStr, hourStr, , , dowStr] = parts;

  // Every hour
  if (hourStr === '*') {
    return { frequency: 'hourly', days: [], hour: 12, minute: 0, ampm: 'AM' };
  }

  const min = parseInt(minStr, 10);
  const hour24 = parseInt(hourStr, 10);
  if (isNaN(min) || isNaN(hour24)) return { ...DEFAULT_SCHEDULE };

  let hour12: number;
  let ampm: AmPm;
  if (hour24 === 0) { hour12 = 12; ampm = 'AM'; }
  else if (hour24 < 12) { hour12 = hour24; ampm = 'AM'; }
  else if (hour24 === 12) { hour12 = 12; ampm = 'PM'; }
  else { hour12 = hour24 - 12; ampm = 'PM'; }

  // Specific days
  if (dowStr !== '*') {
    const days = dowStr.split(',').map(d => parseInt(d, 10)).filter(d => !isNaN(d));
    return { frequency: 'specific', days, hour: hour12, minute: min, ampm };
  }

  return { frequency: 'daily', days: [], hour: hour12, minute: min, ampm };
}

function cronToHuman(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, , , dow] = parts;

  const fmtTime = (h: string, m: string) => {
    const hh = parseInt(h, 10);
    const mm = m.padStart(2, '0');
    if (hh === 0) return `12:${mm} AM`;
    if (hh < 12) return `${hh}:${mm} AM`;
    if (hh === 12) return `12:${mm} PM`;
    return `${hh - 12}:${mm} PM`;
  };

  const dayNames: Record<string, string> = {
    '0': t.schedule.daySun, '1': t.schedule.dayMon, '2': t.schedule.dayTue, '3': t.schedule.dayWed,
    '4': t.schedule.dayThu, '5': t.schedule.dayFri, '6': t.schedule.daySat, '7': t.schedule.daySun,
  };

  if (min === '*' && hour === '*') return t.schedule.everyMinute;
  if (min !== '*' && hour === '*' && dow === '*') return `${t.schedule.everyHourAt} :${min.padStart(2, '0')}`;
  if (min !== '*' && hour !== '*' && dow === '*') return `${t.schedule.dailyAt} ${fmtTime(hour, min)}`;
  if (min !== '*' && hour !== '*' && dow !== '*') {
    const days = dow.split(',').map(d => {
      if (d.includes('-')) {
        const [start, end] = d.split('-');
        return `${dayNames[start] ?? start}-${dayNames[end] ?? end}`;
      }
      return dayNames[d] ?? d;
    }).join(', ');
    return `${days} ${t.schedule.at} ${fmtTime(hour, min)}`;
  }

  return expr;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return t.schedule.never;
  const d = new Date(dateStr);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

// --- Constants ---

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
const DAY_LABELS = [
  { value: 1, label: t.schedule.dayMon },
  { value: 2, label: t.schedule.dayTue },
  { value: 3, label: t.schedule.dayWed },
  { value: 4, label: t.schedule.dayThu },
  { value: 5, label: t.schedule.dayFri },
  { value: 6, label: t.schedule.daySat },
  { value: 0, label: t.schedule.daySun },
];

// --- Component ---

interface FormData {
  name: string;
  instruction: string;
  cronExpression: string;
}

export function SchedulePage() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: jobs, isLoading } = useQuery({
    queryKey: ['cronjobs'],
    queryFn: api.cronjobs.list,
  });

  const [showForm, setShowForm] = useState(false);
  const [editingJob, setEditingJob] = useState<CronJob | null>(null);
  const [form, setForm] = useState<FormData>({ name: '', instruction: '', cronExpression: '' });
  const [schedule, setSchedule] = useState<ScheduleState>({ ...DEFAULT_SCHEDULE });
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (data: FormData) => api.cronjobs.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cronjobs'] });
      closeForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<FormData> }) =>
      api.cronjobs.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cronjobs'] });
      closeForm();
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => api.cronjobs.toggle(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cronjobs'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.cronjobs.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cronjobs'] });
      setDeleteConfirmId(null);
    },
  });

  const openCreate = () => {
    setEditingJob(null);
    setForm({ name: '', instruction: '', cronExpression: '' });
    setSchedule({ ...DEFAULT_SCHEDULE });
    setShowForm(true);
  };

  const openEdit = (job: CronJob) => {
    setEditingJob(job);
    setForm({ name: job.name, instruction: job.instruction, cronExpression: job.cronExpression });
    setSchedule(parseCron(job.cronExpression));
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingJob(null);
    setForm({ name: '', instruction: '', cronExpression: '' });
    setSchedule({ ...DEFAULT_SCHEDULE });
  };

  const handleSubmit = () => {
    const cronExpression = buildCron(schedule);
    if (!form.name.trim() || !form.instruction.trim()) return;
    const data = { ...form, cronExpression };
    if (editingJob) {
      updateMutation.mutate({ id: editingJob.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const toggleDay = (day: number) => {
    setSchedule(prev => ({
      ...prev,
      days: prev.days.includes(day)
        ? prev.days.filter(d => d !== day)
        : [...prev.days, day],
    }));
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <FontAwesomeIcon icon={faSpinner} className="text-2xl text-gray-300 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <PageTopBar title={t.schedule.title} />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-4 py-8 space-y-6">

          {/* Header + Add button */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-400">{t.schedule.subtitle}</p>
            </div>
            <button
              onClick={openCreate}
              className="flex items-center gap-2 rounded-full bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-900 active:scale-[0.98] transition-all duration-150"
            >
              <FontAwesomeIcon icon={faPlus} className="text-xs" />
              {t.schedule.addCronjob}
            </button>
          </div>

          {/* Empty state */}
          {(!jobs || jobs.length === 0) && (
            <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm">
              <FontAwesomeIcon icon={faClock} className="text-3xl text-gray-200 mb-3" />
              <p className="text-sm font-medium text-gray-500">{t.schedule.noCronjobs}</p>
              <p className="mt-1 text-xs text-gray-400">{t.schedule.noCronjobsDescription}</p>
            </div>
          )}

          {/* Job list */}
          {jobs?.map((job) => (
            <div
              key={job.id}
              className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm space-y-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-gray-900 truncate">{job.name}</h3>
                    <span
                      className={[
                        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
                        job.enabled
                          ? 'bg-green-50 text-green-700'
                          : 'bg-gray-100 text-gray-500',
                      ].join(' ')}
                    >
                      {job.enabled ? t.schedule.enabled : t.schedule.disabled}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    <FontAwesomeIcon icon={faClock} className="me-1 text-gray-300" />
                    {cronToHuman(job.cronExpression)}
                  </p>
                </div>

                {/* Toggle */}
                <button
                  onClick={() => toggleMutation.mutate(job.id)}
                  disabled={toggleMutation.isPending}
                  className={[
                    'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none',
                    job.enabled ? 'bg-black' : 'bg-gray-200',
                    toggleMutation.isPending ? 'opacity-60' : '',
                  ].join(' ')}
                  role="switch"
                  aria-checked={job.enabled}
                >
                  <span
                    className={[
                      'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform ring-0 transition duration-200 ease-in-out',
                      job.enabled ? 'translate-x-5' : 'translate-x-0',
                    ].join(' ')}
                  />
                </button>
              </div>

              <p className="text-xs text-gray-600 line-clamp-2">{job.instruction}</p>

              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-gray-400">
                  {t.schedule.lastRun}: {formatDate(job.lastRunAt)}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => navigate(`/chat/${job.chatId}`)}
                    className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 transition-all duration-150"
                  >
                    <FontAwesomeIcon icon={faComments} className="text-[10px]" />
                    {t.schedule.viewChat}
                  </button>
                  <button
                    onClick={() => openEdit(job)}
                    className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 transition-all duration-150"
                  >
                    <FontAwesomeIcon icon={faPen} className="text-[10px]" />
                  </button>
                  <button
                    onClick={() => setDeleteConfirmId(job.id)}
                    className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-50 hover:text-red-600 transition-all duration-150"
                  >
                    <FontAwesomeIcon icon={faTrash} className="text-[10px]" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Create/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <h3 className="text-base font-semibold text-gray-900">
              {editingJob ? t.schedule.editCronjob : t.schedule.addCronjob}
            </h3>

            <div className="space-y-4">
              {/* Name */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">{t.schedule.name}</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={t.schedule.namePlaceholder}
                  autoFocus
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-800 placeholder-gray-400 outline-none focus:border-gray-400 focus:shadow-sm transition-all duration-150"
                />
              </div>

              {/* Instruction */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">{t.schedule.instruction}</label>
                <textarea
                  value={form.instruction}
                  onChange={(e) => setForm({ ...form, instruction: e.target.value })}
                  placeholder={t.schedule.instructionPlaceholder}
                  rows={3}
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-800 placeholder-gray-400 outline-none focus:border-gray-400 focus:shadow-sm transition-all duration-150 resize-none"
                />
              </div>

              {/* Frequency selector */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">{t.schedule.frequencyLabel}</label>
                <div className="flex gap-1.5">
                  {([
                    { value: 'daily' as const, label: t.schedule.frequencyDaily },
                    { value: 'specific' as const, label: t.schedule.frequencySpecific },
                    { value: 'hourly' as const, label: t.schedule.frequencyHourly },
                  ]).map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setSchedule(prev => ({ ...prev, frequency: opt.value }))}
                      className={[
                        'rounded-full px-3.5 py-1.5 text-xs font-medium transition-all duration-150',
                        schedule.frequency === opt.value
                          ? 'bg-black text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                      ].join(' ')}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Day chips — only when "Specific days" */}
              {schedule.frequency === 'specific' && (
                <div className="flex flex-wrap gap-2">
                  {DAY_LABELS.map((day) => (
                    <button
                      key={day.value}
                      onClick={() => toggleDay(day.value)}
                      className={[
                        'h-9 w-9 rounded-full text-xs font-medium transition-all duration-150',
                        schedule.days.includes(day.value)
                          ? 'bg-black text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                      ].join(' ')}
                    >
                      {day.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Time picker — hidden when "Every hour" */}
              {schedule.frequency !== 'hourly' && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">{t.schedule.timeLabel}</label>
                  <div className="flex items-center gap-2">
                    {/* Hour */}
                    <select
                      value={schedule.hour}
                      onChange={(e) => setSchedule(prev => ({ ...prev, hour: parseInt(e.target.value, 10) }))}
                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-gray-400 transition-all duration-150"
                    >
                      {HOURS.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>

                    <span className="text-gray-400 font-medium">:</span>

                    {/* Minute */}
                    <select
                      value={schedule.minute}
                      onChange={(e) => setSchedule(prev => ({ ...prev, minute: parseInt(e.target.value, 10) }))}
                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-gray-400 transition-all duration-150"
                    >
                      {MINUTES.map((m) => (
                        <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                      ))}
                    </select>

                    {/* AM/PM toggle */}
                    <div className="flex rounded-full bg-gray-100 p-0.5">
                      {(['AM', 'PM'] as const).map((val) => (
                        <button
                          key={val}
                          onClick={() => setSchedule(prev => ({ ...prev, ampm: val }))}
                          className={[
                            'rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-150',
                            schedule.ampm === val
                              ? 'bg-black text-white'
                              : 'text-gray-600',
                          ].join(' ')}
                        >
                          {val}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={closeForm}
                className="rounded-full px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-all duration-150"
              >
                {t.schedule.cancel}
              </button>
              <button
                onClick={handleSubmit}
                disabled={!form.name.trim() || !form.instruction.trim() || isSaving}
                className="flex items-center gap-2 rounded-full bg-black px-5 py-2 text-sm font-medium text-white hover:bg-gray-900 active:scale-[0.98] transition-all duration-150 disabled:opacity-60"
              >
                {isSaving && <FontAwesomeIcon icon={faSpinner} className="text-xs animate-spin" />}
                {t.schedule.save}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Dialog */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <p className="text-sm text-gray-700">{t.schedule.deleteConfirm}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="rounded-full px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-all duration-150"
              >
                {t.schedule.no}
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteConfirmId)}
                disabled={deleteMutation.isPending}
                className="flex items-center gap-2 rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 active:scale-[0.98] transition-all duration-150 disabled:opacity-60"
              >
                {deleteMutation.isPending && <FontAwesomeIcon icon={faSpinner} className="text-xs animate-spin" />}
                {t.schedule.yes}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
