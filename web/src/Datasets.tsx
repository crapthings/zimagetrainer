import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  autoUpdate,
  flip,
  FloatingFocusManager,
  FloatingOverlay,
  FloatingPortal,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { captionModels } from "./ModelSelect";
import { FriendlyError } from "./errors";
import { useStore } from "./store";
import { useI18n } from "./i18n";

const API = "";
const DEFAULT_CAPTION_PROMPT =
  "Write one concise, factual image-training caption. Describe subject, visual style, setting, composition, lighting and meaningful details. Output only the caption.";
type Dataset = {
  id: string;
  name: string;
  folder: string;
  created_at: string;
  image_count: number;
  cover_path?: string;
  system_prompt?: string;
  caption_model?: string;
};
type Image = { id: string; path: string; caption: string };
type ValidationSample = {
  prompt: string;
  width: number;
  height: number;
};
type ValidationResolutionOption = {
  ratio?: string;
  width: number;
  height: number;
};
const validationResolutionGroups: {
  label: string;
  options: ValidationResolutionOption[];
}[] = [
  {
    label: "Square · 1:1",
    options: [
      { width: 512, height: 512 },
      { width: 768, height: 768 },
      { width: 1024, height: 1024 },
    ],
  },
  {
    label: "Landscape",
    options: [
      { ratio: "4:3", width: 896, height: 672 },
      { ratio: "3:2", width: 960, height: 640 },
      { ratio: "16:9", width: 1024, height: 576 },
    ],
  },
  {
    label: "Portrait",
    options: [
      { ratio: "3:4", width: 672, height: 896 },
      { ratio: "2:3", width: 640, height: 960 },
      { ratio: "9:16", width: 576, height: 1024 },
    ],
  },
];
type TrainingParams = {
  resolution: number;
  rank: number;
  steps: number;
  saveEvery?: number;
  keepLast?: number;
  sampleEnabled?: boolean;
  sampleEvery?: number;
  validationSamples?: ValidationSample[];
};
type SuggestedTrainingParams = TrainingParams & {
  exposures_per_image: number;
};
type Suggestion = {
  image_count: number;
  captioned_count: number;
  caption_coverage: number;
  median_short_side: number;
  recommended: SuggestedTrainingParams;
  quick: SuggestedTrainingParams;
  sample_prompt?: string;
  sample_prompt_reason?: string;
  reason: string;
};

function ValidationResolutionMenu({
  sample,
  index,
  onChange,
}: {
  sample: ValidationSample;
  index: number;
  onChange: (changes: Partial<ValidationSample>) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const selected = validationResolutionGroups
    .flatMap((group) => group.options)
    .find(
      (option) =>
        option.width === sample.width && option.height === sample.height,
    );
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "bottom-start",
    middleware: [offset(5), flip(), shift({ padding: 12 })],
    whileElementsMounted: autoUpdate,
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useClick(context),
    useDismiss(context),
    useRole(context, { role: "menu" }),
  ]);

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        className="validation-resolution-trigger"
        aria-label={`${t("Validation resolution")} ${index + 1}`}
        {...getReferenceProps()}
      >
        <span>
          {selected && "ratio" in selected ? selected.ratio : "1:1"} ·{" "}
          {sample.width} × {sample.height}
        </span>
        <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14">
          <path
            d="m4 6 4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.75"
          />
        </svg>
      </button>
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className="validation-resolution-menu"
            {...getFloatingProps()}
          >
            {validationResolutionGroups.map((group) => (
              <div className="validation-resolution-group" key={group.label}>
                <p>{group.label === "Landscape" || group.label === "Portrait" ? t(group.label) : group.label}</p>
                {group.options.map((option) => {
                  const active =
                    option.width === sample.width &&
                    option.height === sample.height;
                  return (
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      className={active ? "is-active" : ""}
                      key={`${option.width}x${option.height}`}
                      onClick={() => {
                        onChange({
                          width: option.width,
                          height: option.height,
                        });
                        setOpen(false);
                      }}
                    >
                      <span>{"ratio" in option ? option.ratio : "1:1"}</span>
                      <span>
                        {option.width} × {option.height}
                      </span>
                      {active && <span aria-hidden="true">✓</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
const getDatasets = async (): Promise<Dataset[]> =>
  (await fetch(`${API}/api/datasets`)).json().then((x) => x.datasets);
const getDataset = async (
  id: string,
): Promise<{ dataset: Dataset; images: Image[] }> =>
  (await fetch(`${API}/api/datasets/${id}`)).json();

function CaptionActions({
  model,
  prompt,
  onModel,
  onPrompt,
  onSave,
  onCaption,
  onRecaption,
  disabled,
  captioning,
  saving,
  apiKeyMissing,
}: {
  model: string;
  prompt: string;
  onModel: (v: string) => void;
  onPrompt: (v: string) => void;
  onSave: () => void;
  onCaption: () => void;
  onRecaption: () => void;
  disabled: boolean;
  captioning: boolean;
  saving: boolean;
  apiKeyMissing: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const selected =
    captionModels.find((candidate) => candidate.id === model) ??
    captionModels[0];
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "bottom-end",
    middleware: [offset(6), flip(), shift({ padding: 12 })],
    whileElementsMounted: autoUpdate,
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useClick(context),
    useDismiss(context),
    useRole(context, { role: "dialog" }),
  ]);

  return (
    <>
      <div className="caption-combo">
        <button
          className="caption-combo-main"
          disabled={disabled}
          onClick={onCaption}
        >
          <span>{captioning ? t("Captioning…") : t("Caption missing")}</span>
        </button>
        <button
          ref={refs.setReference}
          className="caption-combo-toggle"
          aria-label={t("Caption options")}
          disabled={captioning}
          {...getReferenceProps()}
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14">
            <path
              d="m4 6 4 4 4-4"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.75"
            />
          </svg>
        </button>
      </div>

      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className="caption-options"
            {...getFloatingProps()}
          >
            {apiKeyMissing && (
              <Link className="caption-key-warning" to="/settings">
                {t("Gemini API key is missing. Add one in Settings.")}
              </Link>
            )}
            <p className="caption-options-label">{t("Caption model")}</p>
            <p className="caption-current-model">
              {t("Current:")} <strong>{selected.name}</strong>
            </p>
            <div className="mt-1 grid gap-1">
              {captionModels.map((candidate) => (
                <button
                  key={candidate.id}
                  className={`caption-model-option ${candidate.id === model ? "caption-model-option-active" : ""}`}
                  onClick={() => {
                    onModel(candidate.id);
                    setOpen(false);
                  }}
                >
                  <span>{candidate.name}</span>
                  {candidate.id === model && <span aria-hidden="true">✓</span>}
                </button>
              ))}
            </div>

            <div className="caption-options-divider" />
            <button
              className="caption-recaption-action"
              disabled={disabled}
              onClick={() => {
                onRecaption();
                setOpen(false);
              }}
            >
              {t("Re-caption all images")}
            </button>

            <details className="mt-1 rounded-lg border border-olive-200 bg-olive-50 p-2">
              <summary className="cursor-pointer text-xs font-semibold text-olive-700">
                {t("System prompt")}
              </summary>
              <textarea
                className="mt-2 min-h-28 w-full rounded-md border border-olive-200 bg-white p-2 text-xs text-olive-800 outline-none focus:border-olive-500"
                value={prompt}
                onChange={(event) => onPrompt(event.target.value)}
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <button
                  className="text-xs font-semibold text-olive-700 hover:underline"
                  onClick={() => onPrompt(DEFAULT_CAPTION_PROMPT)}
                >
                  {t("Restore default")}
                </button>
                <button
                  className="rounded-md bg-olive-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                  disabled={saving}
                  onClick={onSave}
                >
                  {saving ? t("Saving…") : t("Save prompt")}
                </button>
              </div>
            </details>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

function ConfirmAction({
  label,
  title,
  detail,
  confirmLabel,
  onConfirm,
  disabled = false,
  danger = false,
}: {
  label: string;
  title: string;
  detail: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "bottom-end",
    middleware: [offset(6), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useClick(context),
    useDismiss(context),
    useRole(context),
  ]);
  return (
    <>
      <button
        ref={refs.setReference}
        disabled={disabled}
        className={
          danger
            ? "rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-40"
            : "secondary !mt-0 !w-auto"
        }
        {...getReferenceProps()}
      >
        {label}
      </button>
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className="z-50 w-64 rounded-lg border border-olive-200 bg-white p-3 shadow-xl"
            {...getFloatingProps()}
          >
            <h3 className="text-xs font-bold text-olive-900">{title}</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-olive-500">
              {detail}
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                className="rounded-md px-2 py-1.5 text-xs text-olive-600 hover:bg-olive-100"
                onClick={() => setOpen(false)}
              >
                {t("Cancel")}
              </button>
              <button
                className="rounded-md bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
                onClick={() => {
                  onConfirm();
                  setOpen(false);
                }}
              >
                {confirmLabel}
              </button>
            </div>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

function DatasetActions({
  onDelete,
  deleting,
}: {
  onDelete: () => void;
  deleting: boolean;
}) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const menu = useFloating({
    open: menuOpen,
    onOpenChange: setMenuOpen,
    placement: "bottom-end",
    middleware: [offset(6), flip(), shift({ padding: 12 })],
    whileElementsMounted: autoUpdate,
  });
  const confirmation = useFloating({
    open: confirmOpen,
    onOpenChange: setConfirmOpen,
    placement: "bottom-end",
    middleware: [offset(6), flip(), shift({ padding: 12 })],
    whileElementsMounted: autoUpdate,
  });
  const menuInteractions = useInteractions([
    useClick(menu.context),
    useDismiss(menu.context),
    useRole(menu.context, { role: "menu" }),
  ]);
  const confirmInteractions = useInteractions([
    useDismiss(confirmation.context),
    useRole(confirmation.context, { role: "dialog" }),
  ]);
  const setReference = (node: HTMLButtonElement | null) => {
    menu.refs.setReference(node);
    confirmation.refs.setReference(node);
  };

  return (
    <>
      <button
        ref={setReference}
        className="dataset-menu-trigger"
        aria-label={t("Dataset actions")}
        disabled={deleting}
        {...menuInteractions.getReferenceProps()}
      >
        <span aria-hidden="true">•••</span>
      </button>

      {menuOpen && (
        <FloatingPortal>
          <div
            ref={menu.refs.setFloating}
            style={menu.floatingStyles}
            className="dataset-menu"
            {...menuInteractions.getFloatingProps()}
          >
            <button
              className="dataset-menu-danger"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setConfirmOpen(true);
              }}
            >
              {t("Delete dataset")}
            </button>
          </div>
        </FloatingPortal>
      )}

      {confirmOpen && (
        <FloatingPortal>
          <div
            ref={confirmation.refs.setFloating}
            style={confirmation.floatingStyles}
            className="dataset-delete-confirm"
            {...confirmInteractions.getFloatingProps()}
          >
            <h3 className="text-xs font-bold text-olive-900">
              {t("Delete this dataset?")}
            </h3>
            <p className="mt-1 text-[11px] leading-relaxed text-olive-500">
              {t("All images, captions, and metadata in this dataset will be permanently deleted.")}
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                className="rounded-md px-2 py-1.5 text-xs text-olive-600 hover:bg-olive-100"
                onClick={() => setConfirmOpen(false)}
              >
                {t("Cancel")}
              </button>
              <button
                className="rounded-md bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-40"
                disabled={deleting}
                onClick={() => {
                  onDelete();
                  setConfirmOpen(false);
                }}
              >
                {deleting ? t("Deleting…") : t("Delete dataset")}
              </button>
            </div>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

function TrainingPlan({
  imageCount,
  captionedCount,
  suggestion,
  onQueue,
  queuing,
}: {
  imageCount: number;
  captionedCount: number;
  suggestion?: Suggestion;
  onQueue: (params: TrainingParams) => void;
  queuing: boolean;
}) {
  const { t } = useI18n();
  const [preset, setPreset] = useState<"recommended" | "quick" | "custom">(
    "recommended",
  );
  const [panelTab, setPanelTab] = useState<"training" | "validation">(
    "training",
  );
  const [params, setParams] = useState<TrainingParams>({
    resolution: 1024,
    rank: 16,
    steps: 1000,
    saveEvery: 250,
    keepLast: 3,
    sampleEnabled: true,
    sampleEvery: 250,
    validationSamples: [{ prompt: "", width: 768, height: 768 }],
  });
  useEffect(() => {
    if (suggestion)
      setParams((current) => ({
        ...current,
        ...suggestion.recommended,
        sampleEnabled: current.sampleEnabled ?? true,
        sampleEvery: current.sampleEvery ?? 250,
        validationSamples:
          current.validationSamples?.some((sample) => sample.prompt.trim()) ===
          true
            ? current.validationSamples
            : [
                {
                  prompt: suggestion.sample_prompt || "",
                  width: 768,
                  height: 768,
                },
              ],
      }));
  }, [suggestion?.reason]);
  const applyPreset = (next: "recommended" | "quick") => {
    setPreset(next);
    const plan =
      next === "recommended" ? suggestion?.recommended : suggestion?.quick;
    if (plan)
      setParams((current) => ({
        ...current,
        resolution: plan.resolution,
        rank: plan.rank,
        steps: plan.steps,
        saveEvery: Math.min(current.saveEvery ?? 250, plan.steps),
      }));
  };
  const ready = imageCount > 0 && captionedCount === imageCount;
  const recommended = suggestion?.recommended ?? params;
  const recommendedExposures =
    suggestion?.recommended.exposures_per_image ??
    (imageCount ? Math.round((params.steps / imageCount) * 10) / 10 : 0);
  const quick = suggestion?.quick ?? {
    ...params,
    rank: 8,
    steps: 50,
    exposures_per_image: imageCount
      ? Math.round((50 / imageCount) * 10) / 10
      : 0,
  };
  const exposuresPerImage = imageCount
    ? Math.round((params.steps / imageCount) * 10) / 10
    : 0;
  const saveEvery = Math.max(1, params.saveEvery ?? 250);
  const keepLast = Math.max(1, params.keepLast ?? 3);
  const checkpointCount = Math.ceil(params.steps / saveEvery);
  const retainedCheckpointCount = Math.min(checkpointCount, keepLast);
  const validationSamples = params.validationSamples?.length
    ? params.validationSamples
    : [{ prompt: "", width: 768, height: 768 }];
  const validationReady =
    !params.sampleEnabled ||
    validationSamples.some((sample) => sample.prompt.trim().length > 0);
  const updateValidationSample = (
    index: number,
    changes: Partial<ValidationSample>,
  ) =>
    setParams({
      ...params,
      validationSamples: validationSamples.map((sample, sampleIndex) =>
        sampleIndex === index ? { ...sample, ...changes } : sample,
      ),
    });
  const selected = (name: "recommended" | "quick") =>
    `rounded-md border px-3 py-2 text-left transition ${preset === name ? "border-olive-400 bg-olive-50 ring-1 ring-olive-200" : "border-olive-200 bg-white hover:border-olive-300"}`;
  return (
    <section className="training-panel">
      <h3 className="text-sm font-semibold">{t("Training")}</h3>
      <div className="training-tabs" role="tablist" aria-label={t("Training setup")}>
        <button
          role="tab"
          aria-selected={panelTab === "training"}
          className={panelTab === "training" ? "training-tab-active" : ""}
          onClick={() => setPanelTab("training")}
        >
          {t("Training")}
        </button>
        <button
          role="tab"
          aria-selected={panelTab === "validation"}
          className={panelTab === "validation" ? "training-tab-active" : ""}
          onClick={() => setPanelTab("validation")}
        >
          {t("Validation")}
          {params.sampleEnabled && (
            <span className="training-tab-count">
              {validationSamples.length}
            </span>
          )}
        </button>
      </div>

      {panelTab === "training" ? (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              className={selected("recommended")}
              onClick={() => applyPreset("recommended")}
            >
              <span className="block text-xs font-semibold text-olive-800">
                {t("Recommended")}
              </span>
              <span className="mt-1 block text-[10px] text-olive-500">
                {recommended.resolution}px · R{recommended.rank} ·{" "}
                {recommended.steps} {t("steps")}
              </span>
              <span className="training-help-translation mt-1 block text-[9px] text-olive-500" data-translation={t("≈{count}× per image", { count: recommendedExposures })}>
                ≈ {recommendedExposures}× per image
              </span>
            </button>
            <button
              className={selected("quick")}
              onClick={() => applyPreset("quick")}
            >
              <span className="block text-xs font-semibold text-olive-800">
                {t("Test run")}
              </span>
              <span className="mt-1 block text-[10px] text-olive-500">
                {quick.resolution}px · R{quick.rank} · {quick.steps} {t("steps")}
              </span>
              <span className="training-help-translation mt-1 block text-[9px] text-olive-500" data-translation={t("Verify training and output · ≈{count}×", { count: quick.exposures_per_image })}>
                Verify training and output · ≈ {quick.exposures_per_image}×
              </span>
            </button>
          </div>
          <div className="training-form">
            <section className="training-form-group">
              <h4 className="training-form-title">{t("Training parameters")}</h4>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <label>
                  {t("Resolution")}
                  <input
                    className="training-input"
                    type="number"
                    value={params.resolution}
                    onChange={(e) => {
                      setPreset("custom");
                      setParams({ ...params, resolution: +e.target.value });
                    }}
                  />
                </label>
                <label>
                  {t("Rank")}
                  <input
                    className="training-input"
                    type="number"
                    value={params.rank}
                    onChange={(e) => {
                      setPreset("custom");
                      setParams({ ...params, rank: +e.target.value });
                    }}
                  />
                </label>
                <label>
                  {t("Steps")}
                  <input
                    className="training-input"
                    type="number"
                    value={params.steps}
                    onChange={(e) => {
                      setPreset("custom");
                      setParams({ ...params, steps: +e.target.value });
                    }}
                  />
                </label>
              </div>
              <p className="training-help-translation mt-2 text-[10px] leading-relaxed text-olive-500" data-translation={t("≈{count} presentations per image at batch size 1. Compare validation checkpoints; more is not always better.", { count: exposuresPerImage })}>
                ≈ {exposuresPerImage} presentations per image at batch size 1.
                Compare validation checkpoints; more is not always better.
              </p>
            </section>

            <div className="training-form-divider" role="separator" />

            <section className="training-form-group">
              <h4 className="training-form-title">{t("Checkpoints")}</h4>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label>
                  {t("Save every")}
                  <div className="training-input-suffix">
                    <input
                      className="training-input"
                      type="number"
                      min="1"
                      max={params.steps}
                      value={params.saveEvery ?? 250}
                      onChange={(e) =>
                        setParams({ ...params, saveEvery: +e.target.value })
                      }
                    />
                    <span>{t("Steps")}</span>
                  </div>
                </label>
                <label>
                  {t("Keep latest")}
                  <div className="training-input-suffix">
                    <input
                      className="training-input"
                      type="number"
                      min="1"
                      value={params.keepLast ?? 3}
                      onChange={(e) =>
                        setParams({ ...params, keepLast: +e.target.value })
                      }
                    />
                    <span>{t("files")}</span>
                  </div>
                </label>
              </div>
              <p className="training-help-translation mt-2 text-[10px] text-olive-500" data-translation={t("Creates {count} checkpoints; keeps the latest {kept}, including the final model.", { count: checkpointCount, kept: retainedCheckpointCount })}>
                Creates {checkpointCount} checkpoint
                {checkpointCount === 1 ? "" : "s"}; keeps the latest{" "}
                {retainedCheckpointCount}, including the final model.
              </p>
            </section>
          </div>
        </>
      ) : (
        <section className="training-validation">
          <div className="flex items-center justify-between gap-4">
            <h4 className="training-form-title">{t("Validation images")}</h4>
            <label className="validation-switch">
              <input
                type="checkbox"
                aria-label={t("Generate validation images")}
                checked={!!params.sampleEnabled}
                onChange={(event) =>
                  setParams({
                    ...params,
                    sampleEnabled: event.target.checked,
                  })
                }
              />
              <i aria-hidden="true" />
            </label>
          </div>
          {params.sampleEnabled && (
            <>
              <label className="validation-frequency">
                {t("Generate every")}
                <div className="training-input-suffix">
                  <input
                    className="training-input"
                    type="number"
                    min="1"
                    value={params.sampleEvery}
                    onChange={(e) =>
                      setParams({ ...params, sampleEvery: +e.target.value })
                    }
                  />
                  <span>{t("Steps")}</span>
                </div>
              </label>
              <div className="training-prompt-list">
                {validationSamples.map((sample, index) => (
                  <div className="training-prompt-item" key={index}>
                    <div className="validation-prompt-header">
                      <span>{t("Prompt")} {index + 1}</span>
                      <div className="validation-prompt-actions">
                        <ValidationResolutionMenu
                          sample={sample}
                          index={index}
                          onChange={(changes) =>
                            updateValidationSample(index, changes)
                          }
                        />
                        {validationSamples.length > 1 && (
                          <button
                            type="button"
                            className="validation-prompt-remove"
                            aria-label={`${t("Remove prompt")} ${index + 1}`}
                            title={t("Remove prompt")}
                            onClick={() =>
                              setParams({
                                ...params,
                                validationSamples: validationSamples.filter(
                                  (_, sampleIndex) => sampleIndex !== index,
                                ),
                              })
                            }
                          >
                            <svg
                              aria-hidden="true"
                              viewBox="0 0 16 16"
                              width="14"
                              height="14"
                            >
                              <path
                                d="M3.5 4.5h9m-5.5-2h2l.75 2h-3.5l.75-2Zm-2 2 .5 8h5l.5-8M7 7v3m2-3v3"
                                fill="none"
                                stroke="currentColor"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="1.25"
                              />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                    <textarea
                      className="training-input validation-prompt-input"
                      aria-label={`${t("Validation")} ${t("Prompt")} ${index + 1}`}
                      value={sample.prompt}
                      onChange={(e) =>
                        updateValidationSample(index, {
                          prompt: e.target.value,
                        })
                      }
                    />
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="training-add-prompt"
                onClick={() =>
                  setParams({
                    ...params,
                    validationSamples: [
                      ...validationSamples,
                      { prompt: "", width: 768, height: 768 },
                    ],
                  })
                }
              >
                <span aria-hidden="true">＋</span> {t("Add validation prompt")}
              </button>
            </>
          )}
        </section>
      )}
      <div className="training-panel-actions">
        <button
          className="w-full rounded-md bg-olive-600 px-3 py-2 text-xs font-semibold text-white hover:bg-olive-700 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!ready || !validationReady || queuing}
          onClick={() => onQueue(params)}
        >
          {queuing ? t("Adding training run…") : t("Start training")}
        </button>
        {!ready ? (
          <p>
            {imageCount === 0
              ? t("Add images before training.")
              : t("{count} images still need captions.", { count: imageCount - captionedCount })}
          </p>
        ) : !validationReady ? (
          <p>{t("Add at least one validation prompt.")}</p>
        ) : null}
      </div>
    </section>
  );
}

export function DatasetList() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const createDialog = useFloating({
    open: createOpen,
    onOpenChange: (open) => {
      setCreateOpen(open);
      if (!open) setName("");
    },
  });
  const createInteractions = useInteractions([
    useClick(createDialog.context),
    useDismiss(createDialog.context, { outsidePress: true }),
    useRole(createDialog.context, { role: "dialog" }),
  ]);
  const { data: datasets = [], isLoading } = useQuery({
    queryKey: ["datasets"],
    queryFn: getDatasets,
  });
  const create = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${API}/api/datasets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!r.ok) throw new Error("Could not create dataset");
      return (await r.json()) as Dataset;
    },
    onSuccess: (dataset) => {
      setName("");
      setCreateOpen(false);
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
      navigate(`/datasets/${dataset.id}`);
    },
  });
  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-2xl font-semibold tracking-tight">{t("Datasets")}</h2>
          <span className="text-xs text-olive-500">
            {t("Create and manage training data")}
          </span>
        </div>
        <button
          ref={createDialog.refs.setReference}
          className="rounded-lg bg-olive-800 px-3 py-2 text-xs font-semibold text-white transition hover:bg-olive-700"
          {...createInteractions.getReferenceProps()}
        >
          {t("New dataset")}
        </button>
      </header>

      <section className="dataset-card-grid">
        {isLoading ? (
          <p className="text-xs text-olive-500">{t("Loading datasets…")}</p>
        ) : datasets.length ? (
          datasets.map((dataset) => (
            <Link
              key={dataset.id}
              to={`/datasets/${dataset.id}`}
              className="dataset-card"
            >
              <div className="dataset-card-cover">
                {dataset.cover_path ? (
                  <img src={`${API}/files/${dataset.cover_path}`} alt="" />
                ) : (
                  <span>{t("Empty dataset")}</span>
                )}
              </div>
              <div className="dataset-card-body">
                <h3>{dataset.name}</h3>
                <p>
                  {dataset.image_count} {t("images")}
                  <span aria-hidden="true"> · </span>
                  {new Date(`${dataset.created_at}Z`).toLocaleDateString()}
                </p>
              </div>
            </Link>
          ))
        ) : (
          <div className="dataset-card-empty">
            <h3>{t("No datasets yet")}</h3>
            <p>
              {t("Create your first dataset to upload and caption training images.")}
            </p>
          </div>
        )}
      </section>

      {createOpen && (
        <FloatingPortal>
          <FloatingOverlay className="dataset-create-overlay" lockScroll>
            <FloatingFocusManager context={createDialog.context}>
              <form
                ref={createDialog.refs.setFloating}
                className="dataset-create-dialog"
                aria-labelledby="create-dataset-title"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (name.trim()) create.mutate();
                }}
                {...createInteractions.getFloatingProps()}
              >
                <div>
                  <h2 id="create-dataset-title">{t("New dataset")}</h2>
                  <p>{t("Give this training image collection a clear name.")}</p>
                </div>
                <label>
                  {t("Name")}
                  <input
                    autoFocus
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={t("Studio portraits")}
                  />
                </label>
                <div className="dataset-create-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setName("");
                      setCreateOpen(false);
                    }}
                  >
                    {t("Cancel")}
                  </button>
                  <button
                    type="submit"
                    disabled={!name.trim() || create.isPending}
                  >
                    {create.isPending ? t("Creating…") : t("Create dataset")}
                  </button>
                </div>
              </form>
            </FloatingFocusManager>
          </FloatingOverlay>
        </FloatingPortal>
      )}
    </>
  );
}

export function DatasetDetail() {
  const { t } = useI18n();
  const { id = "" } = useParams(),
    navigate = useNavigate(),
    queryClient = useQueryClient(),
    filesRef = useRef<HTMLInputElement>(null),
    store = useStore(),
    [prompt, setPrompt] = useState(""),
    [model, setModel] = useState("gemini-3.5-flash-lite"),
    [selectedIndex, setSelectedIndex] = useState<number | null>(null),
    [captionText, setCaptionText] = useState(""),
    [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { data, isLoading } = useQuery({
    queryKey: ["dataset", id],
    queryFn: () => getDataset(id),
    enabled: !!id,
  });
  const { data: suggestion } = useQuery({
    queryKey: ["training-suggestion", id],
    queryFn: async (): Promise<Suggestion> =>
      (await fetch(`${API}/api/datasets/${id}/training-suggestion`)).json(),
    enabled: !!id,
  });
  const upload = useMutation({
    mutationFn: async (files: FileList) => {
      const body = new FormData();
      Array.from(files).forEach((file) => body.append("files", file));
      const r = await fetch(`${API}/api/datasets/${id}/upload`, {
        method: "POST",
        body,
      });
      if (!r.ok) throw new Error("Upload failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dataset", id] });
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
    },
  });
  const caption = useMutation({
    mutationFn: async (overwrite: boolean) => {
      const r = await fetch(`${API}/api/caption`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataset_id: id,
          api_key: store.apiKey || undefined,
          overwrite,
        }),
      });
      if (!r.ok) throw new Error("Captioning could not start");
      const result = (await r.json()) as {
        updated: number;
        errors: { error: string }[];
      };
      if (result.errors.length) {
        const detail = result.errors[0]?.error ?? "";
        if (detail.includes("GEMINI_API_KEY")) {
          throw new FriendlyError(
            "Gemini API key required",
            "Add your Google AI Studio key before generating captions.",
            { label: "Open Settings", path: "/settings" },
          );
        }
        throw new FriendlyError(
          result.updated ? "Some captions failed" : "Captioning failed",
          result.updated
            ? `${result.updated} completed, ${result.errors.length} failed. ${detail}`
            : detail || "No captions were generated. Please try again.",
        );
      }
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["dataset", id] }),
  });
  const saveSettings = useMutation({
    mutationFn: async (overrides: { model?: string; prompt?: string } = {}) => {
      const r = await fetch(`${API}/api/datasets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_prompt: overrides.prompt ?? prompt,
          caption_model: overrides.model ?? model,
        }),
      });
      if (!r.ok) throw new Error("Could not save settings");
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["dataset", id] }),
  });
  const saveCaption = useMutation({
    mutationFn: async () => {
      if (selectedIndex === null || !data) return;
      const image = data.images[selectedIndex];
      const r = await fetch(`${API}/api/images/${image.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption: captionText }),
      });
      if (!r.ok) throw new Error("Could not save caption");
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["dataset", id] }),
  });
  const removeImages = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${API}/api/datasets/${id}/delete-images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_ids: [...selectedIds] }),
      });
      if (!r.ok) throw new Error("Could not delete images");
    },
    onSuccess: () => {
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["dataset", id] });
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
    },
  });
  const removeDataset = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${API}/api/datasets/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Could not delete dataset");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
      navigate("/datasets");
    },
  });
  const enqueueTraining = useMutation({
    mutationFn: async (params: TrainingParams) => {
      if (!data) return;
      const config = {
        data: { folder: data.dataset.folder, resolution: params.resolution },
        lora: { rank: params.rank, alpha: params.rank },
        train: {
          output_dir: `outputs/${id}_lora`,
          steps: params.steps,
          batch_size: 1,
          gradient_accumulation: 1,
          learning_rate: 0.0001,
          save_every: Math.max(
            1,
            Math.min(params.saveEvery ?? 250, params.steps),
          ),
          keep_last: Math.max(1, params.keepLast ?? 3),
          seed: 42,
        },
        sample: {
          enabled: !!params.sampleEnabled,
          samples: (params.validationSamples ?? []).filter(
            (sample) => sample.prompt.trim().length > 0,
          ),
          every: params.sampleEvery || 250,
          seed: 42,
        },
      };
      const r = await fetch(`${API}/api/train`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      if (!r.ok) throw new Error("Could not queue training");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });
  useEffect(() => {
    if (data) {
      store.set({ folder: data.dataset.folder, images: data.images });
      setPrompt(data.dataset.system_prompt || DEFAULT_CAPTION_PROMPT);
      setModel(data.dataset.caption_model || "gemini-3.5-flash-lite");
    }
  }, [data?.dataset.id]);
  useEffect(() => {
    if (selectedIndex !== null && data)
      setCaptionText(data.images[selectedIndex]?.caption || "");
  }, [selectedIndex, data]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (selectedIndex === null || !data) return;
      if (event.key === "Escape") setSelectedIndex(null);
      if (event.key === "ArrowLeft")
        setSelectedIndex(
          (selectedIndex - 1 + data.images.length) % data.images.length,
        );
      if (event.key === "ArrowRight")
        setSelectedIndex((selectedIndex + 1) % data.images.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIndex, data]);
  if (isLoading || !data)
    return <p className="text-xs text-olive-500">{t("Loading dataset…")}</p>;
  const captionState = store.captioning,
    inProgress =
      captionState.status === "started" || captionState.status === "progress";
  const selected = selectedIndex === null ? null : data.images[selectedIndex];
  const captionedCount = data.images.filter((image) =>
    image.caption.trim(),
  ).length;
  const toggleImage = (imageId: string) =>
    setSelectedIds((current) => {
      const next = new Set(current);
      next.has(imageId) ? next.delete(imageId) : next.add(imageId);
      return next;
    });
  return (
    <div className="dataset-detail">
      <main className="dataset-main">
        <header className="dataset-header">
          <div className="min-w-0">
            <div className="flex min-w-0 items-baseline gap-2">
              <Link
                to="/datasets"
                className="shrink-0 text-xs font-semibold text-olive-700 hover:underline"
              >
                {t("Datasets")}
              </Link>
              <span className="text-xs text-olive-300">/</span>
              <h2 className="truncate text-2xl font-semibold tracking-tight">
                {data.dataset.name}
              </h2>
            </div>
            <p className="dataset-header-stats">
              <strong>{data.images.length}</strong> {t("images")} ·{" "}
              <strong>{captionedCount}</strong> {t("captioned")}
            </p>
          </div>
          <div className="dataset-header-actions">
            <DatasetActions
              onDelete={() => removeDataset.mutate()}
              deleting={removeDataset.isPending}
            />
          </div>
        </header>

        <section className="dataset-toolbar">
          {selectedIds.size > 0 ? (
            <div className="dataset-selection-tools">
              <span>{selectedIds.size} selected</span>
              <ConfirmAction
                danger
                label={t("Delete")}
                title={t("Delete selected images?")}
                detail={t("Selected images, their sidecar caption files, and metadata will be permanently deleted.")}
                confirmLabel={`${t("Delete")} ${selectedIds.size}`}
                onConfirm={() => removeImages.mutate()}
                disabled={removeImages.isPending}
              />
            </div>
          ) : (
            <div className="dataset-upload-tools">
              <button
                className="dataset-upload-button"
                aria-label={
                  upload.isPending ? t("Uploading images") : t("Upload images")
                }
                title={upload.isPending ? t("Uploading images") : t("Upload images")}
                onClick={() => filesRef.current?.click()}
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  width="17"
                  height="17"
                >
                  <path
                    d="M10 13V3m0 0L6.5 6.5M10 3l3.5 3.5M4 11.5v3A1.5 1.5 0 0 0 5.5 16h9a1.5 1.5 0 0 0 1.5-1.5v-3"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.7"
                  />
                </svg>
              </button>
              <input
                ref={filesRef}
                className="hidden"
                type="file"
                accept="image/*"
                multiple
                onChange={(e) =>
                  e.target.files && upload.mutate(e.target.files)
                }
              />
            </div>
          )}
          <div className="dataset-caption-tools">
            <CaptionActions
              model={model}
              prompt={prompt}
              onModel={(nextModel) => {
                setModel(nextModel);
                saveSettings.mutate({ model: nextModel });
              }}
              onPrompt={setPrompt}
              onSave={() => saveSettings.mutate({ prompt })}
              onCaption={() => caption.mutate(false)}
              onRecaption={() => caption.mutate(true)}
              disabled={inProgress || caption.isPending || !data.images.length}
              captioning={inProgress || caption.isPending}
              saving={saveSettings.isPending}
              apiKeyMissing={!store.apiKey}
            />
          </div>
        </section>
        {(inProgress || captionState.status === "error") && (
          <section className="mt-3 rounded-md border border-olive-200 bg-olive-50 p-3 text-xs text-olive-900">
            <div className="flex justify-between font-semibold">
              <span>
                {captionState.status === "error"
                  ? t("Captioning error")
                  : t("Captioning images")}
              </span>
              <span>
                {captionState.current} / {captionState.total}
              </span>
            </div>
            {captionState.path && (
              <p className="mt-1 truncate text-[11px] text-olive-700">
                {captionState.path}
              </p>
            )}
            {captionState.error && (
              <p className="mt-1 text-[11px] text-red-700">
                {captionState.error}
              </p>
            )}
          </section>
        )}
        {enqueueTraining.isSuccess && (
          <section className="actionbar mt-4">
            <div className="text-xs text-olive-500">
              {t("Training added to queue")}
            </div>
          </section>
        )}
        <section className="dataset-gallery">
          {data.images.map((image, index) => (
            <div
              key={image.id}
              className={`dataset-image-card ${selectedIds.has(image.id) ? "border-olive-500 ring-2 ring-olive-200" : "border-olive-200"}`}
            >
              <button
                className="block w-full text-left"
                onClick={() => setSelectedIndex(index)}
              >
                <img
                  className="aspect-square w-full object-cover"
                  src={`${API}/files/${image.path}`}
                />
                <p className="dataset-image-caption">
                  <span>{image.caption || t("No caption yet")}</span>
                </p>
              </button>
              <label className="absolute left-1 top-1 !m-0 rounded bg-white/90 p-1">
                <input
                  type="checkbox"
                  checked={selectedIds.has(image.id)}
                  onChange={() => toggleImage(image.id)}
                />
              </label>
            </div>
          ))}
        </section>
      </main>

      <aside className="dataset-aside" aria-label={t("Training settings")}>
        <TrainingPlan
          imageCount={data.images.length}
          captionedCount={captionedCount}
          suggestion={suggestion}
          onQueue={(params) => enqueueTraining.mutate(params)}
          queuing={enqueueTraining.isPending}
        />
      </aside>

      {selected && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-olive-200/80 p-6"
          onClick={() => setSelectedIndex(null)}
        >
          <div
            className="relative grid max-h-full w-full max-w-6xl grid-cols-[minmax(0,1fr)_300px] overflow-hidden rounded-lg bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex min-w-0 flex-col bg-olive-100 p-3">
              <div className="mb-2 flex items-center justify-between text-xs text-olive-600">
                <span>
                  {selectedIndex! + 1} / {data.images.length}
                </span>
                <button
                  className="font-semibold hover:text-olive-950"
                  onClick={() => setSelectedIndex(null)}
                >
                  {t("Close · Esc")}
                </button>
              </div>
              <div className="relative aspect-video w-full overflow-hidden rounded-md bg-olive-200">
                <img
                  className="absolute inset-0 h-full w-full object-contain"
                  src={`${API}/files/${selected.path}`}
                />
              </div>
              <div className="mt-2 flex justify-between">
                <button
                  className="rounded-md border border-olive-200 bg-white px-3 py-1.5 text-xs text-olive-700 hover:bg-olive-50"
                  onClick={() =>
                    setSelectedIndex(
                      (selectedIndex! - 1 + data.images.length) %
                        data.images.length,
                    )
                  }
                >
                  ← {t("Previous")}
                </button>
                <button
                  className="rounded-md border border-olive-200 bg-white px-3 py-1.5 text-xs text-olive-700 hover:bg-olive-50"
                  onClick={() =>
                    setSelectedIndex((selectedIndex! + 1) % data.images.length)
                  }
                >
                  {t("Next")} →
                </button>
              </div>
            </div>
            <aside className="flex min-h-0 flex-col p-3">
              <h3 className="text-sm font-bold">{t("Caption")}</h3>
              <p className="mt-1 text-[10px] text-olive-500">
                {t("Edit and save the sidecar .txt caption.")}
              </p>
              <textarea
                className="mt-3 min-h-0 flex-1 resize-none rounded-md border border-olive-200 p-2 text-xs outline-none focus:border-olive-500"
                value={captionText}
                onChange={(e) => setCaptionText(e.target.value)}
              />
              <button
                className="mt-3 rounded-md bg-olive-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                disabled={saveCaption.isPending}
                onClick={() => saveCaption.mutate()}
              >
                {saveCaption.isPending ? t("Saving…") : t("Save caption")}
              </button>
            </aside>
          </div>
        </div>
      )}
    </div>
  );
}
