import { useEffect, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { focusTermsInTarget } from "../../../contracts/text";
import type { AppRoute } from "../../lib/appRoute";
import { apiFetch } from "../../shared/api";
import { languageCopy } from "../../shared/config";
import type { IslandSummary, Language, LearningItem } from "../../shared/contracts";

export function CardCreateDialog(props: {
  language: Language;
  topics: IslandSummary[];
  initialTopicId?: string;
  onClose: () => void;
  onCreated: (item: LearningItem) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const allowNavigationRef = useRef(false);
  const [target, setTarget] = useState("");
  const [cue, setCue] = useState("");
  const [focusPhrase, setFocusPhrase] = useState("");
  const [topicId, setTopicId] = useState(props.initialTopicId || "");
  const [note, setNote] = useState("");
  const [frequencyBand, setFrequencyBand] = useState<LearningItem["frequencyBand"]>("common");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const dirty = Boolean(target || cue || focusPhrase || note
    || topicId !== (props.initialTopicId || "") || frequencyBand !== "common");
  const focusTerms = focusPhrase.trim() ? [focusPhrase.trim()] : [];
  const focusValid = focusTermsInTarget(target, focusTerms);
  const topicValid = Boolean(topicId);

  const requestClose = () => {
    if (dirty && !window.confirm("Discard this unfinished card?")) return;
    allowNavigationRef.current = true; props.onClose();
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; dialog.showModal();
    return () => { if (dialog.open) dialog.close(); document.body.style.overflow = previousOverflow; };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: Event) => {
      const next = (event as CustomEvent<{ route: AppRoute }>).detail?.route;
      if (next?.section === "library" && next.language === props.language && next.panel === "create") return;
      if (allowNavigationRef.current || window.confirm("Discard this unfinished card?")) return;
      event.preventDefault();
    };
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("app-before-navigate", warn); window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("app-before-navigate", warn); window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [dirty, props.language]);

  const save = async () => {
    if (!target.trim() || !cue.trim() || !focusValid || !topicValid || saving) return;
    setSaving(true); setSaveError("");
    try {
      const response = await apiFetch("/api/items", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: props.language, target: target.trim(), cue: cue.trim(),
          focusTerms, topicId, note: note.trim(), frequencyBand }),
      });
      if (!response.ok) throw new Error(response.status === 400
        ? "Check the focus phrase and required fields."
        : "Could not create this card.");
      const data = await response.json() as { item: LearningItem };
      allowNavigationRef.current = true; props.onCreated(data.item);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not create this card.");
      setSaving(false);
    }
  };

  return <dialog aria-labelledby="card-create-title" className="simple-card-dialog"
    onCancel={(event) => { event.preventDefault(); requestClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) requestClose(); }} ref={dialogRef}>
    <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <header><div><h2 id="card-create-title">Add card</h2><span>Manual entry</span></div>
        <button aria-label="Close new card" onClick={requestClose} type="button"><X size={17} /></button></header>
      <div className="simple-card-dialog-fields">
        <label><span>{languageCopy[props.language].label}</span><textarea autoComplete="off" autoFocus lang={props.language}
          name="new-card-target" onChange={(event) => setTarget(event.target.value)} rows={3} value={target} /></label>
        <label><span>Russian cue</span><textarea autoComplete="off" lang="ru" name="new-card-cue"
          onChange={(event) => setCue(event.target.value)} rows={3} value={cue} /></label>
        <label><span>Focus phrase</span><input aria-describedby="new-card-focus-help" autoComplete="off" name="new-card-focus"
          onChange={(event) => setFocusPhrase(event.target.value)} value={focusPhrase} />
          <small id="new-card-focus-help">Optional · must appear exactly in the target phrase.</small>
          {!focusValid ? <em className="simple-card-dialog-error">Focus phrase isn’t present in the target.</em> : null}</label>
        <label><span>Topic</span><select aria-describedby={!props.topics.length ? "new-card-topic-help" : undefined} name="new-card-topic" onChange={(event) => setTopicId(event.target.value)} required value={topicId}>
          <option disabled value="">Choose a Topic…</option>{props.topics.map((topic) => <option key={topic.publicId} value={topic.publicId}>{topic.title}</option>)}</select>
          {!props.topics.length ? <small id="new-card-topic-help">Create a Topic before adding a card.</small> : null}</label>
        <details className="simple-card-more"><summary><span>More details</span><ChevronDown size={15} /></summary><div>
          <label><span>Note</span><textarea autoComplete="off" name="new-card-note" onChange={(event) => setNote(event.target.value)} rows={2} value={note} /></label>
          <label><span>Frequency</span><select name="new-card-frequency" onChange={(event) => setFrequencyBand(event.target.value as LearningItem["frequencyBand"])} value={frequencyBand}>
            <option value="core">Core</option><option value="common">Common</option><option value="specific">Specific</option><option value="rare">Rare</option>
          </select></label>
        </div></details>
        {saveError ? <p className="simple-card-dialog-error" role="alert">{saveError}</p> : null}
      </div>
      <footer><span /><div><button disabled={saving} onClick={requestClose} type="button">Cancel</button>
        <button className="simple-primary" disabled={saving || !target.trim() || !cue.trim() || !focusValid || !topicValid}
          type="submit">{saving ? "Creating…" : "Create card"}</button></div></footer>
    </form>
  </dialog>;
}
