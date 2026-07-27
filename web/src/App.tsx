import { useEffect, useState } from "react";
import {
  Link,
  NavLink,
  Navigate,
  Outlet,
  Route,
  Routes,
} from "react-router-dom";
import { useStore } from "./store";
import { DatasetDetail, DatasetList } from "./Datasets";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GlobalErrorNotice } from "./GlobalErrorNotice";

export const API = "";
const field =
  "w-full rounded-md border border-olive-200 bg-white px-2 py-1.5 text-xs text-olive-800 outline-none transition focus:border-olive-500 focus:ring-2 focus:ring-olive-100";
const nav = ({ isActive }: { isActive: boolean }) =>
  `app-nav-link ${isActive ? "app-nav-link-active" : ""}`;

function Layout() {
  const s = useStore();
  const queryClient = useQueryClient();
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
          <NavLink className={nav} to="/dashboard">
            Workspace
          </NavLink>
          <NavLink className={nav} to="/datasets">
            Datasets
          </NavLink>
          <NavLink className={nav} to="/jobs">
            Runs
          </NavLink>
          <NavLink className={nav} to="/settings">
            Settings
          </NavLink>
        </nav>
        <div className="app-sidebar-footer">
          <span className="app-status-dot" />
          API online
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

function LossChart({ points }: { points: { step: number; loss: number }[] }) {
  const values = points.slice(-300);
  if (values.length < 2)
    return (
      <div className="flex h-44 items-center justify-center text-xs text-olive-400">
        Waiting for loss values…
      </div>
    );
  const width = 640,
    height = 176,
    pad = 16,
    min = Math.min(...values.map((x) => x.loss)),
    max = Math.max(...values.map((x) => x.loss)),
    span = Math.max(0.00001, max - min);
  const path = values
    .map(
      (point, index) =>
        `${index ? "L" : "M"} ${pad + (index / (values.length - 1)) * (width - pad * 2)} ${height - pad - ((point.loss - min) / span) * (height - pad * 2)}`,
    )
    .join(" ");
  return (
    <div>
      <svg
        className="h-44 w-full overflow-visible"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Training loss chart"
      >
        <line
          x1={pad}
          x2={width - pad}
          y1={height - pad}
          y2={height - pad}
          stroke="#cbd5e1"
        />
        <path
          d={path}
          fill="none"
          stroke="#0891b2"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="flex justify-between text-[10px] text-olive-400">
        <span>step {values[0].step}</span>
        <span>
          loss {max.toFixed(4)} → {min.toFixed(4)}
        </span>
        <span>step {values.at(-1)?.step}</span>
      </div>
    </div>
  );
}

function Dashboard() {
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
        <h2 className="text-2xl font-semibold tracking-tight">Workspace</h2>
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
              <LossChart points={points} />
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
    </>
  );
}

type Job = {
  status: string;
  created_at: string;
  returncode: number | null;
  error?: string;
  config: string;
};

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

function Jobs() {
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
  const activeId = selectedId ?? current[0]?.[0] ?? history[0]?.[0];
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
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">Runs</h2>
        <span className="text-xs text-olive-500">
          Training queue and history
        </span>
      </header>
      <section className="panel mt-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm">Current runs</h3>
          <span className="text-[11px] text-olive-500">
            Select a run to inspect its output
          </span>
        </div>
        {current.length === 0 ? (
          <p className="text-xs text-olive-500">
            Nothing is training right now. Start a run from a ready dataset.
          </p>
        ) : (
          <div className="divide-y divide-olive-100">
            {current.map(([id, job]) => (
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
      {history.length > 0 && (
        <section className="panel mt-3">
          <h3 className="text-sm">Recent history</h3>
          <div className="mt-2 divide-y divide-olive-100">
            {history.slice(0, 12).map(([id, job]) => (
              <JobRow
                key={id}
                id={id}
                job={job}
                selected={activeId === id}
                onSelect={() => setSelectedId(id)}
              />
            ))}
          </div>
        </section>
      )}
      <section className="panel mt-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm">Run output</h3>
          {activeId && (
            <code className="text-[11px] text-olive-400">{activeId}</code>
          )}
        </div>
        <pre className="mt-3 h-[24rem] overflow-auto rounded-md bg-olive-950 p-3 text-xs text-olive-200">
          {logLines.join("\n") || "Select a run to inspect its output."}
        </pre>
      </section>
    </>
  );
}

function Settings() {
  const s = useStore();
  const [saved, setSaved] = useState(false);
  return (
    <>
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">Settings</h2>
        <span className="text-xs text-olive-500">Local preferences</span>
      </header>
      <section className="panel mt-4 max-w-xl">
        <h3>Google AI Studio</h3>
        <p className="mt-2 text-sm text-olive-500">
          This key is used for Gemini image captioning and stored only in this
          browser's local storage. It is never sent to SQLite, project files, or
          server logs.
        </p>
        <label className="mt-6">
          API key
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
            Use this key
          </button>
          <button
            className="secondary !mt-0 !w-auto"
            onClick={() => {
              s.set({ apiKey: "" });
              setSaved(false);
            }}
          >
            Clear
          </button>
          {saved && (
            <span className="text-sm text-emerald-700">
              Key saved in this browser.
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
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/datasets" element={<DatasetList />} />
          <Route path="/datasets/:id" element={<DatasetDetail />} />
          <Route
            path="/dataset"
            element={<Navigate to="/datasets" replace />}
          />
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
      <GlobalErrorNotice />
    </>
  );
}
