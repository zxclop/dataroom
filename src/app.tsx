import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";

// Route-level code splitting: the home screen ships without the heavier folder
// view (table, resizable split, PDF preview), which loads on first navigation.
const RootPage = lazy(() => import("@/pages/RootPage").then((m) => ({ default: m.RootPage })));
const NodePage = lazy(() => import("@/pages/NodePage").then((m) => ({ default: m.NodePage })));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const router = createBrowserRouter([
  { path: "/", element: <RootPage /> },
  { path: "/d/:nodeId", element: <NodePage /> },
]);

function PageFallback() {
  return (
    <div className="grid h-screen place-items-center text-sm text-muted-foreground">Loading…</div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<PageFallback />}>
        <RouterProvider router={router} />
      </Suspense>
      <Toaster position="bottom-center" />
    </QueryClientProvider>
  );
}
