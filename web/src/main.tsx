import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import "./styles.css";
import App from "./App";
import { FriendlyError } from "./errors";
import { useStore } from "./store";
import { I18nProvider } from "./i18n";

const showGlobalError = (error: unknown) => {
  const friendly = error instanceof FriendlyError ? error : null;
  useStore.getState().showError({
    title: friendly?.title ?? "Something went wrong",
    message: error instanceof Error ? error.message : "Please try again.",
    action: friendly?.action,
  });
};
const queryClient = new QueryClient({
  mutationCache: new MutationCache({ onError: showGlobalError }),
  queryCache: new QueryCache({ onError: showGlobalError }),
});
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
);
