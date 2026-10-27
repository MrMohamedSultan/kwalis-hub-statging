import {
  createRootRouteWithContext,
  Outlet,
  HeadContent,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { installTransientSessionGuard } from "@/lib/session-persistence";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { NotFoundPage, UnexpectedErrorPage } from "@/components/ErrorPages";
import appCss from "../styles.css?url";
import { ThemeProvider } from "@/lib/theme";
import { Toaster } from "@/components/ui/sonner";
import { CurrencyProvider } from "@/contexts/CurrencyContext";
import { registerServiceWorker } from "@/lib/pwa/register-sw";
import { registerProjectQueryClient } from "@/lib/project-query-cache";
import "@/lib/i18n";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#2E5C8A" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "Kwalis HUB" },
      { name: "application-name", content: "Kwalis HUB" },
      { title: "Kwalis HUB — Beyond the Scenes, In Control" },
      {
        name: "description",
        content:
          "Kwalis HUB — Beyond the Scenes, In Control. Production accounting from script to screen.",
      },
      { property: "og:title", content: "Kwalis HUB — Beyond the Scenes, In Control" },
      { name: "twitter:title", content: "Kwalis HUB — Beyond the Scenes, In Control" },
      {
        property: "og:description",
        content:
          "Kwalis HUB — Beyond the Scenes, In Control. Production accounting from script to screen.",
      },
      {
        name: "twitter:description",
        content:
          "Kwalis HUB — Beyond the Scenes, In Control. Production accounting from script to screen.",
      },
      {
        property: "og:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/3f76e956-e9cd-4e7b-baf5-3c7c92c8135a/id-preview-aa6cd1f8--ef4c2d20-2eaa-4c94-a9cc-0110b309ba88.lovable.app-1781982324046.png",
      },
      {
        name: "twitter:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/3f76e956-e9cd-4e7b-baf5-3c7c92c8135a/id-preview-aa6cd1f8--ef4c2d20-2eaa-4c94-a9cc-0110b309ba88.lovable.app-1781982324046.png",
      },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: Shell,
  component: RootComponent,
  // Without this, any thrown non-Error (e.g. `undefined`) unmounts the whole
  // tree and the app renders a blank screen instead of a recoverable state.
  errorComponent: ({ error, reset }) => <UnexpectedErrorPage error={error} reset={reset} />,
  notFoundComponent: () => <NotFoundPage />,
});

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    void registerServiceWorker();
    return installTransientSessionGuard();
  }, []);

  useEffect(() => registerProjectQueryClient(queryClient), [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <CurrencyProvider>
          {/* Catches anything that escapes the route boundaries — including
              thrown non-Error values (`undefined`) that TanStack's own
              CatchBoundary treats as "no error" and re-renders into a blank
              screen. Resets automatically on navigation via resetKey. */}
          <AppErrorBoundary resetKey={pathname}>
            <Outlet />
          </AppErrorBoundary>
          <Toaster position="top-right" />
        </CurrencyProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {/* Final safety net at the document level — inline-styled fallback so
            the app can never unmount into a blank screen. */}
        <AppErrorBoundary variant="shell">{children}</AppErrorBoundary>
        <Scripts />
      </body>
    </html>
  );
}
