import { useEffect, useMemo, useState } from "react";
import {
  autoUpdate,
  flip,
  FloatingFocusManager,
  FloatingPortal,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { API } from "./App";
import { useI18n } from "./i18n";

type Lora = {
  path: string;
  job_id: string;
  dataset_id: string;
  dataset_name: string;
  step: number;
  status: string;
};

type Generation = {
  id: string;
  path: string;
  seed: number;
  prompt: string;
  size: string;
  steps: number;
  lora_path: string | null;
  width: number;
  height: number;
  created_at: string;
};

type GenerationRequest = {
  prompt: string;
  width: number;
  height: number;
  seed: number;
  steps: number;
  lora_path: string | null;
  size: string;
};

const ratios = [
  { label: "Square", value: "1024x1024", hint: "1:1" },
  { label: "Portrait", value: "832x1216", hint: "2:3" },
  { label: "Landscape", value: "1216x832", hint: "3:2" },
  { label: "Wide", value: "1344x768", hint: "16:9" },
];

function LoraPicker({ value, onChange, options }: { value: string | null; onChange: (value: string | null) => void; options: Lora[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "bottom-start",
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip(), shift({ padding: 12 })],
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useClick(context),
    useDismiss(context),
    useRole(context, { role: "listbox" }),
  ]);
  const selected = options.find((option) => option.path === value);
  const grouped = useMemo(() => {
    return options.reduce<Record<string, Lora[]>>((groups, option) => {
      const key = option.dataset_name;
      (groups[key] ??= []).push(option);
      return groups;
    }, {});
  }, [options]);

  return (
    <>
      <button ref={refs.setReference} type="button" className="playground-picker" {...getReferenceProps()}>
        <span className="playground-picker-copy">
          <small>{t("LoRA checkpoint")}</small>
          <strong>{selected ? `${t("Run")} ${selected.job_id} · ${t("step")} ${selected.step}` : t("Base Z-Image Turbo")}</strong>
        </span>
        <span className="playground-chevron" aria-hidden="true">⌄</span>
      </button>
      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
            <div ref={refs.setFloating} style={floatingStyles} className="playground-lora-menu" {...getFloatingProps()}>
              <button type="button" className={`playground-lora-option ${!value ? "is-selected" : ""}`} onClick={() => { onChange(null); setOpen(false); }}>
                <span><strong>{t("Base Z-Image Turbo")}</strong><small>{t("No LoRA applied")}</small></span>
                {!value && <span aria-hidden="true">✓</span>}
              </button>
              {Object.entries(grouped).map(([datasetId, loras]) => (
                <div key={datasetId} className="playground-lora-group">
                  <p>{datasetId}</p>
                  {loras.map((option) => (
                    <button key={option.path} type="button" className={`playground-lora-option ${value === option.path ? "is-selected" : ""}`} onClick={() => { onChange(option.path); setOpen(false); }}>
                      <span><strong>{t("Run")} {option.job_id} · {t("step")} {option.step}</strong><small>{option.status}</small></span>
                      {value === option.path && <span aria-hidden="true">✓</span>}
                    </button>
                  ))}
                </div>
              ))}
              {!options.length && <p className="playground-lora-empty">{t("No exported LoRAs yet. Complete a training run, then choose one here.")}</p>}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}

export function Playground() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState("1024x1024");
  const [seed, setSeed] = useState("42");
  const [steps, setSteps] = useState("9");
  const [loraPath, setLoraPath] = useState<string | null>(null);
  const [selectedGenerationId, setSelectedGenerationId] = useState<string>();
  const { data } = useQuery<{ loras: Lora[] }>({
    queryKey: ["playground-loras"],
    queryFn: async () => {
      const response = await fetch(`${API}/api/playground/loras`);
      if (!response.ok) throw new Error("Could not load LoRA checkpoints.");
      return response.json();
    },
  });
  const { data: generationData } = useQuery<{ generations: Generation[] }>({
    queryKey: ["playground-generations"],
    queryFn: async () => {
      const response = await fetch(`${API}/api/playground/generations`);
      if (!response.ok) throw new Error("Could not load generation history.");
      return response.json();
    },
  });
  const history = useMemo(
    () => (generationData?.generations ?? []).map((generation) => ({
      ...generation,
      size: `${generation.width}x${generation.height}`,
    })),
    [generationData],
  );
  useEffect(() => {
    const checkpoint = searchParams.get("lora");
    if (checkpoint && data?.loras.some((option) => option.path === checkpoint))
      setLoraPath(checkpoint);
  }, [data?.loras, searchParams]);
  const generate = useMutation({
    mutationFn: async (payload: GenerationRequest) => {
      const { size: _size, ...request } = payload;
      const response = await fetch(`${API}/api/playground/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail ?? "Could not generate an image.");
      return { ...body, ...payload } as Generation;
    },
    onSuccess: (generation) => {
      setSelectedGenerationId(generation.id);
      queryClient.setQueryData<{ generations: Generation[] }>(
        ["playground-generations"],
        (current) => ({
          generations: [
            generation,
            ...(current?.generations ?? []).filter(
              (item) => item.id !== generation.id,
            ),
          ].slice(0, 60),
        }),
      );
      queryClient.invalidateQueries({ queryKey: ["playground-generations"] });
    },
  });
  const latest = history.find((generation) => generation.id === selectedGenerationId) ?? history[0];

  return (
    <div className="playground-page">
      <div className="playground-layout">
        <aside className="playground-inspector">
          <div className="playground-inspector-heading"><h3>{t("Create image")}</h3><span>Z-Image Turbo</span></div>
          <section className="playground-control-group playground-prompt-group"><h4>{t("Prompt")}</h4><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={t("Describe the image you want to make…")} aria-label={t("Prompt")} /></section>
          <section className="playground-control-group"><h4>{t("LoRA")}</h4><LoraPicker value={loraPath} onChange={setLoraPath} options={data?.loras ?? []} /></section>
          <section className="playground-control-group"><h4>{t("Canvas")}</h4><label>{t("Aspect ratio")}<select value={size} onChange={(event) => setSize(event.target.value)}>{ratios.map((ratio) => <option key={ratio.value} value={ratio.value}>{t(ratio.label)} · {ratio.hint} · {ratio.value.replace("x", " × ")}</option>)}</select></label></section>
          <section className="playground-control-group playground-advanced"><h4>{t("Generation settings")}</h4><label>{t("Seed")}<input type="number" min="0" value={seed} onChange={(event) => setSeed(event.target.value)} /></label><label>{t("Steps")}<input type="number" min="1" max="30" value={steps} onChange={(event) => setSteps(event.target.value)} /></label><p>{t("Turbo is designed for a short run. 9 steps is the recommended starting point.")}</p></section>
          <button type="button" className="playground-generate" disabled={!prompt.trim() || generate.isPending} onClick={() => { const [width, height] = size.split("x").map(Number); generate.mutate({ prompt, width, height, seed: Number(seed), steps: Number(steps), lora_path: loraPath, size }); }}>
            {generate.isPending ? t("Generating…") : t("Generate")}
          </button>
          {latest && <section className="playground-result-meta"><h4>{t("Last image")}</h4><p>{t("Seed")} {latest.seed} · <code>{latest.id}</code></p></section>}
        </aside>
        <section className="playground-workspace">
          <div className="playground-canvas">
            {latest ? <img src={`/files/${latest.path}`} alt={prompt} /> : <div className="playground-empty-canvas"><span>✦</span><strong>{t("Your image will appear here")}</strong><p>{t("Choose a LoRA if you want, write a prompt, then generate.")}</p></div>}
            {generate.isPending && <div className="playground-generation-overlay"><span className="playground-spinner" />{t("Preparing your image…")}</div>}
          </div>
          <section className="playground-history" aria-label="Recent generations">
            <div><h3>{t("Recent")}</h3><span>{history.length ? `${history.length} generation${history.length === 1 ? "" : "s"}` : t("Nothing generated yet")}</span></div>
            {history.length > 0 && <div className="playground-history-list">{history.map((item) => <button key={item.id} type="button" aria-label={`Restore generation ${item.id}`} onClick={() => { setPrompt(item.prompt); setSize(item.size); setSeed(String(item.seed)); setSteps(String(item.steps)); setLoraPath(item.lora_path); setSelectedGenerationId(item.id); }}><img src={`/files/${item.path}`} alt={`Generation ${item.id}`} /></button>)}</div>}
          </section>
        </section>
      </div>
    </div>
  );
}
