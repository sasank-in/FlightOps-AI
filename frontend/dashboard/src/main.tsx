import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { ApiError } from "./api/client";
import { App } from "./App";
import { ToastProvider } from "./components/toast";
import { AuthProvider } from "./lib/auth";
import { ThemeProvider } from "./lib/theme";
import "./styles/app.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // client errors (4xx) will not succeed on retry
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
