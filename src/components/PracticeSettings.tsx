import { RotateCcw, Settings2, X } from "lucide-react";
import type { PracticeSettings as Settings } from "../types/practice";

type PracticeSettingsProps = {
  open: boolean;
  settings: Settings;
  onChange: (settings: Settings) => void;
  onReset: () => void;
  onClose: () => void;
};

type Option<T extends string | number> = { label: string; value: T };

function OptionRow<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="setting-group">
      <span className="setting-label">{label}</span>
      <div className="option-row">
        {options.map((option) => (
          <button
            className={value === option.value ? "option-pill is-selected" : "option-pill"}
            key={option.value}
            onClick={() => onChange(option.value)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="toggle-row">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input checked={checked} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
      <span className="toggle-track" aria-hidden="true" />
    </label>
  );
}

export function PracticeSettings({
  open,
  settings,
  onChange,
  onReset,
  onClose,
}: PracticeSettingsProps) {
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    onChange({ ...settings, [key]: value });

  return (
    <>
      <button
        aria-label="Закрыть настройки"
        className={open ? "settings-backdrop is-visible" : "settings-backdrop"}
        onClick={onClose}
        tabIndex={open ? 0 : -1}
        type="button"
      />
      <aside aria-hidden={!open} className={open ? "settings-sheet is-open" : "settings-sheet"}>
        <header className="settings-header">
          <span className="settings-glyph">
            <Settings2 size={20} />
          </span>
          <div>
            <h2>Ритм практики</h2>
            <p>Отдельные настройки сохраняются для каждого языка.</p>
          </div>
          <button aria-label="Закрыть" className="icon-button" onClick={onClose} type="button">
            <X size={20} />
          </button>
        </header>

        <div className="settings-content">
          <OptionRow
            label="Повторов на фразу"
            onChange={(value) => update("repetitions", value)}
            options={[1, 2, 3, 4, 5].map((value) => ({ label: `${value}×`, value }))}
            value={settings.repetitions}
          />

          <div className="setting-group">
            <div className="range-heading">
              <span className="setting-label">Скорость голоса</span>
              <strong>{settings.playbackRate.toFixed(2)}×</strong>
            </div>
            <input
              aria-label="Скорость голоса"
              className="range-input"
              max="1.5"
              min="0.5"
              onChange={(event) => update("playbackRate", Number(event.target.value))}
              step="0.05"
              type="range"
              value={settings.playbackRate}
            />
            <div className="range-labels">
              <span>0.5×</span>
              <span>1×</span>
              <span>1.5×</span>
            </div>
          </div>

          <OptionRow
            label="Пауза после фразы"
            onChange={(value) => update("phrasePauseMs", value)}
            options={[
              { label: "0.5s", value: 500 },
              { label: "1.2s", value: 1200 },
              { label: "2s", value: 2000 },
              { label: "3s", value: 3000 },
              { label: "5s", value: 5000 },
            ]}
            value={settings.phrasePauseMs}
          />

          <OptionRow
            label="Порядок аудио"
            onChange={(value) => update("playbackOrder", value)}
            options={[
              { label: "Только язык", value: "target" },
              { label: "RU → язык", value: "cue-target" },
              { label: "Язык → RU", value: "target-cue" },
            ]}
            value={settings.playbackOrder}
          />

          <OptionRow
            label="Размер текста"
            onChange={(value) => update("textScale", value)}
            options={[
              { label: "A−", value: "compact" },
              { label: "A", value: "regular" },
              { label: "A+", value: "large" },
            ]}
            value={settings.textScale}
          />

          <OptionRow
            label="Порядок фраз"
            onChange={(value) => update("sortMode", value)}
            options={[
              { label: "Слабые", value: "weak-first" },
              { label: "Новые", value: "new-first" },
              { label: "По порядку", value: "original" },
              { label: "Вперемешку", value: "shuffle" },
            ]}
            value={settings.sortMode}
          />

          <div className="toggle-stack">
            <Toggle
              checked={settings.showTranslation}
              description="Показывать русскую подсказку в shadowing"
              label="Показывать перевод"
              onChange={(value) => update("showTranslation", value)}
            />
            <Toggle
              checked={settings.autoAdvance}
              description="Переходить дальше после воспроизведения"
              label="Автопереход"
              onChange={(value) => update("autoAdvance", value)}
            />
            <Toggle
              checked={settings.loopQueue}
              description="После последней фразы начать сначала"
              label="Повторять очередь"
              onChange={(value) => update("loopQueue", value)}
            />
          </div>
        </div>

        <footer className="settings-footer">
          <button className="quiet-button" onClick={onReset} type="button">
            <RotateCcw size={16} />
            <span>Сбросить настройки языка</span>
          </button>
          <button className="primary-button" onClick={onClose} type="button">
            Готово
          </button>
        </footer>
      </aside>
    </>
  );
}
