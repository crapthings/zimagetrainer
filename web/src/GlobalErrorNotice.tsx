import { FloatingPortal } from "@floating-ui/react";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "./store";
import { useI18n } from "./i18n";

export function GlobalErrorNotice() {
  const error = useStore((state) => state.globalError);
  const clearError = useStore((state) => state.clearError);
  const navigate = useNavigate();
  const { t } = useI18n();

  useEffect(() => {
    if (!error) return;
    const timeout = window.setTimeout(clearError, 8000);
    return () => window.clearTimeout(timeout);
  }, [error, clearError]);

  if (!error) return null;

  return (
    <FloatingPortal>
      <section
        className="global-error-notice"
        role="alert"
        aria-live="assertive"
      >
        <div className="global-error-icon" aria-hidden="true">
          !
        </div>
        <div className="min-w-0 flex-1">
          <h2>{t(error.title)}</h2>
          <p>{t(error.message)}</p>
          {error.action && (
            <button
              type="button"
              onClick={() => {
                navigate(error.action!.path);
                clearError();
              }}
            >
              {t(error.action.label)}
            </button>
          )}
        </div>
        <button
          type="button"
          className="global-error-close"
          aria-label={t("Dismiss error")}
          onClick={clearError}
        >
          ×
        </button>
      </section>
    </FloatingPortal>
  );
}
