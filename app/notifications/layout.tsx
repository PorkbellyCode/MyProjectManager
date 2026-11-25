import { Suspense } from "react";
import { AppShell, ShellSkeleton } from "@/components/app-shell/shell";

export default function NotificationsLayout({ children }: LayoutProps<"/notifications">) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
