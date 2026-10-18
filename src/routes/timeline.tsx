import { createFileRoute } from "@tanstack/react-router";
import { ProductionTimelinePage } from "./_authenticated/production-timeline";

// Public preview route — bypasses auth so the timeline is viewable
// without login for demo purposes.
export const Route = createFileRoute("/timeline")({
  component: () => (
    <div className="min-h-screen bg-background text-foreground">
      <ProductionTimelinePage />
    </div>
  ),
});
