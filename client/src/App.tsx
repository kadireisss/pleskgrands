import { useEffect, lazy, Suspense } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

const AdminPanel = lazy(() => import("@/pages/admin"));

function RedirectToProxy() {
  useEffect(() => { window.location.href = "/proxy/tr/"; }, []);
  return null;
}

function Router() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-[#0f0f0f] text-white">Yükleniyor...</div>}>
      <Switch>
        <Route path="/admin/:rest*" component={AdminPanel} />
        <Route path="/admin" component={AdminPanel} />
        <Route>{() => <RedirectToProxy />}</Route>
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
