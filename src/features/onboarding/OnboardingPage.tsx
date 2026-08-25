import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { LanguageCode, OnboardingState } from "../../../contracts/api";
import { EchoLockup } from "../../app/EchoBrand";
import { apiFetch } from "../../shared/api";
import type { Theme } from "../../shared/contracts";
import {
  isWelcomeLocation,
  onboardingHref,
  onboardingSteps,
  parseOnboardingStep,
  type OnboardingMode,
  type OnboardingStep,
} from "./onboardingRoute";

const screenCopy: Record<OnboardingStep, {
  title: string;
  action: string;
}> = {
  intro: { title: "Учите язык фразами из своей жизни", action: "Показать на примере" },
  tutor: { title: "Tutor: здесь общайтесь", action: "Дальше: Notebook" },
  notebook: { title: "Notebook: собирайте всё, что хотите сказать", action: "Дальше: Library" },
  library: { title: "Library: здесь хранятся ваши карточки", action: "Дальше: Practice" },
  practice: { title: "Practice: здесь вы учитесь говорить", action: "Начать Listen & Repeat" },
};

export function OnboardingPage(props: {
  language: LanguageCode;
  mode: OnboardingMode;
  onClose: () => void;
  onComplete: (state: OnboardingState) => void;
  theme: Theme;
}) {
  const [step, setStep] = useState<OnboardingStep>(() => parseOnboardingStep(window.location));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const index = onboardingSteps.indexOf(step);
  const isReplay = props.mode === "replay";
  const isLast = step === "practice";
  const action = props.language === "lv" && isLast ? "Начать Recall" : screenCopy[step].action;

  const focusHeading = () => window.requestAnimationFrame(() => headingRef.current?.focus());
  const goToStep = (next: OnboardingStep, historyMode: "push" | "replace" = "push") => {
    window.history[historyMode === "replace" ? "replaceState" : "pushState"](
      null, "", onboardingHref(next, props.mode),
    );
    setStep(next);
    setError("");
    focusHeading();
  };

  useEffect(() => {
    const canonical = onboardingHref(step, props.mode);
    if (`${window.location.pathname}${window.location.search}` !== canonical) {
      window.history.replaceState(null, "", canonical);
    }
    focusHeading();
  }, []);

  useEffect(() => {
    const onPopState = () => {
      if (!isWelcomeLocation(window.location)) {
        window.history.replaceState(null, "", onboardingHref(step, props.mode));
        return;
      }
      setStep(parseOnboardingStep(window.location));
      setError("");
      focusHeading();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [props.mode, step]);

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
    goToStep(onboardingSteps[index + 1]);
  };

  return <div className={`simple-app simple-app--${props.theme} onboarding-app`} data-theme={props.theme}>
    <main className="onboarding-shell" id="main-content">
      <header className="onboarding-header">
        <EchoLockup className="onboarding-brand" />
        <div className="onboarding-progress">
          <span>{index + 1} из {onboardingSteps.length}</span>
          <progress aria-label={`Шаг ${index + 1} из ${onboardingSteps.length}`} max={onboardingSteps.length} value={index + 1} />
        </div>
        {isReplay || !isLast ? <button className="onboarding-cancel" disabled={submitting}
          onClick={() => isReplay ? props.onClose() : void finish()} type="button">
          {isReplay ? "Закрыть" : "Отменить онбординг"}
        </button> : <span aria-hidden="true" className="onboarding-header-spacer" />}
      </header>

      <article className="onboarding-content" data-step={step}>
        {step === "intro" ? <span className="onboarding-eyebrow">Как работает Echo</span> : null}
        <h1 ref={headingRef} tabIndex={-1}>{screenCopy[step].title}</h1>

        {step === "intro" ? <>
          <div className="onboarding-copy">
            <p>Записывайте на русском всё, что хотите уметь сказать. Общайтесь с Tutor на любые темы: задавайте вопросы, разбирайте ситуации, разыгрывайте диалоги.</p>
            <p>Из полезных фраз получаются карточки. В каждой уже есть правильная грамматика, естественный порядок слов и нужный контекст.</p>
            <p>Слушайте диктора, повторяйте вслух и вспоминайте фразы без подсказки. Так вы учитесь произносить их без перевода и разбора правил.</p>
          </div>
          <div aria-label="Мои мысли превращаются в готовые карточки, а затем в мою речь" className="onboarding-flow">
            <strong>Мои мысли</strong><span aria-hidden="true">→</span><strong>готовые карточки</strong>
            <span aria-hidden="true">→</span><strong>моя речь</strong>
          </div>
          <p className="onboarding-note">Тему можно изменить в Settings.</p>
        </> : null}

        {step === "tutor" ? <>
          <div className="onboarding-copy">
            <p>Задавайте любые вопросы, просите объяснить фразу или разыгрывайте сценки. Tutor поддержит разговор на выбранном языке.</p>
            <p>Когда закончите, нажмите Finish &amp; make cards. Вы сами решите, какие фразы сохранить.</p>
            <p>Не знаете, что делать дальше? Спросите Tutor — он подскажет, где найти карточки и как лучше продолжить практику.</p>
          </div>
          <section aria-label="Пример разговора с Tutor" className="onboarding-example onboarding-dialogue">
            <p><span>Вы</span>«Давайте разыграем заказ кофе. Вы бариста».</p>
            <p><span>Tutor</span>«Конечно. Что вы хотите заказать?»</p>
          </section>
        </> : null}

        {step === "notebook" ? <>
          <div className="onboarding-copy">
            <p>Пишите или записывайте голосом по-русски всё, что хотели сказать: мысли, ответы, вопросы и диалоги.</p>
            <p>Echo подготовит естественные фразы на выбранном языке. Перед сохранением вы сможете проверить и изменить каждую карточку.</p>
          </div>
          <blockquote className="onboarding-example">Мне нужно перенести доставку на пятницу. После шести я буду дома.</blockquote>
        </> : null}

        {step === "library" ? <>
          <div className="onboarding-copy">
            <p>Здесь лежат фразы, которые вы решили сохранить. Карточки собраны по темам; их можно найти, изменить, перенести или удалить.</p>
            <p>Для начала у вас уже есть шесть карточек:</p>
          </div>
          <ul className="onboarding-topics">
            <li><strong>Заказываем кофе</strong><span>3 карточки</span></li>
            <li><strong>Доставка посылки</strong><span>3 карточки</span></li>
          </ul>
        </> : null}

        {step === "practice" ? <>
          <div className="onboarding-copy">
            <p>В Listen &amp; Repeat выберите голос, слушайте карточки и повторяйте вслух. Включите повтор всей колоды или одной фразы.</p>
            {props.language === "lv"
              ? <p>В Recall прочитайте русскую подсказку и напишите фразу на Latvian. После проверки повторите правильный вариант вслух.</p>
              : <p>В Recall попробуйте вспомнить фразу без подсказки. Так вы проверите, можете ли сказать её сами.</p>}
          </div>
          <div className="onboarding-practice-summary">
            <div><strong>Listen &amp; Repeat</strong><span>слушайте и повторяйте</span></div>
            <div><strong>Recall</strong><span>вспоминайте без подсказки</span></div>
          </div>
        </> : null}
      </article>

      <footer className="onboarding-footer">
        <div>{index > 0 ? <button className="onboarding-back" disabled={submitting}
          onClick={() => goToStep(onboardingSteps[index - 1])} type="button">
          <ArrowLeft aria-hidden="true" size={17} />Назад
        </button> : null}</div>
        <div className="onboarding-next-group">
          {error ? <p role="alert">{error}</p> : null}
          <button className="onboarding-next" disabled={submitting} onClick={next} type="button">
            {submitting ? "Завершаем…" : isReplay && isLast ? "Перейти в Practice" : action}
          </button>
        </div>
      </footer>
    </main>
  </div>;
}
