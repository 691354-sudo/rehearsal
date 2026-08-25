import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { LanguageCode, OnboardingState } from "../../../contracts/api";
import { apiFetch } from "../../shared/api";
import {
  onboardingSteps,
  type OnboardingMode,
  type OnboardingStep,
} from "./onboardingRoute";

const stepCopy: Record<OnboardingStep, {
  title: string;
  paragraphs: string[];
  example?: string;
  action: string;
}> = {
  tutor: {
    title: "Tutor: общайтесь и разбирайте ситуации",
    paragraphs: [
      "Здесь можно задавать любые вопросы, просить объяснить фразу или разыгрывать сценки.",
      "Когда разговор закончен, нажмите Finish & make cards и выберите фразы, которые хотите сохранить.",
    ],
    example: "Попробуйте: «Давайте разыграем заказ кофе. Вы бариста».",
    action: "Дальше: Notebook",
  },
  notebook: {
    title: "Notebook: собирайте всё, что хотите сказать",
    paragraphs: [
      "Пишите или записывайте голосом по-русски мысли, фразы, вопросы и целые диалоги — всё, что хотите уметь сказать.",
      "Нажмите Prepare cards. Echo подготовит естественные фразы, а вы проверите их перед сохранением.",
    ],
    example: "Например: «Мне нужно перенести доставку на пятницу. После шести я буду дома».",
    action: "Дальше: Library",
  },
  library: {
    title: "Library: здесь хранятся ваши карточки",
    paragraphs: [
      "Здесь лежат сохранённые фразы. Их можно искать, изменять, переносить между Topics и удалять.",
      "Для примера уже созданы две темы: «Заказываем кофе» и «Доставка посылки» — по три карточки в каждой.",
    ],
    action: "Дальше: Practice",
  },
  practice: {
    title: "Practice: здесь вы учитесь говорить",
    paragraphs: [
      "В Listen & Repeat выберите голос, слушайте карточки и повторяйте вслух. Repeat переключает повтор всей колоды и одной фразы.",
      "В Recall попробуйте сказать фразу по русской подсказке без ответа перед глазами.",
    ],
    action: "Начать Listen & Repeat",
  },
};

export function OnboardingPage(props: {
  language: LanguageCode;
  mode: OnboardingMode;
  step: OnboardingStep;
  onClose: () => void;
  onComplete: (state: OnboardingState) => void;
  onStep: (step: OnboardingStep) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const index = onboardingSteps.indexOf(props.step);
  const isReplay = props.mode === "replay";
  const isLast = props.step === "practice";
  const copy = stepCopy[props.step];
  const paragraphs = props.language === "lv" && isLast
    ? ["Для Latvian Practice открывается в Recall. Прочитайте русскую подсказку, напишите фразу по-латышски и после проверки повторите правильный вариант вслух."]
    : copy.paragraphs;
  const action = props.language === "lv" && isLast ? "Начать Recall" : copy.action;

  useEffect(() => {
    const target = document.querySelector<HTMLElement>(`[data-onboarding-target="${props.step}"]`);
    target?.classList.add("is-onboarding-target");
    target?.scrollIntoView({ block: "nearest", behavior: "auto" });
    window.requestAnimationFrame(() => headingRef.current?.focus());
    return () => target?.classList.remove("is-onboarding-target");
  }, [props.step]);

  const finish = async () => {
    if (isReplay) {
      props.onClose();
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const response = await apiFetch("/api/onboarding/complete", { method: "POST" });
      if (!response.ok) throw new Error("Onboarding completion failed");
      const result = await response.json() as { onboarding: OnboardingState };
      props.onComplete(result.onboarding);
    } catch {
      setError("Не удалось завершить онбординг. Проверьте соединение и попробуйте снова.");
    } finally {
      setSubmitting(false);
    }
  };

  const next = () => {
    if (isLast) {
      void finish();
      return;
    }
    props.onStep(onboardingSteps[index + 1]);
  };

  return <aside aria-labelledby="onboarding-tour-title" className="onboarding-tour" data-step={props.step}>
    <header className="onboarding-tour-header">
      <div className="onboarding-progress">
        <span>{index + 1} из {onboardingSteps.length}</span>
        <progress aria-label={`Шаг ${index + 1} из ${onboardingSteps.length}`} max={onboardingSteps.length} value={index + 1} />
      </div>
      {isReplay || !isLast ? <button className="onboarding-cancel" disabled={submitting}
        onClick={() => isReplay ? props.onClose() : void finish()} type="button">
        {isReplay ? "Закрыть" : "Отменить онбординг"}
      </button> : null}
    </header>

    <div className="onboarding-tour-copy">
      <h2 id="onboarding-tour-title" ref={headingRef} tabIndex={-1}>{copy.title}</h2>
      {paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      {copy.example ? <blockquote>{copy.example}</blockquote> : null}
    </div>

    <footer className="onboarding-tour-footer">
      {index > 0 ? <button className="onboarding-back" disabled={submitting}
        onClick={() => props.onStep(onboardingSteps[index - 1])} type="button">
        <ArrowLeft aria-hidden="true" size={17} />Назад
      </button> : <span />}
      <div>
        {error ? <p role="alert">{error}</p> : null}
        <button className="onboarding-next" disabled={submitting} onClick={next} type="button">
          {submitting ? "Завершаем…" : isReplay && isLast ? "Закончить экскурсию" : action}
        </button>
      </div>
    </footer>
  </aside>;
}
