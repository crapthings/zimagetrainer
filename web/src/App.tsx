import { useEffect, useState } from 'react'
import { NavLink, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { useStore } from './store'
import { DatasetDetail, DatasetList } from './Datasets'
import { useQuery, useQueryClient } from '@tanstack/react-query'

export const API = ''
const field = 'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100'
const nav = ({isActive}:{isActive:boolean}) => `rounded-md px-2 py-1.5 text-xs font-semibold ${isActive ? 'bg-cyan-50 text-cyan-700' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'}`

function Layout() {
  const s = useStore()
  const queryClient = useQueryClient()
  useEffect(() => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`)
    ws.onmessage=({data})=>{
      const e=JSON.parse(data)
      if(e.type==='log') s.addLog(e.line)
      if(e.type==='training') {
        const history=e.step!==undefined&&e.loss!==undefined?[...s.training.lossHistory.slice(-999),{step:e.step,loss:e.loss}]:s.training.lossHistory
        s.set({training:{...s.training,status:e.status??'running',step:e.step??s.training.step,total:e.total??s.training.total,loss:e.loss??s.training.loss,lossHistory:history}})
      }
      if(e.type==='stage') s.set({training:{...s.training,stage:e.stage}})
      if(e.type==='sample'){if(e.status==='starting')s.set({training:{...s.training,status:'sampling'}});if(e.status==='saved'&&e.path)s.set({training:{...s.training,status:'running',samplePath:e.path,samplePaths:[...s.training.samplePaths.filter(path=>path!==e.path),e.path]}})}
      if(e.type==='caption'){
        s.set({captioning:{status:e.status,current:e.current??s.captioning.current,total:e.total??s.captioning.total,path:e.path,error:e.error}})
        if(e.status==='finished'){queryClient.invalidateQueries({queryKey:['datasets']});queryClient.invalidateQueries({queryKey:['dataset']})}
      }
    }
    const ping=setInterval(()=>ws.readyState===1&&ws.send('ping'),15000)
    return()=>{clearInterval(ping);ws.close()}
  },[])
  return <main className="min-h-screen w-full bg-slate-50 text-slate-900"><div className="grid min-h-screen w-full lg:grid-cols-[190px_minmax(0,1fr)]"><aside className="border-b border-slate-200 bg-white p-4 lg:border-b-0 lg:border-r"><p className="text-[10px] font-bold tracking-[.18em] text-cyan-600">LOCAL CONSOLE</p><h1 className="mt-1 text-base font-bold tracking-tight">Z-Image Turbo</h1><nav className="mt-6 grid gap-0.5"><NavLink className={nav} to="/dashboard">Dashboard</NavLink><NavLink className={nav} to="/datasets">Datasets</NavLink><NavLink className={nav} to="/jobs">Jobs & logs</NavLink><NavLink className={nav} to="/settings">Settings</NavLink></nav><div className="mt-6 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] font-medium text-emerald-700">● Local API online</div></aside><section className="min-w-0 p-4 lg:p-5"><Outlet /></section></div></main>
}

function LossChart({points}:{points:{step:number;loss:number}[]}) {
  const values=points.slice(-300)
  if(values.length<2) return <div className="flex h-44 items-center justify-center text-xs text-slate-400">Waiting for loss values…</div>
  const width=640,height=176,pad=16,min=Math.min(...values.map(x=>x.loss)),max=Math.max(...values.map(x=>x.loss)),span=Math.max(0.00001,max-min)
  const path=values.map((point,index)=>`${index?'L':'M'} ${pad+(index/(values.length-1))*(width-pad*2)} ${height-pad-((point.loss-min)/span)*(height-pad*2)}`).join(' ')
  return <div><svg className="h-44 w-full overflow-visible" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Training loss chart"><line x1={pad} x2={width-pad} y1={height-pad} y2={height-pad} stroke="#cbd5e1"/><path d={path} fill="none" stroke="#0891b2" strokeWidth="2" vectorEffect="non-scaling-stroke"/></svg><div className="flex justify-between text-[10px] text-slate-400"><span>step {values[0].step}</span><span>loss {max.toFixed(4)} → {min.toFixed(4)}</span><span>step {values.at(-1)?.step}</span></div></div>
}

function Dashboard() {
  const s=useStore()
  const [steps,setSteps]=useState(1000),[rank,setRank]=useState(16),[resolution,setResolution]=useState(1024)
  const {data:jobData={jobs:{}}}=useQuery({queryKey:['jobs'],queryFn:async()=> (await fetch(`${API}/api/jobs`)).json(),refetchInterval:2000})
  const jobs=Object.entries(jobData.jobs) as [string,{status:string;created_at:string}][]
  const activeJob=jobs.find(([,job])=>job.status==='running')?.[0]??jobs[0]?.[0]
  const {data:monitor}=useQuery({queryKey:['monitor',activeJob],queryFn:async()=> (await fetch(`${API}/api/jobs/${activeJob}/monitor`)).json(),enabled:!!activeJob,refetchInterval:2000})
  const points=monitor?.losses?.length?monitor.losses:s.training.lossHistory
  const samples=monitor?.samples?.length?monitor.samples:s.training.samplePaths
  const latest=points.at(-1)
  const monitorStatus=monitor?.status??s.training.status
  const currentStage=monitor?.stage??s.training.stage
  const currentStep=latest?.step??s.training.step
  const currentLoss=latest?.loss??s.training.loss
  const totalSteps=monitor?.total??s.training.total
  const displayStage=currentStage??(monitorStatus==='running'&&currentStep===0?'Preparing first training step…':undefined)
  const train=async()=>{const config={data:{folder:s.folder,resolution},lora:{rank,alpha:rank},train:{output_dir:'outputs/my_zimage_lora',steps,batch_size:1,gradient_accumulation:1,learning_rate:0.0001,save_every:Math.min(250,steps),seed:42}};const r=await fetch(`${API}/api/train`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({config})});if(r.ok)s.set({training:{status:'queued',step:0,total:steps,samplePaths:[],lossHistory:[],logs:[]}})}
  const progress=Math.min(100,Math.round(100*currentStep/Math.max(1,totalSteps)))
  return <><header><p className="text-[10px] font-bold tracking-[.18em] text-cyan-600">TRAINING MONITOR</p><h2 className="mt-1 text-2xl font-semibold tracking-tight">Dashboard</h2></header><div className="mt-5 grid gap-4 xl:grid-cols-[270px_minmax(0,1fr)]"><section className="panel"><h3 className="text-sm">Quick training</h3><p className="muted mt-0.5">Use a dataset’s Queue training menu for validation-image settings.</p><div className="mt-2 grid grid-cols-2 gap-2"><label>Resolution<input className={field} type="number" value={resolution} onChange={e=>setResolution(+e.target.value)}/></label><label>Rank<input className={field} type="number" value={rank} onChange={e=>setRank(+e.target.value)}/></label></div><label>Steps<input className={field} type="number" value={steps} onChange={e=>setSteps(+e.target.value)}/></label><button className="primary" disabled={['running','queued','sampling'].includes(monitorStatus)||!s.images.length} onClick={train}>{['running','sampling'].includes(monitorStatus)?'Training…':'Start training'}</button></section><section className="panel"><div className="flex items-center justify-between"><div><h3 className="text-sm">Live loss</h3><p className="mt-0.5 text-[11px] text-slate-500">{activeJob?`Job ${activeJob}`:'No training job selected'}</p>{displayStage&&monitorStatus==='running'&&<p className="mt-1 text-[11px] font-medium text-cyan-700">{displayStage}</p>}</div><span className="muted uppercase">{s.training.status==='sampling'?'Generating preview…':monitorStatus}</span></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-violet-500" style={{width:`${progress}%`}}/></div><div className="mt-2 flex justify-between text-xs text-slate-600"><span>{currentStep.toLocaleString()} / {totalSteps.toLocaleString()} steps</span><span>{currentLoss !== undefined ? `loss ${currentLoss.toFixed(5)}`:'waiting for first step'}</span></div><div className="mt-3 border-t border-slate-100 pt-3"><LossChart points={points}/></div></section></div><section className="panel mt-4"><div className="flex items-center justify-between"><div><h3 className="text-sm">Validation images</h3><p className="mt-0.5 text-[11px] text-slate-500">Baseline and checkpoint outputs use the same prompt and seed, so they are directly comparable.</p></div><span className="text-[11px] text-slate-500">{samples.length} images</span></div>{samples.length?<div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{samples.map((path:string)=><a key={path} href={`${API}/files/${path}`} target="_blank" className="overflow-hidden rounded-md border border-slate-200 bg-slate-100 hover:border-cyan-400"><img className="aspect-square w-full object-cover" src={`${API}/files/${path}`}/><span className="block truncate bg-white px-2 py-1 text-[10px] text-slate-600">{path.split('/').at(-1)}</span></a>)}</div>:<p className="mt-3 text-xs text-slate-400">Enable “Generate validation images” when queuing a dataset training run.</p>}</section></>
}

function Jobs() {
  const s=useStore()
  const [selectedId,setSelectedId]=useState<string>()
  const {data={jobs:{}}}=useQuery({queryKey:['jobs'],queryFn:async()=>{const r=await fetch(`${API}/api/jobs`);if(!r.ok)throw new Error('Could not load jobs');return r.json()},refetchInterval:2000})
  const jobs=Object.entries(data.jobs) as [string,{status:string;created_at:string;returncode:number|null;error?:string;config:string}][]
  const activeId=selectedId??jobs.find(([,job])=>job.status==='running')?.[0]??jobs[0]?.[0]
  const {data:monitor}=useQuery({queryKey:['job-log',activeId],queryFn:async()=>{const r=await fetch(`${API}/api/jobs/${activeId}/monitor`);if(!r.ok)throw new Error('Could not load job log');return r.json()},enabled:!!activeId,refetchInterval:2000})
  const logLines=monitor?.logs?.length?monitor.logs:s.training.logs
  return <><header><p className="text-[10px] font-bold tracking-[.18em] text-cyan-600">TRAINING QUEUE</p><h2 className="mt-1 text-2xl font-semibold tracking-tight">Jobs & logs</h2></header><section className="panel mt-5"><div className="mb-2 flex items-center justify-between"><h3 className="text-sm">Queue</h3><span className="text-[11px] text-slate-500">Select a job to inspect its persisted log</span></div>{jobs.length===0?<p className="text-xs text-slate-500">No training jobs yet.</p>:<div className="divide-y divide-slate-100">{jobs.map(([id,job])=><button key={id} className={`block w-full py-2 text-left text-xs ${activeId===id?'bg-cyan-50/70':''}`} onClick={()=>setSelectedId(id)}><div className="flex items-center gap-3 px-2"><span className={`h-2 w-2 rounded-full ${job.status==='running'?'bg-cyan-500':job.status==='queued'?'bg-amber-400':job.status==='completed'?'bg-emerald-500':'bg-red-500'}`}/><span className="w-20 font-semibold capitalize text-slate-700">{job.status}</span><code className="flex-1 truncate text-[11px] text-slate-500">{id}</code><span className="text-[11px] text-slate-400">{new Date(`${job.created_at}Z`).toLocaleString()}</span></div>{job.status==='failed'&&<p className="mx-2 ml-7 mt-1 break-words rounded bg-red-50 px-2 py-1 text-[11px] text-red-700">{job.error||'No failure detail was captured.'}</p>}</button>)}</div>}</section><section className="panel mt-3"><div className="flex items-center justify-between"><h3 className="text-sm">Training output</h3>{activeId&&<code className="text-[11px] text-slate-400">{activeId}</code>}</div><pre className="mt-3 h-[24rem] overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-200">{logLines.join('\n')||'Waiting for training output…'}</pre></section></>
}

function Settings() { const s=useStore(); const [saved,setSaved]=useState(false); return <><header><p className="text-xs font-bold tracking-[.24em] text-cyan-600">LOCAL PREFERENCES</p><h2 className="mt-2 text-3xl font-semibold tracking-tight">Settings</h2></header><section className="panel mt-8 max-w-xl"><h3>Google AI Studio</h3><p className="mt-2 text-sm text-slate-500">This key is used for Gemini image captioning and stored only in this browser's local storage. It is never sent to SQLite, project files, or server logs.</p><label className="mt-6">API key<input className={field} type="password" autoComplete="off" value={s.apiKey} onChange={e=>{s.set({apiKey:e.target.value});setSaved(false)}} placeholder="AIza..."/></label><div className="mt-4 flex items-center gap-3"><button className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white" onClick={()=>setSaved(true)}>Use this key</button><button className="secondary !mt-0 !w-auto" onClick={()=>{s.set({apiKey:''});setSaved(false)}}>Clear</button>{saved&&<span className="text-sm text-emerald-700">Key saved in this browser.</span>}</div></section></> }

export default function App(){return <Routes><Route element={<Layout/>}><Route path="/dashboard" element={<Dashboard/>}/><Route path="/datasets" element={<DatasetList/>}/><Route path="/datasets/:id" element={<DatasetDetail/>}/><Route path="/dataset" element={<Navigate to="/datasets" replace/>}/><Route path="/jobs" element={<Jobs/>}/><Route path="/settings" element={<Settings/>}/><Route path="*" element={<Navigate to="/dashboard" replace/>}/></Route></Routes>}
