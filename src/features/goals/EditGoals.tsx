import { useRef, useState } from "react";
import { dailyGoalKinds, dailyGoalsSettingsSchema, type DailyGoalsSettings } from "../../../contracts/daily-goals";
import { goalLabels } from "./TodayGoals";

const descriptions = {
  listen: "Completed card passes, including repeat passes.",
  recall: "Checked Correct and Valid alternative answers.",
  tutor: "Your messages after a successful Tutor reply, including voice.",
};
export function EditGoals({ settings, start, save, onSaved, onDirty }: {
  settings: DailyGoalsSettings; start: boolean; save: (settings: DailyGoalsSettings, start: boolean) => Promise<void>;
  onSaved: () => void; onDirty: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState(() => Object.fromEntries(dailyGoalKinds.map((kind) => [kind, {
    enabled: settings[kind].enabled, target: String(settings[kind].target),
  }])) as Record<typeof dailyGoalKinds[number], { enabled: boolean; target: string }>);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const invalid = dailyGoalKinds.filter((kind) => !/^\d+$/.test(draft[kind].target) || !Number.isSafeInteger(Number(draft[kind].target)) || Number(draft[kind].target) <= 0);
  const anyEnabled = dailyGoalKinds.some((kind) => draft[kind].enabled);
  const update = (kind: typeof dailyGoalKinds[number], patch: Partial<typeof draft[typeof kind]>) => {
    const next = { ...draft, [kind]: { ...draft[kind], ...patch } };
    setDraft(next); setError("");
    onDirty(dailyGoalKinds.some((goal) => next[goal].enabled !== settings[goal].enabled || next[goal].target !== String(settings[goal].target)));
  };
  const submit = async () => {
    setAttempted(true); setError("");
    if (saving) return;
    if (invalid.length || !anyEnabled) {
      formRef.current?.querySelector<HTMLInputElement>(invalid.length ? `[name="${invalid[0]}-target"]` : "input[type=checkbox]")?.focus();
      return;
    }
    const next = dailyGoalsSettingsSchema.parse(Object.fromEntries(dailyGoalKinds.map((kind) => [kind, {
      enabled: draft[kind].enabled, target: Number(draft[kind].target),
    }])));
    setSaving(true);
    try { await save(next, start); onDirty(false); onSaved(); }
    catch (caught) { setError((caught as Error).message); }
    finally { setSaving(false); }
  };
  return <form className="goals-edit" ref={formRef} noValidate onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <p>Goals cover all your languages. Complete one for your streak, or all for a full day.</p>
    {dailyGoalKinds.map((kind) => <div className="goals-edit-row" key={kind}>
      <label className="goals-toggle"><input name={`${kind}-enabled`} type="checkbox" checked={draft[kind].enabled} disabled={saving}
        onChange={(event) => update(kind, { enabled: event.target.checked })} /><span>{goalLabels[kind]}</span></label>
      <label className="goals-target"><span className="simple-visually-hidden">{goalLabels[kind]} daily target</span>
        <input aria-describedby={`goal-${kind}-hint${attempted && invalid.includes(kind) ? ` goal-${kind}-error` : ""}`}
          aria-invalid={attempted && invalid.includes(kind)} name={`${kind}-target`} autoComplete="off" inputMode="numeric" min="1" step="1" type="number"
          disabled={saving} value={draft[kind].target} onChange={(event) => update(kind, { target: event.target.value })} />
      </label><small id={`goal-${kind}-hint`}>{descriptions[kind]}</small>
      {attempted && invalid.includes(kind) ? <p className="goals-error" role="alert" id={`goal-${kind}-error`}>Enter a positive whole number.</p> : null}
    </div>)}
    {attempted && !anyEnabled ? <p className="goals-error" role="alert">Keep at least one goal enabled.</p> : null}
    {error ? <p className="goals-error" role="alert">{error} Your changes are still here.</p> : null}
    <footer><button className="goals-save" disabled={saving} type="submit">{saving ? "Saving…" : start ? "Start tracking" : "Save changes"}</button>
      <small>Applies to today{start ? " · earlier days won’t be added" : " · past days stay unchanged"}</small></footer>
  </form>;
}
