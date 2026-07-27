import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import { useState } from "react";

export const captionModels = [
  {
    id: "gemini-3.5-flash-lite",
    name: "Gemini 3.5 Flash-Lite",
    detail: "Fast, cost-efficient default for high-volume image captions",
  },
  {
    id: "gemini-3.6-flash",
    name: "Gemini 3.6 Flash",
    detail: "Stronger multimodal reasoning for more detailed captions",
  },
  {
    id: "gemini-3.1-flash-lite",
    name: "Gemini 3.1 Flash Lite",
    detail: "Fastest and most cost-efficient for batch captions",
  },
  {
    id: "gemini-3.1-flash-image",
    name: "Gemini 3.1 Flash",
    detail: "Higher-quality visual model for detailed captions",
  },
];

export default function ModelSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (model: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected =
    captionModels.find((model) => model.id === value) ?? captionModels[0];
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "bottom-start",
    middleware: [offset(6), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const click = useClick(context),
    dismiss = useDismiss(context),
    role = useRole(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([
    click,
    dismiss,
    role,
  ]);
  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        className="mt-1 flex w-full items-center justify-between rounded-lg border border-olive-200 bg-white px-3 py-2 text-left text-sm text-olive-800 shadow-sm"
        {...getReferenceProps()}
      >
        <span>{selected.name}</span>
        <span className="text-olive-400">⌄</span>
      </button>
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className="z-50 w-80 overflow-hidden rounded-xl border border-olive-200 bg-white p-1 shadow-xl"
            {...getFloatingProps()}
          >
            {captionModels.map((model) => (
              <button
                key={model.id}
                type="button"
                className={`w-full rounded-lg px-3 py-2 text-left transition ${model.id === value ? "bg-olive-50" : "hover:bg-olive-50"}`}
                onClick={() => {
                  onChange(model.id);
                  setOpen(false);
                }}
              >
                <div className="text-sm font-semibold text-olive-800">
                  {model.name}
                </div>
                <div className="mt-0.5 text-xs text-olive-500">
                  {model.detail}
                </div>
                <code className="mt-1 block text-[10px] text-olive-700">
                  {model.id}
                </code>
              </button>
            ))}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
