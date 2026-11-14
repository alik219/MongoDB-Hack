import type { Metadata } from "next";
import "./globals.css";
import { SessionProvider } from "@/components/session";
import { Shell } from "@/components/shell";

export const metadata: Metadata = {
  title: "Continuity",
  description: "Advisor agent workspace with governed client memory",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>
          <Shell>{children}</Shell>
        </SessionProvider>
      </body>
    </html>
  );
}
