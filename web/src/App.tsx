import { useEffect, useState } from "react";
import {
  Link,
  NavLink,
  Navigate,
  Outlet,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router-dom";
import { useStore } from "./store";
import { DatasetDetail, DatasetList } from "./Datasets";
import { Playground } from "./Playground";
import { useI18n } from "./i18n";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GlobalErrorNotice } from "./GlobalErrorNotice";
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

export const API = "";
const field =
  "w-full rounded-md border border-olive-200 bg-white px-2 py-1.5 text-xs text-olive-800 outline-none transition focus:border-olive-500 focus:ring-2 focus:ring-olive-100";
const nav = ({ isActive }: { isActive: boolean }) =>
  `app-nav-link ${isActive ? "app-nav-link-active" : ""}`;

function Layout() {
  const s = useStore();
  const queryClient = useQueryClient();
  const { t } = useI18n();
  useEffect(() => {
    const ws = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
    );
    ws.onmessage = ({ data }) => {
      const e = JSON.parse(data);
      if (e.type === "log") s.addLog(e.line);
      if (e.type === "training") {
        const history =
          e.step !== undefined && e.loss !== undefined
            ? [
                ...s.training.lossHistory.slice(-999),
                { step: e.step, loss: e.loss },
              ]
            : s.training.lossHistory;
        s.set({
          training: {
            ...s.training,
            status: e.status ?? "running",
            step: e.step ?? s.training.step,
            total: e.total ?? s.training.total,
            loss: e.loss ?? s.training.loss,
            lossHistory: history,
          },
        });
      }
      if (e.type === "stage")
        s.set({ training: { ...s.training, stage: e.stage } });
      if (e.type === "sample") {
        if (e.status === "starting")
          s.set({ training: { ...s.training, status: "sampling" } });
        if (e.status === "saved" && e.path)
          s.set({
            training: {
              ...s.training,
              status: "running",
              samplePath: e.path,
              samplePaths: [
                ...s.training.samplePaths.filter((path) => path !== e.path),
                e.path,
              ],
            },
          });
      }
      if (e.type === "caption") {
        s.set({
          captioning: {
            status: e.status,
            current: e.current ?? s.captioning.current,
            total: e.total ?? s.captioning.total,
            path: e.path,
            error: e.error,
          },
        });
        if (e.status === "finished") {
          queryClient.invalidateQueries({ queryKey: ["datasets"] });
          queryClient.invalidateQueries({ queryKey: ["dataset"] });
        }
      }
    };
    const ping = setInterval(
      () => ws.readyState === 1 && ws.send("ping"),
      15000,
    );
    return () => {
      clearInterval(ping);
      ws.close();
    };
  }, []);
  return (
    <main className="app-shell">
      <aside className="app-sidebar">
        <div className="app-brand">
          <h1>Z-Forge</h1>
        </div>
        <nav className="mt-8 grid gap-1">
          <NavLink className={nav} to="/playground">
            {t("Playground")}
          </NavLink>
          <NavLink className={nav} to="/datasets">
            {t("Datasets")}
          </NavLink>
          <NavLink className={nav} to="/training">
            {t("Training")}
          </NavLink>
          <NavLink className={nav} to="/settings">
            {t("Settings")}
          </NavLink>
        </nav>
        <div className="app-sidebar-footer">
          <span className="app-status-dot" />
          {t("API online")}
        </div>
      </aside>
      <div className="app-body">
        <section className="app-content">
          <Outlet />
        </section>
      </div>
    </main>
  );
}

function LossChart({
  points,
  total,
}: {
  points: { step: number; loss: number }[];
  total: number;
}) {
  const { t } = useI18n();
  const values = points;
  if (values.length < 2)
    return (
      <div className="flex h-44 items-center justify-center text-xs text-olive-400">
        {t("Waiting for loss values…")}
      </div>
    );
  const smoothingWindow = Math.max(
    3,
    Math.min(15, Math.round(values.length / 30)),
  );
  const smoothed = values.map((point, index) => {
    const start = Math.max(0, index - smoothingWindow + 1);
    const window = values.slice(start, index + 1);
    return {
      step: point.step,
      loss: window.reduce((sum, item) => sum + item.loss, 0) / window.length,
    };
  });
  const width = 640,
    height = 176,
    padTop = 14,
    padBottom = 18,
    padLeft = 42,
    padRight = 16,
    min = Math.min(...smoothed.map((x) => x.loss)),
    max = Math.max(...smoothed.map((x) => x.loss)),
    span = Math.max(0.00001, max - min);
  const chartHeight = height - padTop - padBottom;
  const chartWidth = width - padLeft - padRight;
  const xTicks = Array.from({ length: 5 }, (_, index) =>
    Math.round((total * index) / 4),
  );
  const yTicks = Array.from(
    { length: 4 },
    (_, index) => max - (span * index) / 3,
  );
  const lossTick = (value: number) => value.toFixed(max < 1 ? 3 : 2);
  const coordinates = smoothed.map((point) => ({
    x:
      padLeft +
      (Math.min(point.step, Math.max(1, total)) / Math.max(1, total)) *
        chartWidth,
    y:
      height -
      padBottom -
      ((point.loss - min) / span) * chartHeight,
  }));
  const path = coordinates
    .slice(0, -1)
    .map((point, index) => {
      const previous = coordinates[index - 1] ?? point;
      const next = coordinates[index + 1];
      const afterNext = coordinates[index + 2] ?? next;
      const control1 = {
        x: point.x + (next.x - previous.x) / 6,
        y: point.y + (next.y - previous.y) / 6,
      };
      const control2 = {
        x: next.x - (afterNext.x - point.x) / 6,
        y: next.y - (afterNext.y - point.y) / 6,
      };
      return `${index ? "" : `M ${point.x} ${point.y} `}C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${next.x} ${next.y}`;
    })
    .join(" ");
  return (
    <div className="loss-chart">
      <div className="loss-chart-canvas">
      <svg
        className="h-44 w-full overflow-visible"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={t("Training loss chart")}
      >
        {xTicks.map((tick) => {
          const x = padLeft + (tick / Math.max(1, total)) * chartWidth;
          return (
            <line
              key={`x-${tick}`}
              x1={x}
              x2={x}
              y1={padTop}
              y2={height - padBottom}
              stroke="var(--color-olive-100)"
              strokeDasharray="2 4"
            />
          );
        })}
        {yTicks.map((tick) => {
          const y =
            height - padBottom - ((tick - min) / span) * chartHeight;
          return (
            <line
              key={`y-${tick}`}
              x1={padLeft}
              x2={width - padRight}
              y1={y}
              y2={y}
              stroke="var(--color-olive-100)"
              strokeDasharray="2 4"
            />
          );
        })}
        <line
          x1={padLeft}
          x2={width - padRight}
          y1={height - padBottom}
          y2={height - padBottom}
          stroke="#cbd5e1"
        />
        <path
          d={path}
          fill="none"
          stroke="var(--color-olive-700)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="loss-chart-y-ticks" aria-hidden="true">
        {yTicks.map((tick) => {
          const top =
            height - padBottom - ((tick - min) / span) * chartHeight;
          return (
            <span key={tick} style={{ top: `${top}px` }}>
              {lossTick(tick)}
            </span>
          );
        })}
      </div>
      </div>
      <div className="loss-chart-x-ticks" aria-label={t("Training steps")}>
        {xTicks.map((tick) => (
          <span key={tick}>{tick.toLocaleString()}</span>
        ))}
      </div>
      <div className="loss-chart-legacy-footer">
        <span>step 0</span>
        <span>
          loss {max.toFixed(4)} → {min.toFixed(4)}
        </span>
        <span>step {total.toLocaleString()}</span>
      </div>
    </div>
  );
}

type Job = {
  status: string;
  created_at: string;
  returncode: number | null;
  error?: string;
  config: string;
};

function Training() {
  const s = useStore();
  const { data: jobData = { jobs: {} } } = useQuery({
    queryKey: ["jobs"],
    queryFn: async () => (await fetch(`${API}/api/jobs`)).json(),
    refetchInterval: 2000,
  });
  const jobs = Object.entries(jobData.jobs) as [string, { status: string }][];
  const activeJob = jobs.find(([, job]) =>
    ["queued", "running", "sampling"].includes(job.status),
  )?.[0];
  const { data: monitor } = useQuery({
    queryKey: ["monitor", activeJob],
    queryFn: async () =>
      (await fetch(`${API}/api/jobs/${activeJob}/monitor`)).json(),
    enabled: !!activeJob,
    refetchInterval: 2000,
  });
  const points = monitor?.losses?.length
    ? monitor.losses
    : s.training.lossHistory;
  const samples = monitor?.samples?.length
    ? monitor.samples
    : s.training.samplePaths;
  const latest = points.at(-1);
  const monitorStatus = monitor?.status ?? s.training.status;
  const currentStage = monitor?.stage ?? s.training.stage;
  const currentStep = latest?.step ?? s.training.step;
  const currentLoss = latest?.loss ?? s.training.loss;
  const totalSteps = monitor?.total ?? s.training.total;
  const displayStage =
    currentStage ??
    (monitorStatus === "running" && currentStep === 0
      ? "Preparing the first training step…"
      : undefined);
  const progress = Math.min(
    100,
    Math.round((100 * currentStep) / Math.max(1, totalSteps)),
  );
  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold tracking-tight">Training</h2>
        <Link
          className="whitespace-nowrap rounded-lg bg-olive-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-olive-700"
          to="/datasets"
        >
          New dataset
        </Link>
      </header>
      {!activeJob ? (
        <section className="empty-workspace mt-5">
          <div>
            <h3 className="text-sm font-semibold text-olive-900">
              No active training
            </h3>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-olive-500">
              Open a dataset to upload images, review captions, and start a
              training run.
            </p>
            <Link
              className="mt-5 inline-flex whitespace-nowrap rounded-lg border border-olive-300 bg-white px-3 py-2 text-xs font-semibold text-olive-700 transition hover:bg-olive-50"
              to="/datasets"
            >
              Open datasets
            </Link>
          </div>
        </section>
      ) : (
        <>
          <section className="panel mt-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm">Current training run</h3>
                <p className="mt-0.5 text-[11px] text-olive-500">
                  Job {activeJob}
                </p>
                {displayStage && monitorStatus === "running" && (
                  <p className="mt-1 text-[11px] font-medium text-olive-700">
                    {displayStage}
                  </p>
                )}
              </div>
              <span className="muted uppercase">
                {s.training.status === "sampling"
                  ? "Generating preview…"
                  : monitorStatus}
              </span>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-olive-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-olive-700 to-olive-400"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between text-xs text-olive-600">
              <span>
                {currentStep.toLocaleString()} / {totalSteps.toLocaleString()}{" "}
                steps
              </span>
              <span>
                {currentLoss !== undefined
                  ? `loss ${currentLoss.toFixed(5)}`
                  : "waiting for first step"}
              </span>
            </div>
            <div className="mt-3 border-t border-olive-100 pt-3">
              <LossChart points={points} total={totalSteps} />
            </div>
          </section>
          <section className="panel mt-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm">Validation images</h3>
                <p className="mt-0.5 text-[11px] text-olive-500">
                  Each configured prompt generates a deterministic baseline and
                  checkpoint preview.
                </p>
              </div>
              <span className="text-[11px] text-olive-500">
                {samples.length} images
              </span>
            </div>
            {samples.length ? (
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {samples.map((path: string) => (
                  <a
                    key={path}
                    href={`${API}/files/${path}`}
                    target="_blank"
                    className="overflow-hidden rounded-xl border border-olive-200 bg-olive-100 hover:border-olive-400"
                  >
                    <img
                      className="aspect-square w-full object-cover"
                      src={`${API}/files/${path}`}
                    />
                    <span className="block truncate bg-white px-2 py-1 text-[10px] text-olive-600">
                      {path.split("/").at(-1)}
                    </span>
                  </a>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-olive-400">
                Validation images will appear here when the selected plan
                enables them.
              </p>
            )}
          </section>
        </>
      )}
      <RunBrowser />
    </>
  );
}

function JobRow({
  id,
  job,
  selected,
  onSelect,
}: {
  id: string;
  job: Job;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`block w-full py-2 text-left text-xs ${selected ? "bg-olive-50/70" : ""}`}
      onClick={onSelect}
    >
      <div className="flex items-center gap-3 px-2">
        <span
          className={`h-2 w-2 rounded-full ${job.status === "running" ? "bg-olive-500" : job.status === "queued" ? "bg-amber-400" : job.status === "completed" ? "bg-emerald-500" : "bg-red-500"}`}
        />
        <span className="w-20 font-semibold capitalize text-olive-700">
          {job.status}
        </span>
        <code className="flex-1 truncate text-[11px] text-olive-500">{id}</code>
        <span className="text-[11px] text-olive-400">
          {new Date(`${job.created_at}Z`).toLocaleString()}
        </span>
      </div>
      {job.status === "failed" && (
        <p className="mx-2 ml-7 mt-1 line-clamp-2 rounded bg-red-50 px-2 py-1 text-[11px] text-red-700">
          {job.error || "No failure detail was captured."}
        </p>
      )}
    </button>
  );
}

function RunBrowser() {
  const s = useStore();
  const [selectedId, setSelectedId] = useState<string>();
  const { data = { jobs: {} } } = useQuery({
    queryKey: ["jobs"],
    queryFn: async () => {
      const r = await fetch(`${API}/api/jobs`);
      if (!r.ok) throw new Error("Could not load jobs");
      return r.json();
    },
    refetchInterval: 2000,
  });
  const jobs = Object.entries(data.jobs) as [string, Job][];
  const current = jobs.filter(([, job]) =>
    ["queued", "running", "sampling"].includes(job.status),
  );
  const history = jobs.filter(
    ([, job]) => !["queued", "running", "sampling"].includes(job.status),
  );
  const selectedIdIsValid =
    !!selectedId && jobs.some(([id]) => id === selectedId);
  useEffect(() => {
    if (selectedId && !selectedIdIsValid) setSelectedId(undefined);
  }, [selectedId, selectedIdIsValid]);
  const activeId =
    (selectedIdIsValid ? selectedId : undefined) ??
    current[0]?.[0] ??
    history[0]?.[0];
  const { data: monitor } = useQuery({
    queryKey: ["job-log", activeId],
    queryFn: async () => {
      const r = await fetch(`${API}/api/jobs/${activeId}/monitor`);
      if (!r.ok) throw new Error("Could not load job log");
      return r.json();
    },
    enabled: !!activeId,
    refetchInterval: 2000,
  });
  const logLines = monitor?.logs?.length ? monitor.logs : s.training.logs;
  return (
    <>
      <section className="panel mt-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm">Runs</h3>
          <span className="text-[11px] text-olive-500">
            Queue and recent history
          </span>
        </div>
        {jobs.length === 0 ? (
          <p className="text-xs text-olive-500">
            No training runs yet. Start one from a ready dataset.
          </p>
        ) : (
          <div className="divide-y divide-olive-100">
            {[...current, ...history].slice(0, 12).map(([id, job]) => (
              <JobRow
                key={id}
                id={id}
                job={job}
                selected={activeId === id}
                onSelect={() => setSelectedId(id)}
              />
            ))}
          </div>
        )}
      </section>
      {activeId && (
        <section className="panel mt-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm">Run output</h3>
            <code className="text-[11px] text-olive-400">{activeId}</code>
          </div>
          <pre className="mt-3 h-[24rem] overflow-auto rounded-md bg-olive-950 p-3 text-xs text-olive-200">
            {logLines.join("\n") || "No output was captured for this run."}
          </pre>
        </section>
      )}
    </>
  );
}

type TimelineEvent = {
  type: "training" | "stage" | "checkpoint" | "sample";
  status?: string;
  stage?: string;
  step?: number;
  path?: string;
  paths?: string[];
  created_at: string;
};

const stageLabels: Record<string, string> = {
  "preparing first training batch": "Preparing the first training batch",
  "encoding first image": "Encoding the first image",
  "encoding first caption": "Encoding the first caption",
  "running first backward pass": "Running the first backward pass",
};

function eventPresentation(event: TimelineEvent, t: (key: string) => string) {
  if (event.type === "stage")
    return {
      icon: "●",
      tone: "active",
      title: t(stageLabels[event.stage ?? ""] ?? event.stage ?? "Preparing training"),
      detail: t("Setup"),
    };
  if (event.type === "checkpoint" && event.status === "saved")
    return {
      icon: "✓",
      tone: "success",
      title: `${t("Checkpoint saved at step")} ${event.step?.toLocaleString()}`,
      detail: event.path,
    };
  if (event.type === "checkpoint")
    return {
      icon: "−",
      tone: "muted",
      title: t("Older checkpoints removed"),
      detail: event.paths?.join(", "),
    };
  if (event.type === "sample" && event.status === "starting")
    return {
      icon: "◐",
      tone: "active",
      title: t("Generating validation images"),
      detail: t("Validation"),
    };
  if (event.type === "sample")
    return {
      icon: "▣",
      tone: "success",
      title: t("Validation image generated"),
      detail: event.path?.split("/").at(-1),
    };
  if (event.status === "completed")
    return {
      icon: "✓",
      tone: "success",
      title: t("Training completed"),
      detail: t("Run finished successfully"),
    };
  if (event.status === "failed")
    return {
      icon: "!",
      tone: "danger",
      title: t("Training stopped with an error"),
      detail: t("Open raw output for details"),
    };
  return {
    icon: "●",
    tone: "active",
    title: t(event.status === "queued" ? "Training queued" : "Training started"),
    detail: t("Run"),
  };
}

function runDate(value: string) {
  return new Date(`${value}Z`);
}

function runDateGroup(value: string, t?: (key: string) => string) {
  const date = runDate(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (left: Date, right: Date) =>
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate();
  if (sameDay(date, today)) return t?.("Today") ?? "Today";
  if (sameDay(date, yesterday)) return t?.("Yesterday") ?? "Yesterday";
  return date.toLocaleDateString([], {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function TrainingRunSelect({
  jobs,
  value,
  onChange,
}: {
  jobs: [string, Job][];
  value?: string;
  onChange: (id: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = jobs.find(([id]) => id === value);
  const floating = useFloating({
    open,
    onOpenChange: (nextOpen) => {
      setOpen(nextOpen);
      if (!nextOpen) setSearch("");
    },
    placement: "bottom-end",
    middleware: [offset(6), flip({ padding: 12 }), shift({ padding: 12 })],
    whileElementsMounted: autoUpdate,
  });
  const interactions = useInteractions([
    useClick(floating.context),
    useDismiss(floating.context),
    useRole(floating.context, { role: "listbox" }),
  ]);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filtered = jobs.filter(([id, job]) => {
    const date = runDate(job.created_at);
    return `${id} ${job.status} ${date.toLocaleString()} ${runDateGroup(job.created_at, t)}`
      .toLocaleLowerCase()
      .includes(normalizedSearch);
  });
  const groups = filtered.reduce(
    (result, item) => {
      const label = runDateGroup(item[1].created_at, t);
      const existing = result.find((group) => group.label === label);
      if (existing) existing.items.push(item);
      else result.push({ label, items: [item] });
      return result;
    },
    [] as { label: string; items: [string, Job][] }[],
  );

  return (
    <>
      <button
        ref={floating.refs.setReference}
        className="training-run-trigger"
        aria-label={t("Select training run")}
        {...interactions.getReferenceProps()}
      >
        <span className={`run-status-dot run-status-${selected?.[1].status}`} />
        <span>
          <strong className="capitalize">{selected ? t(selected[1].status) : t("Select run")}</strong>
          {selected && (
            <small>{runDate(selected[1].created_at).toLocaleString()}</small>
          )}
        </span>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={floating.context} modal={false}>
            <div
              ref={floating.refs.setFloating}
              style={floating.floatingStyles}
              className="training-run-menu"
              {...interactions.getFloatingProps()}
            >
              <div className="training-run-search">
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <circle cx="9" cy="9" r="5.5" />
                  <path d="m13 13 4 4" />
                </svg>
                <input
                  autoFocus
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t("Search runs")}
                  aria-label={t("Search training runs")}
                />
              </div>
              <div className="training-run-options">
                {groups.length ? (
                  groups.map((group) => (
                    <section key={group.label}>
                      <h4>{group.label}</h4>
                      {group.items.map(([id, job]) => (
                        <button
                          key={id}
                          role="option"
                          aria-selected={id === value}
                          onClick={() => {
                            onChange(id);
                            setOpen(false);
                          }}
                        >
                          <span className={`run-status-dot run-status-${job.status}`} />
                          <span>
                            <strong className="capitalize">{t(job.status)}</strong>
                            <small>{id}</small>
                          </span>
                          <time>
                            {runDate(job.created_at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </time>
                        </button>
                      ))}
                    </section>
                  ))
                ) : (
                  <p className="training-run-no-results">{t("No matching runs")}</p>
                )}
              </div>
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}

function TrainingMonitor() {
  const s = useStore();
  const navigate = useNavigate();
  const { t } = useI18n();
  const { runId } = useParams<{ runId: string }>();
  const [view, setView] = useState<"monitor" | "raw">("monitor");
  const { data = { jobs: {} } } = useQuery({
    queryKey: ["jobs"],
    queryFn: async () => {
      const response = await fetch(`${API}/api/jobs`);
      if (!response.ok) throw new Error("Could not load training runs");
      return response.json();
    },
    refetchInterval: 2000,
  });
  const jobs = Object.entries(data.jobs) as [string, Job][];
  const current = jobs.filter(([, job]) =>
    ["queued", "running", "sampling"].includes(job.status),
  );
  const history = jobs.filter(
    ([, job]) => !["queued", "running", "sampling"].includes(job.status),
  );
  const fallbackId = current[0]?.[0] ?? history[0]?.[0];
  const routeIdIsValid =
    !!runId && jobs.some(([id]) => id === runId);
  useEffect(() => {
    if (fallbackId && (!runId || !routeIdIsValid)) {
      navigate(`/training/${fallbackId}`, { replace: true });
    }
  }, [fallbackId, navigate, routeIdIsValid, runId]);
  const activeId = routeIdIsValid ? runId : fallbackId;
  const selectedJob = jobs.find(([id]) => id === activeId)?.[1];
  const { data: monitor } = useQuery({
    queryKey: ["monitor", activeId],
    queryFn: async () => {
      const response = await fetch(`${API}/api/jobs/${activeId}/monitor`);
      if (!response.ok) throw new Error("Could not load training output");
      return response.json();
    },
    enabled: !!activeId,
    refetchInterval: 2000,
  });

  const points = monitor?.losses?.length
    ? monitor.losses
    : s.training.lossHistory;
  const samples = monitor?.samples?.length
    ? monitor.samples
    : s.training.samplePaths;
  const latest = points.at(-1);
  const status = monitor?.status ?? selectedJob?.status ?? s.training.status;
  const stage = monitor?.stage ?? s.training.stage;
  const step = latest?.step ?? s.training.step;
  const loss = latest?.loss ?? s.training.loss;
  const total = monitor?.total ?? s.training.total;
  const progress = Math.min(
    100,
    Math.round((100 * step) / Math.max(1, total)),
  );
  const previousLoss =
    points.length > 10 ? points[Math.max(0, points.length - 11)]?.loss : undefined;
  const lossTrend =
    loss === undefined || previousLoss === undefined
      ? "Waiting"
      : loss < previousLoss
        ? "Falling"
        : loss > previousLoss
          ? "Rising"
          : "Stable";
  const timeline = (monitor?.timeline ?? []) as TimelineEvent[];
  const logLines = monitor?.logs?.length ? monitor.logs : s.training.logs;

  return (
    <>
      <header className="training-header">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{t("Training")}</h2>
          <span className="text-xs text-olive-500">{t("Monitor runs and outputs")}</span>
        </div>
        <div className="training-header-actions">
          {jobs.length > 0 && (
            <TrainingRunSelect
              jobs={[...current, ...history]}
              value={activeId}
              onChange={(id) => navigate(`/training/${id}`)}
            />
          )}
        </div>
      </header>

      {!activeId ? (
        <div className="training-empty">
          {t("No training runs yet. Start one from a dataset when it is ready.")}
          <Link to="/datasets">{t("Open datasets")}</Link>
        </div>
      ) : (
        <div className="training-monitor">
          <nav className="training-view-tabs" aria-label={t("Training")}>
            <button
              className={view === "monitor" ? "training-view-tab-active" : ""}
              onClick={() => setView("monitor")}
            >
              {t("Monitor")}
            </button>
            <button
              className={view === "raw" ? "training-view-tab-active" : ""}
              onClick={() => setView("raw")}
            >
              {t("Raw output")}
              <span>{logLines.length}</span>
            </button>
          </nav>

          {view === "monitor" ? (
            <>
              <section className="training-statusbar">
                <div className="training-run-status">
                  <span className={`run-status-dot run-status-${status}`} />
                  <strong className="capitalize">{t(status)}</strong>
                  <span className="training-run-id" title={`${t("Run ID")}: ${activeId}`}>
                    <span>{t("Run ID")}</span>
                    <code>{activeId}</code>
                  </span>
                </div>
                <span>
                  {["running", "sampling"].includes(status) && stage
                    ? t(stageLabels[stage] ?? stage)
                    : t(selectedJob?.error ?? "Run output is up to date")}
                </span>
              </section>

              <div className="training-overview">
                <section className="training-chart training-chart-composite">
                  <div className="training-progress-track">
                    <i style={{ width: `${progress}%` }} />
                  </div>
                  <div className="training-section-heading">
                    <div>
                      <h3>{t("Training loss")}</h3>
                      <p>{t("Smoothed loss across the full configured step range")}</p>
                    </div>
                    <span>{progress}% {t("complete")}</span>
                  </div>
                  <div className="training-metrics">
                    <div>
                      <span>{t("Current step")}</span>
                      <strong>{step.toLocaleString()}</strong>
                    </div>
                    <div>
                      <span>{t("Max steps")}</span>
                      <strong>{total.toLocaleString()}</strong>
                    </div>
                    <div>
                      <span>{t("Current loss")}</span>
                      <strong>{loss?.toFixed(5) ?? "—"}</strong>
                    </div>
                    <div>
                      <span>{t("Recent trend")}</span>
                      <strong
                        className={`loss-trend loss-trend-${lossTrend.toLowerCase()}`}
                      >
                        {t(lossTrend)}
                      </strong>
                    </div>
                  </div>
                  <LossChart points={points} total={total} />
                </section>
                <section className="training-events">
                  <div className="training-section-heading">
                    <div>
                      <h3>{t("Important events")}</h3>
                      <p>{t("Readable milestones from the training process")}</p>
                    </div>
                  </div>
                  {timeline.length ? (
                    <ol className="training-event-list">
                      {timeline
                        .filter(
                          (event, index, all) =>
                            event.type !== "stage" ||
                            !all.slice(index + 1).some(
                              (candidate: TimelineEvent) =>
                                candidate.type === "stage" &&
                                candidate.stage === event.stage,
                            ),
                        )
                        .slice(-30)
                        .reverse()
                        .map((event, index) => {
                          const item = eventPresentation(event, t);
                          return (
                            <li key={`${event.created_at}-${index}`}>
                              <span
                                className={`event-icon event-icon-${item.tone}`}
                              >
                                {item.icon}
                              </span>
                              <div>
                                <strong>{item.title}</strong>
                                {item.detail && <p>{item.detail}</p>}
                              </div>
                              <time>
                                {new Date(
                                  `${event.created_at}Z`,
                                ).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </time>
                            </li>
                          );
                        })}
                    </ol>
                  ) : (
                    <p className="training-section-empty">
                      {t("Events will appear as the run prepares, saves checkpoints, and generates validation images.")}
                    </p>
                  )}
                </section>
              </div>

              <div className="training-insights">
                <section className="training-validation">
                  <div className="training-section-heading">
                    <div>
                      <h3>{t("Validation images")}</h3>
                      <p>{t("Compare generated samples across checkpoints")}</p>
                    </div>
                    <span>{samples.length}</span>
                  </div>
                  {samples.length ? (
                    <div className="training-sample-grid">
                      {samples.slice(-8).map((path: string) => (
                        <a
                          key={path}
                          href={`${API}/files/${path}`}
                          target="_blank"
                        >
                          <img src={`${API}/files/${path}`} alt="" />
                          <span>{path.split("/").at(-1)}</span>
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p className="training-section-empty">
                      {t("Generated validation images will appear here.")}
                    </p>
                  )}
                </section>
              </div>
            </>
          ) : (
            <section className="training-output training-output-tab">
              <div className="training-section-heading">
                <div>
                  <h3>{t("Raw output")}</h3>
                  <p>{t("Original command-line output for diagnosis and detail")}</p>
                </div>
                <span>{logLines.length} lines</span>
              </div>
              <pre>
                {logLines.join("\n") || t("No output was captured for this run.")}
              </pre>
            </section>
          )}
        </div>
      )}
    </>
  );
}

function Settings() {
  const s = useStore();
  const [saved, setSaved] = useState(false);
  const { language, setLanguage, t } = useI18n();
  return (
    <>
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">{t("Settings")}</h2>
        <span className="text-xs text-olive-500">{t("Local preferences")}</span>
      </header>
      <section className="panel mt-4 max-w-xl">
        <h3>{t("Language")}</h3>
        <p className="mt-2 text-sm text-olive-500">{t("Interface language")}</p>
        <div className="mt-4 inline-flex rounded-lg border border-olive-200 bg-olive-50 p-1">
          <button type="button" className={`rounded-md px-3 py-1.5 text-xs font-semibold ${language === "en" ? "bg-white text-olive-900 shadow-sm" : "text-olive-600"}`} onClick={() => setLanguage("en")}>{t("English")}</button>
          <button type="button" className={`rounded-md px-3 py-1.5 text-xs font-semibold ${language === "zh" ? "bg-white text-olive-900 shadow-sm" : "text-olive-600"}`} onClick={() => setLanguage("zh")}>{t("Chinese")}</button>
        </div>
      </section>
      <section className="panel mt-4 max-w-xl">
        <h3>Google AI Studio</h3>
        <p className="mt-2 text-sm text-olive-500">
          {t("This key is used for Gemini image captioning and stored only in this browser's local storage. It is never sent to SQLite, project files, or server logs.")}
        </p>
        <label className="mt-6">
          {t("API key")}
          <input
            className={field}
            type="password"
            autoComplete="off"
            value={s.apiKey}
            onChange={(e) => {
              s.set({ apiKey: e.target.value });
              setSaved(false);
            }}
            placeholder="AIza..."
          />
        </label>
        <div className="mt-4 flex items-center gap-3">
          <button
            className="rounded-lg bg-olive-600 px-4 py-2 text-sm font-semibold text-white"
            onClick={() => setSaved(true)}
          >
            {t("Use this key")}
          </button>
          <button
            className="secondary !mt-0 !w-auto"
            onClick={() => {
              s.set({ apiKey: "" });
              setSaved(false);
            }}
          >
            {t("Clear")}
          </button>
          {saved && (
            <span className="text-sm text-emerald-700">
              {t("Key saved in this browser.")}
            </span>
          )}
        </div>
      </section>
    </>
  );
}

export default function App() {
  return (
    <>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/playground" replace />} />
          <Route path="/playground" element={<Playground />} />
          <Route path="/training" element={<TrainingMonitor />} />
          <Route path="/training/:runId" element={<TrainingMonitor />} />
          <Route path="/datasets" element={<DatasetList />} />
          <Route path="/datasets/:id" element={<DatasetDetail />} />
          <Route
            path="/dataset"
            element={<Navigate to="/datasets" replace />}
          />
          <Route
            path="/dashboard"
            element={<Navigate to="/training" replace />}
          />
          <Route path="/jobs" element={<Navigate to="/training" replace />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/playground" replace />} />
        </Route>
      </Routes>
      <GlobalErrorNotice />
    </>
  );
}
